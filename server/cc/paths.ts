import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export interface FileTask {
  kind: "session" | "subagent";
  path: string;
  projectDirName: string;
  sessionId: string;
  agentId?: string;
  size: number;
  mtimeMs: number;
}

const AGENT_FILE = /^agent-(.+)\.jsonl$/;

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

/** Read-only enumeration of all session and subagent JSONL files under claudeDir. */
export async function listClaudeFiles(claudeDir: string): Promise<FileTask[]> {
  const tasks: FileTask[] = [];
  const projectsDir = join(claudeDir, "projects");

  for (const project of await safeReaddir(projectsDir)) {
    if (!project.isDirectory()) continue;
    const projectDir = join(projectsDir, project.name);

    for (const entry of await safeReaddir(projectDir)) {
      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        const task = await fileTask({
          kind: "session",
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
