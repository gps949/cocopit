import type { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { loadPricingTable, priceEvent, resolveEntry } from "../cost/engine";
import type { Router } from "../http/router";

interface UsageFilter {
  where: string;
  params: Record<string, string | number>;
  joinSessions: boolean;
}

/** Shared query-string filters: from/to (epoch ms), project (id), model. */
function parseFilter(url: URL): UsageFilter {
  const clauses: string[] = [];
  const params: Record<string, string | number> = {};
  let joinSessions = false;

  const from = url.searchParams.get("from");
  if (from) {
    clauses.push("u.ts >= $from");
    params.$from = Number(from);
  }
  const to = url.searchParams.get("to");
  if (to) {
    clauses.push("u.ts < $to");
    params.$to = Number(to);
  }
  const model = url.searchParams.get("model");
  if (model) {
    clauses.push("u.model = $model");
    params.$model = model;
  }
  const project = url.searchParams.get("project");
  if (project) {
    clauses.push("s.project_id = $project");
    params.$project = Number(project);
    joinSessions = true;
  }
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params, joinSessions };
}

function usageFrom(filter: UsageFilter): string {
  return filter.joinSessions ? "usage_events u JOIN sessions s ON s.id = u.session_id" : "usage_events u";
}

export function registerUsageRoutes(router: Router, db: Database, claudeJsonPath: string): void {
  router.register("GET", "/api/usage/summary", (req) => {
    const filter = parseFilter(new URL(req.url));
    const row = db
      .prepare(
        `SELECT COUNT(*) AS events,
                COALESCE(SUM(u.cost_usd), 0) AS costUsd,
                COALESCE(SUM(u.input_tokens), 0) AS inputTokens,
                COALESCE(SUM(u.output_tokens), 0) AS outputTokens,
                COALESCE(SUM(u.cache_read_tokens), 0) AS cacheReadTokens,
                COALESCE(SUM(u.cache_w5m_tokens + u.cache_w1h_tokens), 0) AS cacheWriteTokens,
                COALESCE(SUM(u.cost_usd IS NULL), 0) AS unpricedEvents,
                COALESCE(SUM(u.web_search_requests), 0) AS webSearchRequests
         FROM ${usageFrom(filter)} ${filter.where}`,
      )
      .get(filter.params);
    return Response.json(row);
  });

  router.register("GET", "/api/usage/daily", (req) => {
    const filter = parseFilter(new URL(req.url));
    const days = db
      .prepare(
        `SELECT date(u.ts / 1000, 'unixepoch', 'localtime') AS day,
                COALESCE(SUM(u.cost_usd), 0) AS costUsd,
                SUM(u.input_tokens + u.output_tokens + u.cache_read_tokens + u.cache_w5m_tokens + u.cache_w1h_tokens) AS tokens,
                COUNT(*) AS events
         FROM ${usageFrom(filter)} ${filter.where}
         GROUP BY day ORDER BY day`,
      )
      .all(filter.params);
    return Response.json({ days });
  });

  router.register("GET", "/api/usage/heatmap", (req) => {
    const filter = parseFilter(new URL(req.url));
    const cells = db
      .prepare(
        `SELECT CAST(strftime('%w', u.ts / 1000, 'unixepoch', 'localtime') AS INTEGER) AS weekday,
                CAST(strftime('%H', u.ts / 1000, 'unixepoch', 'localtime') AS INTEGER) AS hour,
                COALESCE(SUM(u.cost_usd), 0) AS costUsd,
                COUNT(*) AS events
         FROM ${usageFrom(filter)} ${filter.where}
         GROUP BY weekday, hour`,
      )
      .all(filter.params);
    return Response.json({ cells });
  });

  router.register("GET", "/api/usage/by-model", (req) => {
    const filter = parseFilter(new URL(req.url));
    const rows = db
      .prepare(
        `SELECT u.model,
                COALESCE(SUM(u.cost_usd), 0) AS costUsd,
                SUM(u.input_tokens) AS inputTokens,
                SUM(u.output_tokens) AS outputTokens,
                SUM(u.cache_read_tokens) AS cacheReadTokens,
                SUM(u.cache_w5m_tokens + u.cache_w1h_tokens) AS cacheWriteTokens,
                COUNT(*) AS events,
                MAX(u.cost_usd IS NULL) AS unpricedFlag
         FROM ${usageFrom(filter)} ${filter.where}
         GROUP BY u.model ORDER BY costUsd DESC`,
      )
      .all(filter.params) as Array<Record<string, unknown>>;
    const models = rows.map(({ unpricedFlag, ...row }) => ({ ...row, unpriced: unpricedFlag === 1 }));
    return Response.json({ models });
  });

  router.register("GET", "/api/usage/by-project", (req) => {
    const filter = parseFilter(new URL(req.url));
    filter.joinSessions = true;
    const projects = db
      .prepare(
        `SELECT p.id AS projectId, p.dir_name AS dirName, p.cwd,
                COALESCE(SUM(u.cost_usd), 0) AS costUsd,
                SUM(u.input_tokens + u.output_tokens + u.cache_read_tokens + u.cache_w5m_tokens + u.cache_w1h_tokens) AS tokens,
                COUNT(*) AS events
         FROM usage_events u
         JOIN sessions s ON s.id = u.session_id
         JOIN projects p ON p.id = s.project_id
         ${filter.where}
         GROUP BY p.id ORDER BY costUsd DESC`,
      )
      .all(filter.params);
    return Response.json({ projects });
  });

  router.register("GET", "/api/usage/cache-efficiency", (req) => {
    const filter = parseFilter(new URL(req.url));
    const table = loadPricingTable();
    const rows = db
      .prepare(
        `SELECT u.model,
                SUM(u.input_tokens) AS input,
                SUM(u.cache_read_tokens) AS cacheRead,
                SUM(u.cache_w5m_tokens) AS w5m,
                SUM(u.cache_w1h_tokens) AS w1h
         FROM ${usageFrom(filter)} ${filter.where}
         GROUP BY u.model`,
      )
      .all(filter.params) as Array<{ model: string; input: number; cacheRead: number; w5m: number; w1h: number }>;

    let input = 0;
    let cacheRead = 0;
    let w5m = 0;
    let w1h = 0;
    let savedUsd = 0;
    for (const row of rows) {
      input += row.input;
      cacheRead += row.cacheRead;
      w5m += row.w5m;
      w1h += row.w1h;
      const entry = resolveEntry(table, row.model);
      if (entry) {
        const tier = entry.tiers.default;
        savedUsd += (row.cacheRead * (tier.input - tier.cacheRead)) / 1_000_000;
      }
    }
    return Response.json({
      inputTokens: input,
      cacheReadTokens: cacheRead,
      cacheWrite5mTokens: w5m,
      cacheWrite1hTokens: w1h,
      hitRate: cacheRead + input > 0 ? cacheRead / (cacheRead + input) : 0,
      savedUsd,
    });
  });

  router.register("GET", "/api/usage/unpriced", () => {
    const models = db
      .prepare(
        `SELECT model,
                COUNT(*) AS events,
                SUM(input_tokens + output_tokens + cache_read_tokens + cache_w5m_tokens + cache_w1h_tokens) AS totalTokens,
                MIN(ts) AS firstTs, MAX(ts) AS lastTs
         FROM usage_events WHERE cost_usd IS NULL GROUP BY model ORDER BY totalTokens DESC`,
      )
      .all();
    return Response.json({ models });
  });

  // Prices the official lastModelUsage token counts against OUR table. The
  // official record has no 5m/1h cache split, so ours is a band [all-5m,
  // all-1h]; official cost inside the band → the table is current. This avoids
  // matching sessions entirely (lastModelUsage overwrite order does not follow
  // last_ts, so per-session reconciliation is unreliable).
  router.register("GET", "/api/usage/calibration", () => {
    interface OfficialUsage {
      costUSD?: number;
      inputTokens?: number;
      outputTokens?: number;
      cacheReadInputTokens?: number;
      cacheCreationInputTokens?: number;
      webSearchRequests?: number;
    }
    let claudeJson: { projects?: Record<string, { lastModelUsage?: Record<string, OfficialUsage> }> } = {};
    if (existsSync(claudeJsonPath)) {
      try {
        claudeJson = JSON.parse(readFileSync(claudeJsonPath, "utf8"));
      } catch {
        // unreadable claude.json → empty calibration rather than a 500
      }
    }
    const table = loadPricingTable();
    const TOLERANCE = 0.05;

    const rows: Array<{
      cwd: string;
      model: string;
      officialUsd: number;
      oursLowUsd: number;
      oursHighUsd: number;
      status: "ok" | "mismatch" | "unpriced";
      deviation: number;
    }> = [];
    for (const [cwd, project] of Object.entries(claudeJson.projects ?? {})) {
      for (const [model, official] of Object.entries(project.lastModelUsage ?? {})) {
        const officialUsd = official.costUSD ?? 0;
        if (officialUsd <= 0) continue;
        // settings model names may carry the [1m] suffix; strip to the API name
        const base = model.endsWith("[1m]") ? model.slice(0, -"[1m]".length) : model;
        const shared = {
          model: base,
          contextTier: "default" as const,
          input: official.inputTokens ?? 0,
          output: official.outputTokens ?? 0,
          cacheRead: official.cacheReadInputTokens ?? 0,
          webSearch: official.webSearchRequests ?? 0,
        };
        const cacheCreation = official.cacheCreationInputTokens ?? 0;
        const low = priceEvent(table, { ...shared, cacheW5m: cacheCreation, cacheW1h: 0 });
        const high = priceEvent(table, { ...shared, cacheW5m: 0, cacheW1h: cacheCreation });
        if (low === null || high === null) {
          rows.push({ cwd, model: base, officialUsd, oursLowUsd: 0, oursHighUsd: 0, status: "unpriced", deviation: 0 });
          continue;
        }
        const lowBound = low * (1 - TOLERANCE);
        const highBound = high * (1 + TOLERANCE);
        const inBand = officialUsd >= lowBound && officialUsd <= highBound;
        const deviation = inBand
          ? 0
          : officialUsd < lowBound
            ? (lowBound - officialUsd) / officialUsd
            : (officialUsd - highBound) / officialUsd;
        rows.push({
          cwd,
          model: base,
          officialUsd,
          oursLowUsd: low,
          oursHighUsd: high,
          status: inBand ? "ok" : "mismatch",
          deviation,
        });
      }
    }
    rows.sort((a, b) => b.officialUsd - a.officialUsd);
    return Response.json({ rows });
  });
}
