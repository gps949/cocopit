import type { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listLiveSessions } from "../cc/liveSessions";
import type { Router } from "../http/router";
import { readExtensions } from "../cc/extensions";
import { setPluginEnabled } from "../cc/pluginToggle";
import { loadProfiles, resolveConfigDir } from "../profiles/registry";
import { listBackups, restoreBackup } from "../writeops/backup";
import { fileStamp, safeWriteJson, WriteConflictError, type FileStamp } from "../writeops/safeWrite";

type Scope = "user" | "project";

interface TargetResolution {
  path: string;
  slug: string;
}

function resolveTarget(
  db: Database,
  claudeDir: string,
  kind: "settings" | "mcp",
  scope: Scope,
  projectId: string | null,
): TargetResolution | { error: string; status: number } {
  if (kind === "settings" && scope === "user") {
    return { path: join(claudeDir, "settings.json"), slug: "user-settings" };
  }
  if (!projectId) return { error: "project scope 需要 project 参数", status: 400 };

  const project = db
    .prepare("SELECT cwd FROM projects WHERE id = $id")
    .get({ $id: Number(projectId) }) as { cwd: string | null } | null;
  if (!project) return { error: "project not found", status: 404 };
  if (!project.cwd) return { error: "该项目没有记录 cwd", status: 409 };

  return kind === "mcp"
    ? { path: join(project.cwd, ".mcp.json"), slug: "project-mcp" }
    : { path: join(project.cwd, ".claude", "settings.local.json"), slug: "project-settings" };
}

function readJsonFile(path: string): unknown {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`${path} 不是合法 JSON:${(err as Error).message}`);
  }
}

/** Light shape checks — enough to stop a malformed write reaching Claude Code. */
function validateSettings(content: unknown): string | null {
  if (typeof content !== "object" || content === null || Array.isArray(content)) {
    return "内容必须是 JSON 对象";
  }
  const record = content as Record<string, unknown>;
  for (const key of ["model", "cleanupPeriodDays", "includeCoAuthoredBy"] as const) {
    if (key in record && record[key] === null) return `${key} 不能为 null`;
  }
  if ("env" in record && (typeof record.env !== "object" || record.env === null || Array.isArray(record.env))) {
    return "env 必须是对象";
  }
  const permissions = record.permissions;
  if (permissions !== undefined) {
    if (typeof permissions !== "object" || permissions === null || Array.isArray(permissions)) {
      return "permissions 必须是对象";
    }
    for (const key of ["allow", "deny", "ask"] as const) {
      const value = (permissions as Record<string, unknown>)[key];
      if (value !== undefined && (!Array.isArray(value) || value.some((v) => typeof v !== "string"))) {
        return `permissions.${key} 必须是字符串数组`;
      }
    }
  }
  if ("enabledPlugins" in record) {
    const plugins = record.enabledPlugins;
    if (typeof plugins !== "object" || plugins === null || Array.isArray(plugins)) {
      return "enabledPlugins 必须是对象";
    }
  }
  return null;
}

/** Sessions still running under this config dir — writes may be overwritten on exit. */
function activeSessionsFor(claudeDir: string): Array<{ pid: number; sessionId: string; cwd: string }> {
  return listLiveSessions(claudeDir)
    .filter((session) => session.alive)
    .map(({ pid, sessionId, cwd }) => ({ pid, sessionId, cwd }));
}

export function registerConfigRoutes(router: Router, db: Database, claudeDir: string): void {
  /**
   * MCP servers, plugins and skills, read-only. Grouped per profile because all
   * three live under a config directory — a profile with its own directory has
   * its own set.
   */
  router.register("GET", "/api/extensions", () => {
    const profiles = loadProfiles().map((profile) => {
      const dir = resolveConfigDir(profile);
      // the default profile's config file sits beside its data directory
      const jsonPath = profile.configDir ? join(profile.configDir, ".claude.json") : `${dir}.json`;
      return { profileId: profile.id, name: profile.name, configDir: dir, ...readExtensions(dir, jsonPath) };
    });
    return Response.json({ profiles });
  });

  /**
   * Enabling a plugin writes settings.json — the same allowlisted path, backup
   * and CAS as every other config edit here. MCP servers are not writable the
   * same way: theirs live in ~/.claude.json, which stays read-only.
   */
  router.register("POST", "/api/extensions/plugin", async (req) => {
    let body: { profileId?: string; plugin?: string; enabled?: boolean };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
    }
    if (!body.plugin || typeof body.enabled !== "boolean") {
      return Response.json({ error: "缺少 plugin 或 enabled" }, { status: 400 });
    }
    const profile = loadProfiles().find((p) => p.id === (body.profileId ?? "default"));
    if (!profile) return Response.json({ error: "profile not found" }, { status: 404 });
    try {
      const result = setPluginEnabled(resolveConfigDir(profile), body.plugin, body.enabled);
      return Response.json({ ok: true, backupId: result.backupId });
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 409 });
    }
  });

  for (const kind of ["settings", "mcp"] as const) {
    router.register("GET", `/api/config/${kind}`, (req) => {
      const url = new URL(req.url);
      const scope = (url.searchParams.get("scope") as Scope) ?? (kind === "mcp" ? "project" : "user");
      const resolved = resolveTarget(db, claudeDir, kind, scope, url.searchParams.get("project"));
      if ("error" in resolved) return Response.json({ error: resolved.error }, { status: resolved.status });

      try {
        return Response.json({
          path: resolved.path,
          scope,
          content: readJsonFile(resolved.path),
          stamp: fileStamp(resolved.path),
          activeSessions: activeSessionsFor(claudeDir),
        });
      } catch (err) {
        return Response.json({ error: (err as Error).message }, { status: 422 });
      }
    });

    router.register("PUT", `/api/config/${kind}`, async (req) => {
      const url = new URL(req.url);
      const scope = (url.searchParams.get("scope") as Scope) ?? (kind === "mcp" ? "project" : "user");
      const resolved = resolveTarget(db, claudeDir, kind, scope, url.searchParams.get("project"));
      if ("error" in resolved) return Response.json({ error: resolved.error }, { status: resolved.status });

      let body: { content?: unknown; stamp?: FileStamp };
      try {
        body = (await req.json()) as typeof body;
      } catch {
        return Response.json({ error: "invalid JSON body" }, { status: 400 });
      }
      if (!body.stamp || typeof body.stamp.exists !== "boolean") {
        return Response.json({ error: "缺少 stamp(先 GET 再 PUT)" }, { status: 400 });
      }
      const invalid = validateSettings(body.content);
      if (invalid) return Response.json({ error: invalid }, { status: 400 });

      try {
        const result = safeWriteJson({
          path: resolved.path,
          claudeDir,
          value: body.content,
          expected: body.stamp,
          slug: resolved.slug,
        });
        return Response.json({
          path: resolved.path,
          stamp: result.stamp,
          backupId: result.backup?.id ?? null,
          activeSessions: activeSessionsFor(claudeDir),
        });
      } catch (err) {
        if (err instanceof WriteConflictError) {
          return Response.json({ error: err.message, current: err.current }, { status: 409 });
        }
        return Response.json({ error: (err as Error).message }, { status: 400 });
      }
    });
  }

  router.register("GET", "/api/config/permissions", (req) => {
    const url = new URL(req.url);
    const userPath = join(claudeDir, "settings.json");
    const empty = { allow: [] as string[], deny: [] as string[], ask: [] as string[] };
    const read = (path: string) => {
      try {
        const content = readJsonFile(path) as { permissions?: Record<string, string[]> };
        return { ...empty, ...(content.permissions ?? {}) };
      } catch {
        return { ...empty };
      }
    };

    const projectId = url.searchParams.get("project");
    let projectPath: string | null = null;
    if (projectId) {
      const resolved = resolveTarget(db, claudeDir, "settings", "project", projectId);
      if (!("error" in resolved)) projectPath = resolved.path;
    }

    return Response.json({
      user: { ...read(userPath), path: userPath },
      project: projectPath ? { ...read(projectPath), path: projectPath } : { ...empty, path: null },
    });
  });

  router.register("GET", "/api/backups", () => {
    return Response.json({ backups: listBackups() });
  });

  router.register("POST", "/api/backups/:id/restore", (_req, params) => {
    try {
      const result = restoreBackup(params.id!, claudeDir);
      return Response.json({
        restored: result.restored,
        backupOfCurrent: result.backupOfCurrent,
      });
    } catch (err) {
      const message = (err as Error).message;
      const status = message.includes("not found") ? 404 : 400;
      return Response.json({ error: message }, { status });
    }
  });
}
