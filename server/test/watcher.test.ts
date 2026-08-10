import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations, openDb } from "../db/db";
import { IndexScheduler } from "../indexer/scheduler";
import { FsWatcher } from "../indexer/watcher";

let dir: string;
let db: Database;
let scheduler: IndexScheduler;
let watcher: FsWatcher | null = null;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ccockpit-watch-"));
  mkdirSync(join(dir, "projects", "-p1"), { recursive: true });
  db = openDb(":memory:");
  applyMigrations(db);
  scheduler = new IndexScheduler(db, { workers: 1 });
});

afterEach(() => {
  watcher?.stop();
  watcher = null;
  rmSync(dir, { recursive: true, force: true });
});

function sessionLine(sessionId: string, text: string): string {
  return (
    JSON.stringify({
      uuid: `u-${sessionId}-${text.length}`,
      sessionId,
      timestamp: "2026-08-01T10:00:00.000Z",
      type: "user",
      message: { role: "user", content: text },
    }) + "\n"
  );
}

function sessionCount(): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n;
}

async function waitFor(cond: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("condition not met in time");
}

describe("FsWatcher", () => {
  test("a new session file gets indexed after a change event", async () => {
    watcher = new FsWatcher(scheduler, dir, { debounceMs: 50 });
    watcher.start();
    writeFileSync(join(dir, "projects", "-p1", "w-1.jsonl"), sessionLine("w-1", "watch me"));
    await waitFor(() => sessionCount() === 1);
    const row = db.prepare("SELECT * FROM sessions WHERE id = 'w-1'").get() as Record<string, unknown>;
    expect(row.title).toBe("watch me");
  });

  test("appends to an existing file are picked up incrementally", async () => {
    const file = join(dir, "projects", "-p1", "w-2.jsonl");
    writeFileSync(file, sessionLine("w-2", "first"));
    await scheduler.runScan(dir);
    expect(sessionCount()).toBe(1);

    // pollMs backstop: FSEvents latency is unbounded under load (production
    // uses the same watch-fast-path + poll-fallback combination)
    watcher = new FsWatcher(scheduler, dir, { debounceMs: 50, pollMs: 200 });
    watcher.start();
    appendFileSync(file, sessionLine("w-2", "second message"));
    await waitFor(
      () => (db.prepare("SELECT line_count AS n FROM sessions WHERE id = 'w-2'").get() as { n: number }).n === 2,
    );
  });

  test("events during a running scan trigger a follow-up scan", async () => {
    watcher = new FsWatcher(scheduler, dir, { debounceMs: 10, pollMs: 200 });
    watcher.start();
    // burst of writes: some land while the first scan is running
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(dir, "projects", "-p1", `burst-${i}.jsonl`), sessionLine(`burst-${i}`, `msg ${i}`));
      await new Promise((r) => setTimeout(r, 20));
    }
    await waitFor(() => sessionCount() === 5);
  });

  test("poll fallback indexes changes even without watch events", async () => {
    watcher = new FsWatcher(scheduler, dir, { debounceMs: 50, pollMs: 100, disableWatch: true });
    watcher.start();
    writeFileSync(join(dir, "projects", "-p1", "w-3.jsonl"), sessionLine("w-3", "poll me"));
    await waitFor(() => sessionCount() === 1);
  });

  test("stop() halts reactions to further changes", async () => {
    watcher = new FsWatcher(scheduler, dir, { debounceMs: 10, pollMs: 50 });
    watcher.start();
    watcher.stop();
    writeFileSync(join(dir, "projects", "-p1", "w-4.jsonl"), sessionLine("w-4", "ignored"));
    await new Promise((r) => setTimeout(r, 300));
    expect(sessionCount()).toBe(0);
  });
});
