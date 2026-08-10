import type { Database } from "bun:sqlite";
import { importPromptHistory } from "../cc/history";
import { listLiveSessions } from "../cc/liveSessions";
import type { Router } from "../http/router";

export function registerLiveRoutes(router: Router, db: Database, claudeDir: string): void {
  router.register("GET", "/api/live", () => {
    return Response.json({ sessions: listLiveSessions(claudeDir) });
  });

  router.register("GET", "/api/history", (req) => {
    // history.jsonl only ever grows; catch up before serving
    importPromptHistory(db, claudeDir);

    const url = new URL(req.url);
    const q = url.searchParams.get("q");
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 500);
    const clauses: string[] = [];
    const params: Record<string, string | number> = { $limit: limit };
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
}
