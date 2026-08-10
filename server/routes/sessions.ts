import type { Database } from "bun:sqlite";
import { readMessageRecords, type MessagePointer } from "../cc/sessionReader";
import type { Router } from "../http/router";

/** trigram FTS needs ≥3 chars; quote to neutralize MATCH syntax. */
function ftsQuery(q: string): string | null {
  const trimmed = q.trim();
  if ([...trimmed].length < 3) return null;
  return `"${trimmed.replace(/"/g, '""')}"`;
}

interface SessionRow {
  id: string;
  project_id: number;
  file_path: string;
  first_ts: number | null;
  last_ts: number | null;
  title: string | null;
  slug: string | null;
  git_branch: string | null;
  cc_version: string | null;
  line_count: number;
  user_msg_count: number;
  assistant_msg_count: number;
  models: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  cost_usd: number | null;
  subagent_count: number;
  cwd: string | null;
  dir_name: string;
  profile_id: string;
}

function toSummary(row: SessionRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    cwd: row.cwd,
    dirName: row.dir_name,
    profileId: row.profile_id,
    title: row.title,
    slug: row.slug,
    gitBranch: row.git_branch,
    ccVersion: row.cc_version,
    firstTs: row.first_ts,
    lastTs: row.last_ts,
    lineCount: row.line_count,
    userMsgCount: row.user_msg_count,
    assistantMsgCount: row.assistant_msg_count,
    models: row.models ? (JSON.parse(row.models) as string[]) : [],
    tokens: {
      input: row.input_tokens,
      output: row.output_tokens,
      cacheCreation: row.cache_creation_tokens,
      cacheRead: row.cache_read_tokens,
    },
    costUsd: row.cost_usd,
    subagentCount: row.subagent_count,
  };
}

const SESSION_SELECT = `
  SELECT s.*, p.cwd, p.dir_name, p.profile_id
  FROM sessions s JOIN projects p ON p.id = s.project_id`;

export function registerSessionRoutes(router: Router, db: Database): void {
  router.register("GET", "/api/projects", () => {
    const projects = db
      .prepare(
        `SELECT p.id, p.profile_id AS profileId, p.dir_name AS dirName, p.cwd,
                p.first_ts AS firstTs, p.last_ts AS lastTs,
                COUNT(s.id) AS sessionCount,
                COALESCE(SUM(s.cost_usd), 0) AS costUsd,
                MAX(s.last_ts) AS lastSessionTs
         FROM projects p LEFT JOIN sessions s ON s.project_id = p.id
         GROUP BY p.id ORDER BY lastSessionTs DESC`,
      )
      .all();
    return Response.json({ projects });
  });

  router.register("GET", "/api/sessions", (req) => {
    const url = new URL(req.url);
    const clauses: string[] = [];
    const params: Record<string, string | number> = {};

    const q = url.searchParams.get("q");
    if (q !== null) {
      const match = ftsQuery(q);
      if (!match) return Response.json({ sessions: [], nextCursor: null, note: "查询至少需要 3 个字符" });
      clauses.push(
        "s.id IN (SELECT DISTINCT session_id FROM fts_messages WHERE fts_messages MATCH $match)",
      );
      params.$match = match;
    }
    const project = url.searchParams.get("project");
    if (project) {
      clauses.push("s.project_id = $project");
      params.$project = Number(project);
    }
    const profileId = url.searchParams.get("profileId");
    if (profileId) {
      clauses.push("p.profile_id = $profileId");
      params.$profileId = profileId;
    }
    const from = url.searchParams.get("from");
    if (from) {
      clauses.push("s.last_ts >= $from");
      params.$from = Number(from);
    }
    const to = url.searchParams.get("to");
    if (to) {
      clauses.push("s.last_ts < $to");
      params.$to = Number(to);
    }
    const cursor = url.searchParams.get("cursor");
    if (cursor) {
      const sep = cursor.lastIndexOf("|");
      clauses.push("(s.last_ts, s.id) < ($cursorTs, $cursorId)");
      params.$cursorTs = Number(cursor.slice(0, sep));
      params.$cursorId = cursor.slice(sep + 1);
    }

    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = db
      .prepare(`${SESSION_SELECT} ${where} ORDER BY s.last_ts DESC, s.id DESC LIMIT $limit`)
      .all({ ...params, $limit: limit + 1 }) as unknown as SessionRow[];

    const page = rows.slice(0, limit);
    const nextCursor =
      rows.length > limit ? `${page[page.length - 1]!.last_ts}|${page[page.length - 1]!.id}` : null;
    return Response.json({ sessions: page.map(toSummary), nextCursor });
  });

  router.register("GET", "/api/sessions/:id", (_req, routeParams) => {
    const row = db
      .prepare(`${SESSION_SELECT} WHERE s.id = $id`)
      .get({ $id: routeParams.id! }) as SessionRow | null;
    if (!row) return Response.json({ error: "not found" }, { status: 404 });
    const subagents = db
      .prepare(
        `SELECT agent_id AS agentId, agent_type AS agentType, description, tool_use_id AS toolUseId,
                spawn_depth AS spawnDepth, file_path AS filePath, cost_usd AS costUsd
         FROM subagents WHERE session_id = $id ORDER BY agent_id`,
      )
      .all({ $id: routeParams.id! });
    return Response.json({ session: toSummary(row), subagents });
  });

  router.register("GET", "/api/sessions/:id/messages", async (req, routeParams) => {
    const session = db
      .prepare("SELECT file_path FROM sessions WHERE id = $id")
      .get({ $id: routeParams.id! }) as { file_path: string } | null;
    if (!session) return Response.json({ error: "not found" }, { status: 404 });

    const url = new URL(req.url);
    const fromSeq = Number(url.searchParams.get("fromSeq") ?? 0);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 200), 500);
    const pointers = db
      .prepare(
        `SELECT seq, uuid, byte_offset, byte_len FROM messages
         WHERE session_id = $id AND seq >= $fromSeq ORDER BY seq LIMIT $limit`,
      )
      .all({ $id: routeParams.id!, $fromSeq: fromSeq, $limit: limit + 1 }) as unknown as MessagePointer[];

    const page = pointers.slice(0, limit);
    const nextFromSeq = pointers.length > limit ? pointers[limit]!.seq : null;
    const messages = await readMessageRecords(session.file_path, page);
    return Response.json({ messages, nextFromSeq });
  });

  router.register("GET", "/api/sessions/:id/messages/:uuid", async (_req, routeParams) => {
    const session = db
      .prepare("SELECT file_path FROM sessions WHERE id = $id")
      .get({ $id: routeParams.id! }) as { file_path: string } | null;
    if (!session) return Response.json({ error: "not found" }, { status: 404 });
    const pointer = db
      .prepare(
        `SELECT seq, uuid, byte_offset, byte_len FROM messages
         WHERE session_id = $id AND uuid = $uuid`,
      )
      .get({ $id: routeParams.id!, $uuid: routeParams.uuid! }) as MessagePointer | null;
    if (!pointer) return Response.json({ error: "message not found" }, { status: 404 });
    const [message] = await readMessageRecords(session.file_path, [pointer]);
    return Response.json(message);
  });
}
