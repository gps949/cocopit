import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileStamp, safeWriteJson } from "../writeops/safeWrite";

/**
 * Turns a plugin on or off.
 *
 * This is a settings.json edit and nothing more: `enabledPlugins` is a plain map
 * in that file, which is already on the write allowlist and goes through the
 * usual backup, compare-and-swap and atomic replace. MCP servers are the ones
 * that would need ~/.claude.json — treating the two as equally untouchable was
 * an overcorrection.
 *
 * The whole settings object is rewritten, so an unparseable file is refused
 * rather than replaced: overwriting it would silently drop every other setting.
 */
export function setPluginEnabled(
  configDir: string,
  plugin: string,
  enabled: boolean,
): { backupId: string | null } {
  const path = join(configDir, "settings.json");

  let settings: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      settings = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    } catch (err) {
      throw new Error(`settings.json 无法解析,拒绝覆盖:${(err as Error).message}`);
    }
    if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
      throw new Error("settings.json 不是一个 JSON 对象,拒绝覆盖");
    }
  }

  // Disabling drops the key rather than writing false: the real settings.json
  // holds only `true` entries, so that is how Claude Code itself records it, and
  // matching keeps the file looking like the CLI wrote it.
  const current = { ...((settings.enabledPlugins ?? {}) as Record<string, boolean>) };
  if (enabled) current[plugin] = true;
  else delete current[plugin];
  const next = { ...settings, enabledPlugins: current };

  const result = safeWriteJson({
    path,
    claudeDir: configDir,
    value: next,
    expected: fileStamp(path),
    slug: "user-settings",
  });
  return { backupId: result.backup?.id ?? null };
}
