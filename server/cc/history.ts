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

type HistoryRow = [number | null, string | null, string | null, string, string];

function importJsonl(
  db: Database,
  path: string,
  cursorKey: string,
  product: string,
  toRow: (entry: Record<string, unknown>) => HistoryRow | null,
): HistoryImportResult {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return { imported: 0, parsedBytes: 0 };
  }

  let start = cursor(db, cursorKey);
  if (start > size) {
    // file shrank (rotated) — reimport this product from scratch
    db.prepare("DELETE FROM prompt_history WHERE product = $p").run({ $p: product });
    start = 0;
  }
  if (start === size) return { imported: 0, parsedBytes: start };

  const fd = openSync(path, "r");
  const splitter = new LineSplitter(start);
  const rows: HistoryRow[] = [];
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
          const row = toRow(JSON.parse(line.text) as Record<string, unknown>);
          if (row) rows.push(row);
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
      db.prepare(
        "INSERT INTO prompt_history (ts, project, session_id, display, product) VALUES (?, ?, ?, ?, ?)",
      ),
      rows,
    );
  }
  setCursor(db, cursorKey, splitter.consumedBytes);
  return { imported: rows.length, parsedBytes: splitter.consumedBytes };
}

/**
 * Incrementally imports ~/.claude/history.jsonl (prompt history) using the same
 * byte-cursor discipline as the session indexer: a truncated file restarts from
 * zero, a partial trailing line stays unconsumed.
 */
export function importPromptHistory(db: Database, claudeDir: string): HistoryImportResult {
  return importJsonl(db, join(claudeDir, "history.jsonl"), CURSOR_KEY, "claude", (entry) => {
    if (typeof entry.display !== "string") return null;
    return [
      (entry.timestamp as number | undefined) ?? null,
      (entry.project as string | undefined) ?? null,
      (entry.sessionId as string | undefined) ?? null,
      entry.display,
      "claude",
    ];
  });
}

/** Codex history: {session_id, ts (epoch seconds), text} — no project field. */
export function importCodexPromptHistory(db: Database, codexDir: string): HistoryImportResult {
  return importJsonl(db, join(codexDir, "history.jsonl"), "codex_history_parsed_bytes", "codex", (entry) => {
    if (typeof entry.text !== "string") return null;
    const ts = typeof entry.ts === "number" ? entry.ts * 1000 : null;
    return [ts, null, (entry.session_id as string | undefined) ?? null, entry.text, "codex"];
  });
}
