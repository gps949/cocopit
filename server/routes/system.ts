import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadAuthConfig, requiresLocalPeer } from "../auth";
import { listLiveSessions } from "../cc/liveSessions";
import { loadConfig } from "../config";
import type { Router } from "../http/router";
import { updateSelfConfig, type SelfConfigPatch } from "../selfConfig";
import { executeCleanup, scanDisk, type CategoryId } from "../system/disk";

const VALID_CATEGORIES = new Set<CategoryId>([
  "debug",
  "file-history",
  "session-env",
  "plugin-temp",
  "shell-snapshots",
  "todos",
]);

/** Claude Code's own retention setting is the sensible default window. */
function defaultRetentionDays(claudeDir: string): number {
  const path = join(claudeDir, "settings.json");
  if (!existsSync(path)) return 30;
  try {
    const settings = JSON.parse(readFileSync(path, "utf8")) as { cleanupPeriodDays?: number };
    return typeof settings.cleanupPeriodDays === "number" ? settings.cleanupPeriodDays : 30;
  } catch {
    return 30;
  }
}

function activeSessionIds(claudeDir: string): string[] {
  return listLiveSessions(claudeDir)
    .filter((session) => session.alive)
    .map((session) => session.sessionId);
}

/**
 * `running*` are what the listener actually bound, so the UI can tell the user
 * a saved change needs a restart instead of silently doing nothing.
 */
export function registerSystemRoutes(
  router: Router,
  claudeDir: string,
  runningHostInit: string,
  runningPortInit: number,
  isLocal: (req: Request) => boolean = () => true,
  rebind?: (hostname: string, port: number) => Promise<{ ok: boolean; error?: string }>,
): void {
  let runningHost = runningHostInit;
  let runningPort = runningPortInit;

  router.register("GET", "/api/system/config", () => {
    const config = loadConfig();
    return Response.json({
      port: config.port,
      host: config.host,
      allowedOrigins: config.allowedOrigins ?? [],
      tokenConfigured: loadAuthConfig().enabled,
      // the running listener, which differs from `host` until a restart
      boundHost: runningHost,
    });
  });

  router.register("PATCH", "/api/system/config", async (req) => {
    const auth = loadAuthConfig();
    if (requiresLocalPeer(auth) && !isLocal(req)) {
      return Response.json({ error: "网络设置只能在服务器本机修改,或先设置访问令牌" }, { status: 403 });
    }

    let patch: SelfConfigPatch;
    try {
      patch = (await req.json()) as SelfConfigPatch;
    } catch {
      return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
    }
    try {
      const next = updateSelfConfig(patch, auth.enabled);

      // allowedOrigins is read per request, so only the listener address needs
      // applying — and it can be moved in place rather than asking someone to
      // go restart the process on a machine they may not be sitting at
      let moved = false;
      let moveError: string | undefined;
      if (rebind && (next.host !== runningHost || next.port !== runningPort)) {
        const result = await rebind(next.host, next.port);
        moved = result.ok;
        moveError = result.error;
        if (result.ok) {
          runningHost = next.host;
          runningPort = next.port;
        }
      }

      return Response.json({
        port: next.port,
        host: next.host,
        allowedOrigins: next.allowedOrigins ?? [],
        applied: moved || (next.host === runningHost && next.port === runningPort),
        rebindError: moveError,
      });
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 400 });
    }
  });

  router.register("GET", "/api/system/disk", () => {
    return Response.json({
      ...scanDisk(claudeDir),
      retentionDays: defaultRetentionDays(claudeDir),
      activeSessionIds: activeSessionIds(claudeDir),
    });
  });

  router.register("POST", "/api/system/cleanup", async (req) => {
    let body: { categories?: string[]; retentionDays?: number; dryRun?: boolean };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }

    const categories = (body.categories ?? []).filter((c): c is CategoryId =>
      VALID_CATEGORIES.has(c as CategoryId),
    );
    if (categories.length === 0) {
      return Response.json({ error: "categories 必须包含至少一个可清理类别" }, { status: 400 });
    }

    const retentionDays = Math.max(
      0,
      Number(body.retentionDays ?? defaultRetentionDays(claudeDir)) || 0,
    );
    // default to a preview: deleting requires asking for it explicitly
    const dryRun = body.dryRun !== false;

    const result = executeCleanup(claudeDir, {
      categories,
      retentionDays,
      activeSessionIds: activeSessionIds(claudeDir),
      dryRun,
    });
    return Response.json(result);
  });
}
