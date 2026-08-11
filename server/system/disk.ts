import { readdirSync, rmSync, statSync, type Dirent } from "node:fs";
import { join } from "node:path";

export type CategoryId =
  | "debug"
  | "file-history"
  | "session-env"
  | "plugin-temp"
  | "shell-snapshots"
  | "todos";

interface CategorySpec {
  id: CategoryId;
  label: string;
  /** Path relative to the config dir that holds this category. */
  dir: string;
  description: string;
  /** Cleanup granularity: whole child entries, or matching children only. */
  match?: (name: string) => boolean;
}

const CATEGORIES: CategorySpec[] = [
  { id: "debug", label: "调试日志", dir: "debug", description: "CLI 调试日志,删除不影响会话记录" },
  {
    id: "file-history",
    label: "文件版本备份",
    dir: "file-history",
    description: "按会话保存的文件改动快照,用于会话内撤销",
  },
  { id: "session-env", label: "会话环境目录", dir: "session-env", description: "会话临时环境,多为空目录" },
  {
    id: "plugin-temp",
    label: "插件临时克隆",
    dir: join("plugins", "cache"),
    description: "插件安装过程遗留的临时 git 克隆",
    match: (name) => name.startsWith("temp_git_"),
  },
  { id: "shell-snapshots", label: "Shell 快照", dir: "shell-snapshots", description: "shell 环境快照" },
  { id: "todos", label: "任务列表", dir: "todos", description: "会话任务列表缓存" },
];

/** Never a cleanup candidate: these are the transcripts the index is built on. */
const PROTECTED: Array<{ id: string; label: string; dir: string }> = [
  { id: "projects", label: "会话记录", dir: "projects" },
  { id: "sessions", label: "活跃会话注册表", dir: "sessions" },
];

interface DirStats {
  sizeBytes: number;
  fileCount: number;
  newestMtimeMs: number;
}

function statTree(path: string): DirStats {
  let sizeBytes = 0;
  let fileCount = 0;
  let newestMtimeMs = 0;

  const walk = (current: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(child);
        continue;
      }
      try {
        const stat = statSync(child);
        sizeBytes += stat.size;
        fileCount++;
        if (stat.mtimeMs > newestMtimeMs) newestMtimeMs = stat.mtimeMs;
      } catch {
        // vanished mid-walk
      }
    }
  };

  walk(path);
  return { sizeBytes, fileCount, newestMtimeMs };
}

export interface DiskCategoryReport extends DirStats {
  id: CategoryId;
  label: string;
  path: string;
  description: string;
}

export interface DiskReport {
  claudeDir: string;
  categories: DiskCategoryReport[];
  protected: Array<{ id: string; label: string; path: string; sizeBytes: number; fileCount: number }>;
  totalBytes: number;
}

export function scanDisk(claudeDir: string): DiskReport {
  const categories = CATEGORIES.map((spec) => {
    const path = join(claudeDir, spec.dir);
    const stats = spec.match ? statMatching(path, spec.match) : statTree(path);
    return { id: spec.id, label: spec.label, path, description: spec.description, ...stats };
  });

  const protectedEntries = PROTECTED.map((spec) => {
    const path = join(claudeDir, spec.dir);
    const stats = statTree(path);
    return { id: spec.id, label: spec.label, path, sizeBytes: stats.sizeBytes, fileCount: stats.fileCount };
  });

  return {
    claudeDir,
    categories,
    protected: protectedEntries,
    totalBytes: categories.reduce((sum, c) => sum + c.sizeBytes, 0),
  };
}

function statMatching(path: string, match: (name: string) => boolean): DirStats {
  let sizeBytes = 0;
  let fileCount = 0;
  let newestMtimeMs = 0;
  let entries: Dirent[];
  try {
    entries = readdirSync(path, { withFileTypes: true });
  } catch {
    return { sizeBytes, fileCount, newestMtimeMs };
  }
  for (const entry of entries) {
    if (!match(entry.name)) continue;
    const child = join(path, entry.name);
    const stats = entry.isDirectory() ? statTree(child) : statTree(join(path));
    sizeBytes += stats.sizeBytes;
    fileCount += entry.isDirectory() ? stats.fileCount : 1;
    newestMtimeMs = Math.max(newestMtimeMs, stats.newestMtimeMs);
  }
  return { sizeBytes, fileCount, newestMtimeMs };
}

export interface CleanupItem {
  category: CategoryId;
  path: string;
  sizeBytes: number;
  fileCount: number;
  lastModified: number;
}

export interface CleanupPlan {
  items: CleanupItem[];
  totalBytes: number;
}

export interface CleanupOptions {
  categories: CategoryId[];
  retentionDays: number;
  /** Session ids whose artifacts must be kept regardless of age. */
  activeSessionIds: string[];
}

/**
 * Enumerates exactly what a cleanup would remove. The plan is the single
 * source of truth: a dry run and the real run execute the same list, so the
 * preview cannot disagree with what actually happens.
 */
export function cleanupPlan(claudeDir: string, options: CleanupOptions): CleanupPlan {
  const cutoff = Date.now() - options.retentionDays * 86_400_000;
  const active = new Set(options.activeSessionIds);
  const items: CleanupItem[] = [];

  for (const spec of CATEGORIES) {
    if (!options.categories.includes(spec.id)) continue;
    const root = join(claudeDir, spec.dir);

    let entries: Dirent[];
    try {
      entries = readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (spec.match && !spec.match(entry.name)) continue;
      const path = join(root, entry.name);

      // file-history/<sessionId>/… — a running session's undo history stays
      if (spec.id === "file-history" && active.has(entry.name)) continue;

      let stats: DirStats;
      let lastModified: number;
      if (entry.isDirectory()) {
        stats = statTree(path);
        // an empty dir has no files to date it; fall back to the dir itself
        lastModified = stats.newestMtimeMs || safeMtime(path);
      } else {
        const size = safeSize(path);
        stats = { sizeBytes: size, fileCount: 1, newestMtimeMs: safeMtime(path) };
        lastModified = stats.newestMtimeMs;
      }

      if (lastModified > cutoff) continue;
      items.push({
        category: spec.id,
        path,
        sizeBytes: stats.sizeBytes,
        fileCount: stats.fileCount,
        lastModified,
      });
    }
  }

  return { items, totalBytes: items.reduce((sum, item) => sum + item.sizeBytes, 0) };
}

function safeMtime(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function safeSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

export interface CleanupResult {
  plan: CleanupPlan;
  dryRun: boolean;
  deleted: number;
  freedBytes: number;
  errors: Array<{ path: string; error: string }>;
}

export function executeCleanup(
  claudeDir: string,
  options: CleanupOptions & { dryRun: boolean },
): CleanupResult {
  const plan = cleanupPlan(claudeDir, options);
  if (options.dryRun) {
    return { plan, dryRun: true, deleted: 0, freedBytes: 0, errors: [] };
  }

  let deleted = 0;
  let freedBytes = 0;
  const errors: Array<{ path: string; error: string }> = [];
  for (const item of plan.items) {
    try {
      rmSync(item.path, { recursive: true, force: true });
      deleted++;
      freedBytes += item.sizeBytes;
    } catch (err) {
      errors.push({ path: item.path, error: (err as Error).message });
    }
  }
  return { plan, dryRun: false, deleted, freedBytes, errors };
}
