import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { createBackup, pruneBackups, type BackupEntry } from "./backup";

export class WriteConflictError extends Error {
  constructor(
    message: string,
    readonly current: FileStamp,
  ) {
    super(message);
    this.name = "WriteConflictError";
  }
}

export interface FileStamp {
  exists: boolean;
  mtimeMs?: number;
  sha256?: string;
}

/** Identity of a file at read time, used for compare-and-swap on write. */
export function fileStamp(path: string): FileStamp {
  if (!existsSync(path)) return { exists: false };
  const stat = statSync(path);
  const sha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
  return { exists: true, mtimeMs: stat.mtimeMs, sha256 };
}

/**
 * Only these may be written. Claude Code owns everything else under its
 * config dir, and `~/.claude.json` in particular is rewritten constantly — a
 * write there would be lost or would clobber live state.
 */
const WRITABLE_BASENAMES = new Set(["settings.json", "settings.local.json", ".mcp.json"]);

export function assertWritable(path: string, claudeDir: string): void {
  const resolved = resolve(path);
  const name = basename(resolved);

  if (name === ".claude.json" || resolved === `${resolve(claudeDir)}.json`) {
    throw new Error("~/.claude.json 为只读:Claude Code 高频重写该文件,写入会冲突或丢失");
  }
  if (!WRITABLE_BASENAMES.has(name)) {
    throw new Error(`不在可写清单内:${name}`);
  }

  // Exhaustive allow: everything not matched below is refused, so a path like
  // <claudeDir>/../../elsewhere/settings.json cannot slip through on its name.
  const parent = basename(dirname(resolved));
  if (resolved === resolve(claudeDir, "settings.json")) return; // user settings
  if (name === "settings.local.json" && parent === ".claude") return; // project scope
  if (name === ".mcp.json") return; // project root

  throw new Error(`路径不在可写清单内:${resolved}`);
}

/** temp + rename in the same directory, preserving the previous mode. */
export function atomicWrite(path: string, data: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  const mode = existsSync(path) ? statSync(path).mode & 0o777 : 0o600;
  const tmp = `${path}.ccockpit-${process.pid}.tmp`;
  try {
    writeFileSync(tmp, data, { mode });
    chmodSync(tmp, mode);
    renameSync(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // temp already gone
    }
    throw err;
  }
}

export interface SafeWriteOptions {
  path: string;
  claudeDir: string;
  value: unknown;
  /** Stamp taken when the client read the file; the write aborts if it moved. */
  expected: FileStamp;
  slug: string;
}

export interface SafeWriteResult {
  backup: BackupEntry | null;
  stamp: FileStamp;
}

function stampsMatch(expected: FileStamp, current: FileStamp): boolean {
  if (expected.exists !== current.exists) return false;
  if (!current.exists) return true;
  // content hash is authoritative; mtime alone is too coarse
  return expected.sha256 === current.sha256;
}

/**
 * Backup → compare-and-swap → atomic write. Rejects with WriteConflictError
 * when the file changed since the caller read it, so a concurrent Claude Code
 * write is never silently overwritten.
 */
export function safeWriteJson(opts: SafeWriteOptions): SafeWriteResult {
  assertWritable(opts.path, opts.claudeDir);

  const current = fileStamp(opts.path);
  if (!stampsMatch(opts.expected, current)) {
    throw new WriteConflictError("文件已被其他进程修改,请重新加载后再保存", current);
  }

  const backup = createBackup(opts.path, opts.slug);
  atomicWrite(opts.path, JSON.stringify(opts.value, null, 2) + "\n");
  pruneBackups();
  return { backup, stamp: fileStamp(opts.path) };
}
