import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { resolveCocopitHome } from "../config";

export interface BackupEntry {
  id: string;
  slug: string;
  originPath: string;
  storedPath: string;
  createdAt: number;
  /** Tie-breaker: several backups can land in the same millisecond. */
  seq: number;
  sizeBytes: number;
}

let backupSeq = 0;

export const DEFAULT_BACKUP_KEEP = 100;

export function backupsRoot(): string {
  const root = join(resolveCocopitHome(), "backups");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  return root;
}

function manifestPath(dir: string): string {
  return join(dir, "manifest.json");
}

/**
 * Copies a file into ~/.cocopit/backups/<ISO>__<slug>/ before it is modified.
 * Returns null when there is nothing to back up (first write of a new file).
 */
export function createBackup(originPath: string, slug: string): BackupEntry | null {
  if (!existsSync(originPath)) return null;

  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  // a same-millisecond second backup would collide; disambiguate with a counter
  let id = `${stamp}__${slug}`;
  let dir = join(backupsRoot(), id);
  for (let n = 2; existsSync(dir); n++) {
    id = `${stamp}-${n}__${slug}`;
    dir = join(backupsRoot(), id);
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  const storedPath = join(dir, basename(originPath));
  copyFileSync(originPath, storedPath);

  const entry: BackupEntry = {
    id,
    slug,
    originPath,
    storedPath,
    createdAt: now.getTime(),
    seq: backupSeq++,
    sizeBytes: statSync(storedPath).size,
  };
  writeFileSync(manifestPath(dir), JSON.stringify(entry, null, 2) + "\n", { mode: 0o600 });
  return entry;
}

/** Newest first. Directories without a readable manifest are ignored. */
export function listBackups(): BackupEntry[] {
  const root = backupsRoot();
  const entries: BackupEntry[] = [];
  for (const name of readdirSync(root)) {
    const manifest = manifestPath(join(root, name));
    if (!existsSync(manifest)) continue;
    try {
      entries.push(JSON.parse(readFileSync(manifest, "utf8")) as BackupEntry);
    } catch {
      // unreadable manifest — skip rather than fail the listing
    }
  }
  return entries.sort((a, b) => b.createdAt - a.createdAt || (b.seq ?? 0) - (a.seq ?? 0));
}

export function pruneBackups(keep = DEFAULT_BACKUP_KEEP): number {
  const entries = listBackups();
  const doomed = entries.slice(keep);
  for (const entry of doomed) {
    rmSync(join(backupsRoot(), entry.id), { recursive: true, force: true });
  }
  return doomed.length;
}

export interface RestoreResult {
  restored: BackupEntry;
  /** Backup of whatever was there before the restore, so it stays reversible. */
  backupOfCurrent: BackupEntry | null;
}

export function restoreBackup(id: string, claudeDir: string): RestoreResult {
  const entry = listBackups().find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`backup not found: ${id}`);

  // restoring writes to the original location — same allowlist as any write
  const { assertWritable, atomicWrite } = require("./safeWrite") as typeof import("./safeWrite");
  assertWritable(entry.originPath, claudeDir);

  const backupOfCurrent = createBackup(entry.originPath, `${entry.slug}-pre-restore`);
  atomicWrite(entry.originPath, readFileSync(entry.storedPath));
  pruneBackups();
  return { restored: entry, backupOfCurrent };
}
