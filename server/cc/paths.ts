import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export interface FileTask {
  kind: "session" | "subagent";
  /** Which CLI's transcript this is; absent means Claude Code. */
  product?: "claude" | "codex";
  profileId: string;
  path: string;
  projectDirName: string;
  sessionId: string;
  agentId?: string;
  size: number;
  mtimeMs: number;
}

const AGENT_FILE = /^agent-(.+)\.jsonl$/;

/** rollout-2026-06-26T18-41-28-<uuid>.jsonl → the uuid is the session id. */
const ROLLOUT_FILE = /^rollout-.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/;

async function safeReaddir(dir: string) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function fileTask(base: Omit<FileTask, "size" | "mtimeMs">): Promise<FileTask | null> {
  try {
    const s = await stat(base.path);
    return { ...base, size: s.size, mtimeMs: s.mtimeMs };
  } catch {
    return null;
  }
}

/**
 * Read-only enumeration of Codex rollout files (sessions/YYYY/MM/DD/rollout-*).
 * The project is unknown until the first line (session_meta carries cwd), so
 * the dir name is settled at ingest time; the placeholder never reaches the DB.
 */
export async function listCodexFiles(codexDir: string, profileId = "default"): Promise<FileTask[]> {
  const tasks: FileTask[] = [];
  // archived sessions keep the same rollout format — history is history
  for (const rootName of ["sessions", "archived_sessions"]) {
    tasks.push(...(await listCodexRollouts(join(codexDir, rootName), profileId)));
  }
  return tasks;
}

/**
 * sessions/ nests rollouts under YYYY/MM/DD; archived_sessions/ keeps them
 * flat. Walking both shapes from the same root covers either.
 */
async function listCodexRollouts(root: string, profileId: string): Promise<FileTask[]> {
  const tasks: FileTask[] = [];
  const collect = async (dir: string, depth: number): Promise<void> => {
    for (const entry of await safeReaddir(dir)) {
      if (entry.isDirectory() && depth < 3) {
        await collect(join(dir, entry.name), depth + 1);
        continue;
      }
      const match = entry.isFile() ? ROLLOUT_FILE.exec(entry.name) : null;
      if (!match) continue;
      const task = await fileTask({
        kind: "session",
        product: "codex",
        profileId,
        path: join(dir, entry.name),
        projectDirName: "codex:pending",
        sessionId: match[1]!,
      });
      if (task) tasks.push(task);
    }
  };
  await collect(root, 0);
  return tasks;
}

/** Read-only enumeration of all session and subagent JSONL files under claudeDir. */
export async function listClaudeFiles(claudeDir: string, profileId = "default"): Promise<FileTask[]> {
  const tasks: FileTask[] = [];
  const projectsDir = join(claudeDir, "projects");

  for (const project of await safeReaddir(projectsDir)) {
    if (!project.isDirectory()) continue;
    const projectDir = join(projectsDir, project.name);

    for (const entry of await safeReaddir(projectDir)) {
      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        const task = await fileTask({
          kind: "session",
          profileId,
          path: join(projectDir, entry.name),
          projectDirName: project.name,
          sessionId: entry.name.slice(0, -".jsonl".length),
        });
        if (task) tasks.push(task);
      } else if (entry.isDirectory()) {
        const subagentsDir = join(projectDir, entry.name, "subagents");
        for (const sub of await safeReaddir(subagentsDir)) {
          const match = sub.isFile() ? AGENT_FILE.exec(sub.name) : null;
          if (!match) continue;
          const task = await fileTask({
            kind: "subagent",
            profileId,
            path: join(subagentsDir, sub.name),
            projectDirName: project.name,
            sessionId: entry.name,
            agentId: match[1]!,
          });
          if (task) tasks.push(task);
        }
      }
    }
  }

  return tasks;
}
