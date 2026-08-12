import type { Database } from "bun:sqlite";
import { existsSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { setCodexPluginEnabled } from "../cc/codexToggle";
import { listLiveSessions } from "../cc/liveSessions";
import type { Router } from "../http/router";
import { readCodexExtensions, readExtensions } from "../cc/extensions";
import { loadConfig } from "../config";
import { createBackup } from "../writeops/backup";
import { atomicWrite } from "../writeops/safeWrite";

/** CODEX_HOME for a profile id: the machine default or a registered codex profile. */
function codexHomeFor(profileId: string): string | null {
  if (profileId === "default") return loadConfig().codexDir;
  const profile = loadProfiles().find((p) => p.id === profileId && p.product === "codex");
  return profile?.configDir ?? null;
}
import { setPluginEnabled } from "../cc/pluginToggle";
import {
  applySnapshot,
  captureSnapshot,
  deleteSnapshot,
  listSnapshots,
  snapshotDiff,
} from "../cc/snapshots";
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
  router.register("GET", "/api/extensions", (req) => {
    const product = new URL(req.url).searchParams.get("product") ?? "claude";
    if (product === "codex") {
      const codexDir = loadConfig().codexDir;
      const entries = [
        { profileId: "default", name: "默认账号", dir: codexDir },
        ...loadProfiles()
          .filter((p) => p.product === "codex" && p.configDir)
          .map((p) => ({ profileId: p.id, name: p.name, dir: p.configDir! })),
      ];
      const profiles = entries.map((entry) => ({
        profileId: entry.profileId,
        name: entry.name,
        configDir: entry.dir,
        ...readCodexExtensions(entry.dir),
      }));
      return Response.json({ profiles });
    }
    const profiles = loadProfiles()
      .filter((p) => p.product !== "codex")
      .map((profile) => {
        const dir = resolveConfigDir(profile);
        // the default profile's config file sits beside its data directory
        const jsonPath = profile.configDir ? join(profile.configDir, ".claude.json") : `${dir}.json`;
        return { profileId: profile.id, name: profile.name, configDir: dir, ...readExtensions(dir, jsonPath) };
      });
    return Response.json({ profiles });
  });

  /**
   * Codex configuration, read-only: config.toml with secret-looking values
   * masked, plus the named config profiles (<name>.config.toml) that
   * `codex --profile` overlays — Codex's own preset mechanism.
   */
  router.register("GET", "/api/codex/config", () => {
    const codexDir = loadConfig().codexDir;
    const configPath = join(codexDir, "config.toml");
    let content: string | null = null;
    if (existsSync(configPath)) {
      // mask values whose keys look like credentials — the raw file carries
      // MCP server API keys in env tables
      content = readFileSync(configPath, "utf8").replace(
        /^(\s*[\w-]*(?:key|token|secret|password)[\w-]*\s*=\s*)"[^"]*"/gim,
        '$1"****"',
      );
    }
    const profiles: string[] = [];
    for (const entry of existsSync(codexDir) ? readdirSync(codexDir) : []) {
      const match = /^(.+)\.config\.toml$/.exec(entry);
      if (match) profiles.push(match[1]!);
    }
    return Response.json({ path: configPath, content, profiles });
  });

  /**
   * Named copies of a settings file. Settings and the account both live under a
   * config directory but are not tied together, so switching posture should not
   * mean keeping a second login.
   */
  router.register("GET", "/api/snapshots", (req) => {
    const url = new URL(req.url);
    const target = url.searchParams.get("target") ?? join(claudeDir, "settings.json");
    let current: Record<string, unknown> = {};
    try {
      current = JSON.parse(readFileSync(target, "utf8")) as Record<string, unknown>;
    } catch {
      // no settings yet, or unreadable — every snapshot then reads as all-added
    }
    const snapshots = listSnapshots().map((snapshot) => ({
      name: snapshot.name,
      createdAt: snapshot.createdAt,
      sourcePath: snapshot.sourcePath,
      keys: Object.keys(snapshot.settings).length,
      diff: snapshotDiff(snapshot.settings, current),
    }));
    return Response.json({ snapshots, target });
  });

  router.register("POST", "/api/snapshots", async (req) => {
    let body: { name?: string; target?: string; action?: "apply" | "delete" };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
    }
    if (!body.name) return Response.json({ error: "缺少 name" }, { status: 400 });
    const target = body.target ?? join(claudeDir, "settings.json");

    try {
      if (body.action === "delete") {
        deleteSnapshot(body.name);
        return Response.json({ ok: true });
      }
      if (body.action === "apply") {
        const result = applySnapshot(body.name, target, claudeDir);
        return Response.json({ ok: true, backupId: result.backupId, activeSessions: activeSessionsFor(claudeDir) });
      }
      const snapshot = captureSnapshot(body.name, target);
      return Response.json({ ok: true, name: snapshot.name, keys: Object.keys(snapshot.settings).length });
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 409 });
    }
  });

  /**
   * Enabling a plugin writes settings.json — the same allowlisted path, backup
   * and CAS as every other config edit here. MCP servers are not writable the
   * same way: theirs live in ~/.claude.json, which stays read-only.
   */
  router.register("POST", "/api/extensions/plugin", async (req) => {
    let body: { profileId?: string; plugin?: string; enabled?: boolean; product?: string };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
    }
    if (!body.plugin || typeof body.enabled !== "boolean") {
      return Response.json({ error: "缺少 plugin 或 enabled" }, { status: 400 });
    }
    try {
      if (body.product === "codex") {
        const home = codexHomeFor(body.profileId ?? "default");
        if (!home) return Response.json({ error: "profile not found" }, { status: 404 });
        const result = setCodexPluginEnabled(home, body.plugin, body.enabled);
        return Response.json({ ok: true, backupId: result.backupId });
      }
      const profile = loadProfiles().find((p) => p.id === (body.profileId ?? "default"));
      if (!profile) return Response.json({ error: "profile not found" }, { status: 404 });
      const result = setPluginEnabled(resolveConfigDir(profile), body.plugin, body.enabled);
      return Response.json({ ok: true, backupId: result.backupId });
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 409 });
    }
  });

  /**
   * Codex config profiles (<name>.config.toml, overlaid by `codex --profile`)
   * get the full lifecycle: they are opt-in overlay files, so a bad edit only
   * affects sessions that explicitly ask for that profile — a much smaller
   * blast radius than config.toml itself, which stays read-only. Writes
   * validate as TOML first and are preceded by a backup.
   */
  router.register("GET", "/api/codex/profiles", () => {
    const codexDir = loadConfig().codexDir;
    const profiles: Array<{ name: string; content: string }> = [];
    for (const entry of existsSync(codexDir) ? readdirSync(codexDir) : []) {
      const match = /^(.+)\.config\.toml$/.exec(entry);
      if (!match) continue;
      try {
        profiles.push({ name: match[1]!, content: readFileSync(join(codexDir, entry), "utf8") });
      } catch {
        // unreadable file: skip rather than break the page
      }
    }
    return Response.json({ profiles });
  });

  router.register("PUT", "/api/codex/profiles/:name", async (req, params) => {
    const name = params.name!;
    if (!/^[A-Za-z0-9_-]+$/.test(name)) {
      return Response.json({ error: "方案名只能包含字母、数字、连字符和下划线" }, { status: 400 });
    }
    let body: { content?: string };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
    }
    const content = body.content ?? "";
    try {
      Bun.TOML.parse(content);
    } catch (err) {
      return Response.json({ error: `TOML 语法错误:${(err as Error).message}` }, { status: 422 });
    }
    const path = join(loadConfig().codexDir, `${name}.config.toml`);
    const backup = existsSync(path) ? createBackup(path, `codex-profile-${name}`) : null;
    atomicWrite(path, content.endsWith("\n") || content === "" ? content : `${content}\n`);
    return Response.json({ ok: true, backupId: backup?.id ?? null });
  });

  router.register("DELETE", "/api/codex/profiles/:name", (_req, params) => {
    const name = params.name!;
    if (!/^[A-Za-z0-9_-]+$/.test(name)) {
      return Response.json({ error: "方案名不合法" }, { status: 400 });
    }
    const path = join(loadConfig().codexDir, `${name}.config.toml`);
    if (!existsSync(path)) return Response.json({ error: "not found" }, { status: 404 });
    // deletion is recoverable: the content survives as a backup
    createBackup(path, `codex-profile-${name}`);
    unlinkSync(path);
    return Response.json({ deleted: name });
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

  /**
   * A backup's contents, and what restoring it would change.
   *
   * A list of timestamps says nothing about which one you want. The restore
   * itself is a byte copy of a whole file, so nothing in the mechanism goes
   * stale — but the contents can: a `model` that no longer exists, plugin names
   * since uninstalled. Showing the diff is what makes that visible beforehand.
   */
  router.register("GET", "/api/backups/:id", (_req, params) => {
    const entry = listBackups().find((candidate) => candidate.id === params.id);
    if (!entry) return Response.json({ error: "not found" }, { status: 404 });

    let stored: Record<string, unknown> = {};
    let current: Record<string, unknown> = {};
    let unreadable: string | null = null;
    try {
      stored = JSON.parse(readFileSync(entry.storedPath, "utf8")) as Record<string, unknown>;
    } catch (err) {
      unreadable = (err as Error).message;
    }
    try {
      current = JSON.parse(readFileSync(entry.originPath, "utf8")) as Record<string, unknown>;
    } catch {
      // the original may not exist any more; every key then reads as added
    }

    return Response.json({
      ...entry,
      settings: stored,
      unreadable,
      // what restoring would do to the file as it stands now
      diff: snapshotDiff(stored, current),
    });
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
