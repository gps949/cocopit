import type { Database } from "bun:sqlite";
import { importCodexPromptHistory, importPromptHistory } from "../cc/history";
import { listLiveSessions } from "../cc/liveSessions";
import type { Router } from "../http/router";

export function registerLiveRoutes(router: Router, db: Database, claudeDir: string, codexDir?: string): void {
  router.register("GET", "/api/live", () => {
    return Response.json({ sessions: listLiveSessions(claudeDir) });
  });

  router.register("GET", "/api/history", (req) => {
    const url = new URL(req.url);
    const product = url.searchParams.get("product") ?? "claude";
    // history files only ever grow; catch up before serving
    if (product === "codex") {
      if (codexDir) importCodexPromptHistory(db, codexDir);
    } else {
      importPromptHistory(db, claudeDir);
    }

    const q = url.searchParams.get("q");
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 500);
    const clauses: string[] = ["product = $product"];
    const params: Record<string, string | number> = { $limit: limit, $product: product };
    if (q) {
      clauses.push("display LIKE $q");
      params.$q = `%${q}%`;
    }
    const project = url.searchParams.get("project");
    if (project) {
      clauses.push("project = $project");
      params.$project = project;
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const entries = db
      .prepare(
        `SELECT ts AS timestamp, project, session_id AS sessionId, display
         FROM prompt_history ${where} ORDER BY ts DESC LIMIT $limit`,
      )
      .all(params);
    return Response.json({ entries });
  });

  // Codex writes its rate-limit state into every token_count event, so the
  // freshest snapshot falls out of indexing — no credentials, no API call.
  router.register("GET", "/api/codex/quota", (req) => {
    const profileId = new URL(req.url).searchParams.get("profileId") ?? "default";
    const row = (db
      .prepare("SELECT value FROM meta WHERE key = $k")
      .get({ $k: `codex_rate_limits:${profileId}` }) ??
      // pre-per-profile snapshots lived under one global key
      (profileId === "default"
        ? db.prepare("SELECT value FROM meta WHERE key = 'codex_rate_limits'").get()
        : null)) as { value: string } | null;
    if (!row) return Response.json({ status: "no_data" });
    const parsed = JSON.parse(row.value) as {
      ts: number;
      limits: {
        primary?: { used_percent?: number; window_minutes?: number; resets_at?: number };
        secondary?: { used_percent?: number; window_minutes?: number; resets_at?: number };
      };
    };
    const window = (w?: { used_percent?: number; resets_at?: number }) =>
      w && typeof w.used_percent === "number"
        ? {
            utilization: w.used_percent,
            resetsAt: typeof w.resets_at === "number" ? new Date(w.resets_at * 1000).toISOString() : null,
          }
        : null;
    return Response.json({
      status: "ok",
      asOf: parsed.ts,
      quota: {
        fiveHour: window(parsed.limits.primary),
        sevenDay: window(parsed.limits.secondary),
        sevenDayOpus: null,
        sevenDaySonnet: null,
        extraUsage: null,
      },
    });
  });
}
