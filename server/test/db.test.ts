import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { applyMigrations, insertMany, openDb } from "../db/db";

const CORE_TABLES = [
  "meta",
  "projects",
  "sessions",
  "messages",
  "usage_events",
  "subagents",
  "tool_calls",
  "prompt_history",
  "parse_errors",
];

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ccockpit-db-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function freshDb(): Database {
  const db = openDb(join(dir, "test.db"));
  applyMigrations(db);
  return db;
}

function seedSession(db: Database): { projectId: number; sessionId: string } {
  const projectId = Number(
    db
      .prepare("INSERT INTO projects (dir_name, cwd) VALUES ($dir, $cwd)")
      .run({ $dir: "-tmp-proj", $cwd: "/tmp/proj" }).lastInsertRowid,
  );
  const sessionId = "11111111-2222-3333-4444-555555555555";
  db.prepare(
    "INSERT INTO sessions (id, project_id, file_path) VALUES ($id, $project, $path)",
  ).run({ $id: sessionId, $project: projectId, $path: "/tmp/proj/session.jsonl" });
  return { projectId, sessionId };
}

describe("openDb", () => {
  test("enables WAL journal mode", () => {
    const db = openDb(join(dir, "wal.db"));
    const row = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
    expect(row.journal_mode).toBe("wal");
    db.close();
  });
});

describe("applyMigrations", () => {
  test("brings a fresh db to schema_version 1 with all tables", () => {
    const db = freshDb();
    const version = db
      .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
      .get() as { value: string };
    expect(version.value).toBe("1");

    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
        name: string;
      }[]
    ).map((row) => row.name);
    for (const table of CORE_TABLES) {
      expect(tables).toContain(table);
    }
    expect(tables).toContain("fts_messages");
    db.close();
  });

  test("is idempotent when run again", () => {
    const db = freshDb();
    expect(() => applyMigrations(db)).not.toThrow();
    const version = db
      .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
      .get() as { value: string };
    expect(version.value).toBe("1");
    db.close();
  });
});

describe("writes", () => {
  test("smoke: one row in each core table", () => {
    const db = freshDb();
    const { sessionId } = seedSession(db);

    db.prepare(
      "INSERT INTO messages (session_id, uuid, seq, byte_offset, byte_len, type) " +
        "VALUES ($session, $uuid, 0, 0, 42, 'user')",
    ).run({ $session: sessionId, $uuid: "msg-1" });
    db.prepare(
      "INSERT INTO usage_events (session_id, uuid, ts, model, input_tokens, output_tokens) " +
        "VALUES ($session, $uuid, 1700000000000, 'claude-fable-5', 10, 20)",
    ).run({ $session: sessionId, $uuid: "msg-1" });

    expect(db.prepare("SELECT COUNT(*) AS n FROM messages").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM usage_events").get()).toEqual({ n: 1 });
    db.close();
  });

  test("insertMany writes 1000 message rows in one transaction", () => {
    const db = freshDb();
    const { sessionId } = seedSession(db);

    const stmt = db.prepare(
      "INSERT INTO messages (session_id, uuid, seq, byte_offset, byte_len, type) " +
        "VALUES ($session, $uuid, $seq, $offset, $len, 'assistant')",
    );
    const rows = Array.from({ length: 1000 }, (_, i) => ({
      $session: sessionId,
      $uuid: `uuid-${i}`,
      $seq: i,
      $offset: i * 100,
      $len: 100,
    }));
    insertMany(db, stmt, rows);

    expect(db.prepare("SELECT COUNT(*) AS n FROM messages").get()).toEqual({ n: 1000 });
    db.close();
  });
});

describe("fts_messages", () => {
  test("trigram matches Chinese and English substrings", () => {
    const db = freshDb();
    db.prepare(
      "INSERT INTO fts_messages (content, session_id, uuid) VALUES ($content, 's1', 'u1')",
    ).run({ $content: "做一个本地控制台面板" });
    db.prepare(
      "INSERT INTO fts_messages (content, session_id, uuid) VALUES ($content, 's1', 'u2')",
    ).run({ $content: "say hello to the dashboard" });

    const zh = db
      .prepare("SELECT uuid FROM fts_messages WHERE fts_messages MATCH $q")
      .all({ $q: '"控制台"' }) as { uuid: string }[];
    expect(zh.map((row) => row.uuid)).toEqual(["u1"]);

    const en = db
      .prepare("SELECT uuid FROM fts_messages WHERE fts_messages MATCH $q")
      .all({ $q: '"hello"' }) as { uuid: string }[];
    expect(en.map((row) => row.uuid)).toEqual(["u2"]);
    db.close();
  });
});
