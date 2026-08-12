import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveCcockpitHome } from "../config";
import { fileStamp, safeWriteJson } from "../writeops/safeWrite";

export interface Snapshot {
  name: string;
  createdAt: number;
  /** where it was taken from, so it is obvious what it is a snapshot of */
  sourcePath: string;
  settings: Record<string, unknown>;
}

function snapshotDir(): string {
  const dir = join(resolveCcockpitHome(), "snapshots");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Snapshot names become filenames, so they must not be able to point anywhere
 * but inside the snapshot directory. Rejecting rather than sanitizing: a name
 * silently turned into something else is worse than being told it is invalid.
 */
function fileFor(name: string): string {
  if (!name.trim() || name.includes("/") || name.includes("\\") || name.startsWith(".")) {
    throw new Error(`名称不合法:不能为空、包含路径分隔符或以点开头(${name})`);
  }
  return join(snapshotDir(), `${name}.json`);
}

/**
 * A named copy of a settings.json.
 *
 * Settings and the signed-in account both live under a config directory, but
 * they are not tied to each other — wanting a different permission posture is
 * not a reason to keep a second login. A snapshot is that separate axis: record
 * what settings.json says now, restore it later under whatever account.
 */
export function captureSnapshot(name: string, sourcePath: string): Snapshot {
  const path = fileFor(name);
  const raw = existsSync(sourcePath) ? readFileSync(sourcePath, "utf8") : "{}";
  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`来源不是合法 JSON,未创建快照:${(err as Error).message}`);
  }

  const snapshot: Snapshot = { name, createdAt: Date.now(), sourcePath, settings };
  writeFileSync(path, JSON.stringify(snapshot, null, 2) + "\n");
  return snapshot;
}

export function listSnapshots(): Snapshot[] {
  return readdirSync(snapshotDir())
    .filter((file) => file.endsWith(".json"))
    .flatMap((file) => {
      try {
        return [JSON.parse(readFileSync(join(snapshotDir(), file), "utf8")) as Snapshot];
      } catch {
        return []; // a corrupt snapshot file is one missing entry, not a broken page
      }
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function readSnapshot(name: string): Snapshot | null {
  const path = fileFor(name);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as Snapshot;
}

/**
 * Writes a snapshot back over a settings file. Goes through the same guarded
 * write as every other config edit here, so the target must be on the allowlist
 * and the previous contents are backed up first.
 */
export function applySnapshot(
  name: string,
  targetPath: string,
  claudeDir: string,
): { backupId: string | null } {
  const snapshot = readSnapshot(name);
  if (!snapshot) throw new Error(`找不到快照:${name}`);

  const result = safeWriteJson({
    path: targetPath,
    claudeDir,
    value: snapshot.settings,
    expected: fileStamp(targetPath),
    slug: "user-settings",
  });
  return { backupId: result.backup?.id ?? null };
}

export function deleteSnapshot(name: string): void {
  const path = fileFor(name);
  if (existsSync(path)) unlinkSync(path);
}

/** What applying a snapshot over the current settings would change. */
export function snapshotDiff(
  snapshot: Record<string, unknown>,
  current: Record<string, unknown>,
): { changed: string[]; added: string[]; removed: string[] } {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const changed: string[] = [];
  const added: string[] = [];
  for (const key of Object.keys(snapshot)) {
    if (!(key in current)) added.push(key);
    else if (!same(snapshot[key], current[key])) changed.push(key);
  }
  const removed = Object.keys(current).filter((key) => !(key in snapshot));
  return { changed, added, removed };
}
