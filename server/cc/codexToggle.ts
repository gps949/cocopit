import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createBackup } from "../writeops/backup";
import { atomicWrite } from "../writeops/safeWrite";

/**
 * Flips a Codex plugin's enabled flag inside config.toml.
 *
 * config.toml is the CLI's main config, hand-edited and full of comments, so
 * this is a *textual* surgery — locate the plugin's own table, touch only its
 * `enabled` line — never a parse-and-rewrite, which would strip every comment.
 * The result must still parse AND carry the intended state, or nothing is
 * written. Backup precedes the write like every other config mutation.
 */
export function setCodexPluginEnabled(
  codexHome: string,
  plugin: string,
  enabled: boolean,
): { backupId: string | null } {
  const path = join(codexHome, "config.toml");
  if (!existsSync(path)) throw new Error("config.toml 不存在");
  const text = readFileSync(path, "utf8");

  try {
    Bun.TOML.parse(text);
  } catch (err) {
    throw new Error(`config.toml 无法解析,拒绝改写:${(err as Error).message}`);
  }

  const escaped = plugin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headerRe = new RegExp(`^\\[plugins\\.(?:"${escaped}"|${escaped})\\]\\s*$`, "m");
  const headerMatch = headerRe.exec(text);

  let next: string;
  if (headerMatch) {
    // the table runs until the next [header] or EOF; flip its enabled line,
    // or add one right under the header if the table never had it
    const tableStart = headerMatch.index + headerMatch[0].length;
    const rest = text.slice(tableStart);
    const tableEnd = rest.search(/^\s*\[/m);
    const table = tableEnd === -1 ? rest : rest.slice(0, tableEnd);
    const enabledRe = /^(\s*enabled\s*=\s*)(true|false)\s*$/m;
    const newTable = enabledRe.test(table)
      ? table.replace(enabledRe, `$1${enabled}`)
      : `\nenabled = ${enabled}${table}`;
    next = text.slice(0, tableStart) + newTable + (tableEnd === -1 ? "" : rest.slice(tableEnd));
  } else {
    next = `${text.trimEnd()}\n\n[plugins."${plugin}"]\nenabled = ${enabled}\n`;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = Bun.TOML.parse(next) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`改写结果无法解析,已放弃:${(err as Error).message}`);
  }
  const state = ((parsed.plugins ?? {}) as Record<string, { enabled?: boolean }>)[plugin]?.enabled;
  if (state !== enabled) throw new Error("改写结果与目标状态不符,已放弃");

  const backup = createBackup(path, "codex-config");
  atomicWrite(path, next);
  return { backupId: backup?.id ?? null };
}
