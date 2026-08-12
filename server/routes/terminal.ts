import type { Database } from "bun:sqlite";
import { loadConfig } from "../config";
import type { Router } from "../http/router";
import { loadProfiles, resolveConfigDir } from "../profiles/registry";
import {
  buildNewSessionCommand,
  buildResumeCommand,
  hasSession,
  killSession,
  listTmuxSessions,
  sessionNameFor,
  startSession,
  tmuxAvailable,
} from "../terminal/tmux";

export interface TerminalTarget {
  name: string;
  title: string;
  cwd: string;
  kind: "resume" | "new";
}

/**
 * Terminals are keyed by tmux session name. The command is always built here
 * from indexed data — the browser picks a session or project, never a command
 * string — so a compromised page cannot turn this into remote code execution.
 */
export function registerTerminalRoutes(router: Router, db: Database): void {
  router.register("GET", "/api/terminal", () => {
    const sessions = listTmuxSessions().filter((s) => s.name.startsWith("cc-"));
    return Response.json({ available: tmuxAvailable(), terminals: sessions });
  });

  router.register("POST", "/api/terminal", async (req) => {
    if (!tmuxAvailable()) {
      return Response.json({ error: "tmux 未安装,Web 终端不可用" }, { status: 503 });
    }

    let body: { sessionId?: string; projectId?: number; cols?: number; rows?: number };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }

    const profiles = loadProfiles();
    const cols = Math.min(Math.max(Number(body.cols) || 120, 20), 500);
    const rows = Math.min(Math.max(Number(body.rows) || 32, 5), 200);

    let target: TerminalTarget;
    let command: string;

    if (body.sessionId) {
      const row = db
        .prepare(
          `SELECT s.id, s.title, p.cwd, p.profile_id AS profileId
           FROM sessions s JOIN projects p ON p.id = s.project_id WHERE s.id = $id`,
        )
        .get({ $id: body.sessionId }) as
        | { id: string; title: string | null; cwd: string | null; profileId: string }
        | null;
      if (!row) return Response.json({ error: "session not found" }, { status: 404 });
      if (!row.cwd) return Response.json({ error: "session has no recorded cwd" }, { status: 409 });

      const profile = profiles.find((p) => p.id === row.profileId) ?? profiles[0]!;
      // resume always runs under the profile that owns the session
      command = buildResumeCommand({
        cwd: row.cwd,
        sessionId: row.id,
        configDir: profile.configDir ?? null,
      });
      target = {
        name: sessionNameFor(row.id),
        title: row.title ?? row.id,
        cwd: row.cwd,
        kind: "resume",
      };
    } else if (body.projectId !== undefined) {
      const project = db
        .prepare("SELECT id, cwd, dir_name AS dirName, profile_id AS profileId FROM projects WHERE id = $id")
        .get({ $id: body.projectId }) as
        | { id: number; cwd: string | null; dirName: string; profileId: string }
        | null;
      if (!project) return Response.json({ error: "project not found" }, { status: 404 });
      if (!project.cwd) return Response.json({ error: "project has no recorded cwd" }, { status: 409 });

      const profile = profiles.find((p) => p.id === project.profileId) ?? profiles[0]!;
      command = buildNewSessionCommand({ cwd: project.cwd, configDir: profile.configDir ?? null });
      target = {
        name: sessionNameFor(`proj-${project.id}-${Date.now()}`),
        title: `新会话 · ${project.cwd.split("/").at(-1)}`,
        cwd: project.cwd,
        kind: "new",
      };
    } else {
      return Response.json({ error: "sessionId or projectId is required" }, { status: 400 });
    }

    const started = startSession({ name: target.name, command, cwd: target.cwd, cols, rows });
    if (!started) {
      return Response.json({ error: "tmux 会话创建失败" }, { status: 500 });
    }
    return Response.json({ ...target, attached: hasSession(target.name) }, { status: 201 });
  });

  router.register("DELETE", "/api/terminal/:name", (_req, params) => {
    const name = params.name!;
    if (!name.startsWith("cc-")) {
      return Response.json({ error: "only ccockpit terminals can be closed here" }, { status: 400 });
    }
    killSession(name);
    return Response.json({ closed: name });
  });
}

/** Origin gate for the WebSocket upgrade — WS is exempt from CORS entirely. */
export function terminalUpgradeAllowed(req: Request, allowedOrigins?: string[]): boolean {
  const origin = req.headers.get("origin");
  // a browser always sends Origin on WS; its absence means a non-browser client
  if (!origin) return true;
  const configured = allowedOrigins ?? loadConfig().allowedOrigins ?? [];
  const normalize = (value: string) => value.trim().replace(/\/+$/, "").toLowerCase();
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (configured.some((allowed) => normalize(allowed) === normalize(parsed.origin))) return true;
  return (
    parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "[::1]"
  );
}
