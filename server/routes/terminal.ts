import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { materializeSnapshot } from "../cc/snapshots";
import { handOffSession } from "../cc/handoff";
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

/** A preset name becomes a file the CLI can be pointed at, or nothing. */
function settingsFileFor(preset: string | undefined): string | null {
  if (!preset) return null;
  return materializeSnapshot(preset);
}

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

    let body: {
      sessionId?: string;
      projectId?: number;
      /** an absolute directory, for starting somewhere with no sessions yet */
      cwd?: string;
      createDir?: boolean;
      profileId?: string;
      settingsPreset?: string;
      cols?: number;
      rows?: number;
    };
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

      const owner = profiles.find((p) => p.id === row.profileId) ?? profiles[0]!;
      let profile = owner;
      let resumeId = row.id;

      // Continuing under another account: --resume only looks under its own
      // config directory, so the transcript is copied there first, under a new
      // id (session ids are the index's primary key). Message uuids are kept,
      // which is what lets the console show where the copy came from.
      if (body.profileId && body.profileId !== owner.id) {
        const chosen = profiles.find((p) => p.id === body.profileId);
        if (!chosen) return Response.json({ error: "profile not found" }, { status: 404 });
        if (!chosen.configDir) {
          return Response.json(
            { error: "目标 profile 没有独立配置目录,无法在其下继续会话" },
            { status: 409 },
          );
        }
        const file = db.prepare("SELECT file_path AS filePath FROM sessions WHERE id = $id").get({
          $id: row.id,
        }) as { filePath: string } | null;
        if (!file) return Response.json({ error: "session not found" }, { status: 404 });
        resumeId = randomUUID();
        try {
          await handOffSession({
            sourceFile: file.filePath,
            targetConfigDir: chosen.configDir,
            cwd: row.cwd,
            newSessionId: resumeId,
          });
        } catch (err) {
          return Response.json({ error: `移交失败: ${(err as Error).message}` }, { status: 409 });
        }
        profile = chosen;
      }

      command = buildResumeCommand({
        cwd: row.cwd,
        sessionId: resumeId,
        configDir: profile.configDir ?? null,
      });
      target = {
        name: sessionNameFor(resumeId),
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

      // a new session may be started under any profile — nothing ties it to the
      // one that happens to own the project's past sessions
      const wanted = body.profileId ? profiles.find((p) => p.id === body.profileId) : undefined;
      if (body.profileId && !wanted) return Response.json({ error: "profile not found" }, { status: 404 });
      const profile = wanted ?? profiles.find((p) => p.id === project.profileId) ?? profiles[0]!;
      command = buildNewSessionCommand({
        cwd: project.cwd,
        configDir: profile.configDir ?? null,
        settingsFile: settingsFileFor(body.settingsPreset),
      });
      target = {
        name: sessionNameFor(`proj-${project.id}-${Date.now()}`),
        title: `新会话 · ${project.cwd.split("/").at(-1)}`,
        cwd: project.cwd,
        kind: "new",
      };
    } else if (body.cwd) {
      // Starting somewhere Claude Code has never run: there is no project row
      // yet — one appears on its own once the session writes its first record.
      const cwd = body.cwd.trim();
      if (!isAbsolute(cwd)) return Response.json({ error: "目录必须是绝对路径" }, { status: 400 });
      if (!existsSync(cwd)) {
        if (!body.createDir) {
          return Response.json({ error: "目录不存在", canCreate: true }, { status: 404 });
        }
        try {
          mkdirSync(cwd, { recursive: true });
        } catch (err) {
          return Response.json({ error: `无法创建目录: ${(err as Error).message}` }, { status: 409 });
        }
      } else if (!statSync(cwd).isDirectory()) {
        return Response.json({ error: "该路径不是目录" }, { status: 400 });
      }

      const profile = body.profileId ? profiles.find((p) => p.id === body.profileId) : profiles[0];
      if (!profile) return Response.json({ error: "profile not found" }, { status: 404 });
      command = buildNewSessionCommand({
        cwd,
        configDir: profile.configDir ?? null,
        settingsFile: settingsFileFor(body.settingsPreset),
      });
      target = {
        name: sessionNameFor(`dir-${Date.now()}`),
        title: `新会话 · ${cwd.split("/").at(-1)}`,
        cwd,
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
      return Response.json({ error: "only cocopit terminals can be closed here" }, { status: 400 });
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
