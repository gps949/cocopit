import { beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { applyMigrations, openDb } from "../db/db";
import type { FileTask } from "../cc/paths";
import { computeWork } from "../indexer/scanner";

let db: Database;

beforeEach(() => {
  db = openDb(":memory:");
  applyMigrations(db);
  db.run("INSERT INTO projects (id, profile_id, dir_name) VALUES (1, 'default', '-p1')");
});

function sessionTask(overrides: Partial<FileTask> = {}): FileTask {
  return {
    kind: "session",
    path: "/fake/projects/-p1/s1.jsonl",
    projectDirName: "-p1",
    sessionId: "s1",
    size: 100,
    mtimeMs: 5000,
    ...overrides,
  };
}

function insertSessionRow(opts: {
  id: string;
  size: number;
  mtimeMs: number;
  parsedBytes: number;
  lineCount?: number;
}): void {
  db.prepare(
    `INSERT INTO sessions (id, project_id, file_path, file_size, file_mtime_ms, parsed_bytes, line_count)
     VALUES ($id, 1, $path, $size, $mtime, $parsed, $lines)`,
  ).run({
    $id: opts.id,
    $path: `/fake/projects/-p1/${opts.id}.jsonl`,
    $size: opts.size,
    $mtime: opts.mtimeMs,
    $parsed: opts.parsedBytes,
    $lines: opts.lineCount ?? 0,
  });
}

describe("computeWork", () => {
  test("unknown file → mode new at offset 0", () => {
    const work = computeWork(db, [sessionTask()]);
    expect(work).toHaveLength(1);
    expect(work[0]!.mode).toBe("new");
    expect(work[0]!.startOffset).toBe(0);
    expect(work[0]!.seqStart).toBe(0);
  });

  test("grown file → append from parsed_bytes with seqStart = line_count", () => {
    insertSessionRow({ id: "s1", size: 80, mtimeMs: 4000, parsedBytes: 80, lineCount: 7 });
    const work = computeWork(db, [sessionTask({ size: 100, mtimeMs: 5000 })]);
    expect(work).toHaveLength(1);
    expect(work[0]!.mode).toBe("append");
    expect(work[0]!.startOffset).toBe(80);
    expect(work[0]!.seqStart).toBe(7);
  });

  test("shrunk file → reparse from 0", () => {
    insertSessionRow({ id: "s1", size: 200, mtimeMs: 4000, parsedBytes: 200, lineCount: 9 });
    const work = computeWork(db, [sessionTask({ size: 100, mtimeMs: 5000 })]);
    expect(work).toHaveLength(1);
    expect(work[0]!.mode).toBe("reparse");
    expect(work[0]!.startOffset).toBe(0);
    expect(work[0]!.seqStart).toBe(0);
  });

  test("unchanged size and mtime → no work", () => {
    insertSessionRow({ id: "s1", size: 100, mtimeMs: 5000, parsedBytes: 100 });
    expect(computeWork(db, [sessionTask({ size: 100, mtimeMs: 5000 })])).toHaveLength(0);
  });

  test("same size, changed mtime, parsed_bytes within size → no work", () => {
    insertSessionRow({ id: "s1", size: 100, mtimeMs: 4000, parsedBytes: 100 });
    expect(computeWork(db, [sessionTask({ size: 100, mtimeMs: 9000 })])).toHaveLength(0);
  });

  test("same size, changed mtime, parsed_bytes beyond size → reparse", () => {
    insertSessionRow({ id: "s1", size: 100, mtimeMs: 4000, parsedBytes: 150 });
    const work = computeWork(db, [sessionTask({ size: 100, mtimeMs: 9000 })]);
    expect(work).toHaveLength(1);
    expect(work[0]!.mode).toBe("reparse");
  });

  test("results ordered by mtimeMs descending", () => {
    const older = sessionTask({ sessionId: "old", path: "/fake/projects/-p1/old.jsonl", mtimeMs: 1000 });
    const newer = sessionTask({ sessionId: "new", path: "/fake/projects/-p1/new.jsonl", mtimeMs: 9000 });
    const work = computeWork(db, [older, newer]);
    expect(work.map((w) => w.task.sessionId)).toEqual(["new", "old"]);
  });

  test("subagent rows tracked via subagents table", () => {
    db.prepare(
      `INSERT INTO subagents (session_id, agent_id, file_path, file_size, file_mtime_ms, parsed_bytes)
       VALUES ('s1', 'a1', '/fake/projects/-p1/s1/subagents/agent-a1.jsonl', 50, 3000, 50)`,
    ).run();
    const unchanged: FileTask = {
      kind: "subagent",
      path: "/fake/projects/-p1/s1/subagents/agent-a1.jsonl",
      projectDirName: "-p1",
      sessionId: "s1",
      agentId: "a1",
      size: 50,
      mtimeMs: 3000,
    };
    expect(computeWork(db, [unchanged])).toHaveLength(0);

    const grown = { ...unchanged, size: 90, mtimeMs: 3500 };
    const work = computeWork(db, [grown]);
    expect(work).toHaveLength(1);
    expect(work[0]!.mode).toBe("append");
    expect(work[0]!.startOffset).toBe(50);
  });
});
