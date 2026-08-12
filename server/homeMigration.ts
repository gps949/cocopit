import { existsSync, renameSync } from "node:fs";

/**
 * Carries the tool's own directory across the rename from ccockpit to cocopit.
 *
 * Everything it owns lives there: the index (hundreds of MB), the access token,
 * config, settings presets and every config backup. Without this the rename
 * would present as a fresh install with the old data orphaned beside it.
 *
 * A rename, not a copy — same filesystem, so it is atomic and costs nothing
 * regardless of index size. If the new directory already exists the old one is
 * left untouched rather than merged or deleted: there is no safe way to guess
 * which of two indexes is wanted.
 */
export function migrateLegacyHome(legacyPath: string, currentPath: string): boolean {
  if (!existsSync(legacyPath) || existsSync(currentPath)) return false;
  renameSync(legacyPath, currentPath);
  return true;
}
