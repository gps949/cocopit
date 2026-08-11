import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listLiveSessions } from "../cc/liveSessions";
import type { Router } from "../http/router";
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

export function registerSystemRoutes(router: Router, claudeDir: string): void {
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
