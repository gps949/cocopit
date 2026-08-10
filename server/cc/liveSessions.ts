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

/**
 * Start times for many pids in one `ps` call — /api/live is polled every few
 * seconds, so per-pid spawns would be wasteful. Asking for UTC makes the output
 * directly comparable to the registry, which records procStart in UTC.
 */
function processStarts(pids: number[]): Map<number, string> {
  const starts = new Map<number, string>();
  if (pids.length === 0) return starts;
  const result = spawnSync("ps", ["-o", "pid=,lstart=", "-p", pids.join(",")], {
    encoding: "utf8",
    env: { ...process.env, TZ: "UTC" },
  });
  if (result.status !== 0 || !result.stdout) return starts;
  for (const line of result.stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(.+?)\s*$/.exec(line);
    if (match) starts.set(Number(match[1]), match[2]!);
  }
  return starts;
}

/**
 * Parses a ctime-style stamp ("Sun Aug  9 07:10:31 2026") as an instant.
 * `asUtc` picks the interpretation: ps was asked for UTC, but the registry's
 * own convention is only known empirically, so both are tried before rejecting.
 */
function parseCtime(value: string, asUtc: boolean): number | null {
  const match = /^\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})$/.exec(
    value.replace(/\s+/g, " ").trim(),
  );
  if (!match) return null;
  const [, mon, day, hh, mm, ss, year] = match;
  const stamp = Date.parse(`${mon} ${day} ${year} ${hh}:${mm}:${ss}${asUtc ? " UTC" : ""}`);
  return Number.isNaN(stamp) ? null : stamp;
}

const START_TOLERANCE_MS = 2000;

function startsMatch(stored: string, actualUtc: string): boolean {
  const actual = parseCtime(actualUtc, true);
  if (actual === null) return false;
  for (const asUtc of [true, false]) {
    const candidate = parseCtime(stored, asUtc);
    if (candidate !== null && Math.abs(candidate - actual) <= START_TOLERANCE_MS) return true;
  }
  return false;
}

/**
 * Reads Claude Code's live-session registry (<claudeDir>/sessions/<pid>.json).
 * Entries are stale-prone — a crashed CLI leaves its file behind, and pids get
 * recycled — so liveness is verified per entry: the pid must exist AND, when the
 * entry recorded procStart, the running process must have started then.
 */
export function listLiveSessions(claudeDir: string): LiveSession[] {
  const dir = join(claudeDir, "sessions");
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }

  const entries: Array<Partial<LiveSession>> = [];
  for (const name of names) {
    try {
      const entry = JSON.parse(readFileSync(join(dir, name), "utf8")) as Partial<LiveSession>;
      if (typeof entry.pid !== "number" || typeof entry.sessionId !== "string") continue;
      entries.push(entry);
    } catch {
      // malformed or racing rewrite — skip this entry
    }
  }

  const existingPids = new Set(
    [...new Set(entries.map((entry) => entry.pid!))].filter((pid) => pidExists(pid)),
  );
  const starts = processStarts([...existingPids]);

  const sessions = entries.map((entry) => {
    let alive = existingPids.has(entry.pid!);
    if (alive && entry.procStart) {
      const actual = starts.get(entry.pid!);
      // no ps row (e.g. another user's process) → trust the pid check
      alive = actual === undefined ? true : startsMatch(entry.procStart, actual);
    }
    return { ...(entry as LiveSession), alive };
  });

  sessions.sort((a, b) => Number(b.alive) - Number(a.alive) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  return sessions;
}
