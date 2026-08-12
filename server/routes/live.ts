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
    // pre-per-profile snapshots lived under one global key; whichever carries
    // the newer timestamp wins (re-indexing old files can write an older
    // snapshot under the new key)
    const keys = [`codex_rate_limits:${profileId}`, ...(profileId === "default" ? ["codex_rate_limits"] : [])];
    const candidates = keys
      .map((k) => db.prepare("SELECT value FROM meta WHERE key = $k").get({ $k: k }) as { value: string } | null)
      .filter((r): r is { value: string } => r !== null);
    const row = candidates.sort(
      (a, b) => (JSON.parse(b.value) as { ts: number }).ts - (JSON.parse(a.value) as { ts: number }).ts,
    )[0];
    if (!row) return Response.json({ status: "no_data" });
    interface RawWindow {
      used_percent?: number;
      window_minutes?: number;
      resets_at?: number;
    }
    const parsed = JSON.parse(row.value) as {
      ts: number;
      limits: { primary?: RawWindow | null; secondary?: RawWindow | null };
    };
    const shape = (w: RawWindow) => ({
      utilization: w.used_percent as number,
      resetsAt: typeof w.resets_at === "number" ? new Date(w.resets_at * 1000).toISOString() : null,
    });
    // Classify by window length, not by position: OpenAI has (for now) dropped
    // the 5-hour window entirely, so "primary" currently IS the weekly window
    // (window_minutes 10080) — labeling by slot would call it 5-hour.
    let fiveHour: ReturnType<typeof shape> | null = null;
    let sevenDay: ReturnType<typeof shape> | null = null;
    for (const w of [parsed.limits.primary, parsed.limits.secondary]) {
      if (!w || typeof w.used_percent !== "number") continue;
      if ((w.window_minutes ?? 0) >= 1440) {
        sevenDay ??= shape(w);
      } else {
        fiveHour ??= shape(w);
      }
    }
    return Response.json({
      status: "ok",
      asOf: parsed.ts,
      quota: { fiveHour, sevenDay, sevenDayOpus: null, sevenDaySonnet: null, extraUsage: null },
    });
  });
}
