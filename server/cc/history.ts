import type { Database } from "bun:sqlite";
import { openSync, readSync, closeSync, statSync } from "node:fs";
import { join } from "node:path";
import { insertMany } from "../db/db";
import { LineSplitter } from "../indexer/scanner-lines";

const CURSOR_KEY = "history_parsed_bytes";

export interface HistoryImportResult {
  imported: number;
  parsedBytes: number;
}

function cursor(db: Database, key: string): number {
  const row = db.prepare("SELECT value FROM meta WHERE key = $key").get({ $key: key }) as
    | { value: string }
    | null;
  return row ? Number(row.value) : 0;
}

function setCursor(db: Database, key: string, value: number): void {
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ($key, $value) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run({ $key: key, $value: String(value) });
}

/**
 * Incrementally imports ~/.claude/history.jsonl (prompt history) using the same
 * byte-cursor discipline as the session indexer: a truncated file restarts from
 * zero, a partial trailing line stays unconsumed.
 */
export function importPromptHistory(db: Database, claudeDir: string): HistoryImportResult {
  const path = join(claudeDir, "history.jsonl");
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return { imported: 0, parsedBytes: 0 };
  }

  let start = cursor(db, CURSOR_KEY);
  if (start > size) {
    // file shrank (rotated) — reimport from scratch
    db.run("DELETE FROM prompt_history");
    start = 0;
  }
  if (start === size) return { imported: 0, parsedBytes: start };

  const fd = openSync(path, "r");
  const splitter = new LineSplitter(start);
  const rows: Array<[number | null, string | null, string | null, string]> = [];
  try {
    const buffer = Buffer.alloc(1 << 20);
    let position = start;
    for (;;) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, position);
      if (bytesRead <= 0) break;
      position += bytesRead;
      for (const line of splitter.push(buffer.subarray(0, bytesRead))) {
        if (!line.text.trim()) continue;
        try {
          const entry = JSON.parse(line.text) as {
            display?: string;
            timestamp?: number;
            project?: string;
            sessionId?: string;
          };
          if (typeof entry.display !== "string") continue;
          rows.push([entry.timestamp ?? null, entry.project ?? null, entry.sessionId ?? null, entry.display]);
        } catch {
          // skip malformed history line
        }
      }
    }
  } finally {
    closeSync(fd);
  }

  if (rows.length > 0) {
    insertMany(
      db,
      db.prepare("INSERT INTO prompt_history (ts, project, session_id, display) VALUES (?, ?, ?, ?)"),
      rows,
    );
  }
  setCursor(db, CURSOR_KEY, splitter.consumedBytes);
  return { imported: rows.length, parsedBytes: splitter.consumedBytes };
}
