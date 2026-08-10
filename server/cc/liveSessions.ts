import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface LiveSession {
  pid: number;
  sessionId: string;
  cwd: string;
  name?: string;
  status?: string;
  kind?: string;
  entrypoint?: string;
  version?: string;
  jobId?: string;
  startedAt?: number;
  updatedAt?: number;
  procStart?: string;
  alive: boolean;
}

/** kill(pid, 0): true when the process exists and we may signal it. */
function pidExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means it exists but belongs to another user
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Process start time as `ps` prints it, or null when the pid is gone. */
function processStart(pid: number): string | null {
  const result = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8" });
  if (result.status !== 0) return null;
  const value = result.stdout.trim();
  return value.length > 0 ? value : null;
}

function normalizeStart(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * A pid alone is not proof: pids are recycled, and a crashed CLI leaves its
 * registry file behind. When the entry recorded procStart, require it to match
 * the running process's actual start time.
 */
function isAlive(entry: Partial<LiveSession>): boolean {
  const pid = entry.pid!;
  if (!pidExists(pid)) return false;
  if (!entry.procStart) return true;
  const actual = processStart(pid);
  return actual === null ? false : normalizeStart(actual) === normalizeStart(entry.procStart);
}

/**
 * Reads Claude Code's live-session registry (<claudeDir>/sessions/<pid>.json).
 * Entries are stale-prone — a crashed CLI leaves its file behind — so liveness
 * is verified per entry rather than trusted.
 */
export function listLiveSessions(claudeDir: string): LiveSession[] {
  const dir = join(claudeDir, "sessions");
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }

  const sessions: LiveSession[] = [];
  for (const name of names) {
    try {
      const entry = JSON.parse(readFileSync(join(dir, name), "utf8")) as Partial<LiveSession>;
      if (typeof entry.pid !== "number" || typeof entry.sessionId !== "string") continue;
      sessions.push({ ...(entry as LiveSession), alive: isAlive(entry) });
    } catch {
      // malformed or racing rewrite — skip this entry
    }
  }
  sessions.sort((a, b) => Number(b.alive) - Number(a.alive) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  return sessions;
}
