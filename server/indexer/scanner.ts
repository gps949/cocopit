import type { Database } from "bun:sqlite";
import type { FileTask } from "../cc/paths";

export interface WorkItem {
  task: FileTask;
  startOffset: number;
  mode: "new" | "append" | "reparse";
  seqStart: number;
}

interface Cursor {
  file_size: number;
  file_mtime_ms: number;
  parsed_bytes: number;
  line_count: number;
  file_path: string | null;
}

/**
 * Diffs the file listing against stored cursors. JSONL files are append-only
 * in the normal case, so: growth resumes from parsed_bytes, shrinkage (or a
 * cursor pointing past the file) forces a reparse, and an mtime-only change
 * with an intact cursor is ignored.
 */
export function computeWork(db: Database, tasks: FileTask[]): WorkItem[] {
  const sessionStmt = db.prepare(
    `SELECT file_size, file_mtime_ms, parsed_bytes, line_count, file_path FROM sessions WHERE id = $id`,
  );
  const subagentStmt = db.prepare(
    `SELECT file_size, file_mtime_ms, parsed_bytes, 0 AS line_count, file_path FROM subagents
     WHERE session_id = $id AND agent_id = $agentId`,
  );

  const work: WorkItem[] = [];
  for (const task of tasks) {
    const cursor = (
      task.kind === "session"
        ? sessionStmt.get({ $id: task.sessionId })
        : subagentStmt.get({ $id: task.sessionId, $agentId: task.agentId ?? "" })
    ) as Cursor | null;

    if (!cursor) {
      work.push({ task, startOffset: 0, mode: "new", seqStart: 0 });
      continue;
    }

    if (task.size > cursor.file_size) {
      work.push({
        task,
        startOffset: cursor.parsed_bytes,
        mode: "append",
        seqStart: cursor.line_count,
      });
    } else if (
      task.size < cursor.file_size ||
      cursor.parsed_bytes > task.size ||
      // moved without changing (Codex archives sessions this way): the
      // content is already indexed, but reads seek into the recorded path —
      // a stale one would break the detail view
      (cursor.file_path !== null && cursor.file_path !== task.path)
    ) {
      work.push({ task, startOffset: 0, mode: "reparse", seqStart: 0 });
    }
    // same size, same path, cursor within bounds: nothing to do (mtime-only change)
  }

  work.sort((a, b) => b.task.mtimeMs - a.task.mtimeMs);
  return work;
}
