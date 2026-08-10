import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IndexStatus } from "../../shared/types";
import { applyMigrations, openDb } from "../db/db";
import { SseHub } from "../http/sse";
import { createServer } from "../index";
import { IndexScheduler } from "../indexer/scheduler";

let dir: string;
let db: Database;
let scheduler: IndexScheduler;
let server: ReturnType<typeof createServer>;
let base: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ccockpit-routes-"));
  const p1 = join(dir, "projects", "-p1");
  mkdirSync(p1, { recursive: true });
  writeFileSync(
    join(p1, "s-r1.jsonl"),
    JSON.stringify({
      uuid: "u1",
      sessionId: "s-r1",
      timestamp: "2026-08-01T10:00:00.000Z",
      cwd: "/tmp/r1",
      type: "user",
      message: { role: "user", content: "route test" },
    }) + "\n",
  );

  db = openDb(":memory:");
  applyMigrations(db);
  scheduler = new IndexScheduler(db, { workers: 1 });
  server = createServer(0, { db, scheduler, hub: new SseHub(), claudeDir: dir });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

describe("index routes", () => {
  test("GET /api/index/status returns idle status before any scan", async () => {
    const res = await fetch(`${base}/api/index/status`);
    expect(res.status).toBe(200);
    const status = (await res.json()) as IndexStatus;
    expect(status.phase).toBe("idle");
    expect(status.filesTotal).toBe(0);
  });

  test("POST /api/index/rescan kicks off a scan and SSE carries progress", async () => {
    const abort = new AbortController();
    const eventsRes = await fetch(`${base}/api/events`, { signal: abort.signal });
    expect(eventsRes.headers.get("content-type")).toBe("text/event-stream");
    const reader = eventsRes.body!.getReader();

    const res = await fetch(`${base}/api/index/rescan`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ started: true });

    // collect SSE until the progress event arrives
    const dec = new TextDecoder();
    let buf = "";
    const deadline = Date.now() + 3000;
    while (!buf.includes("event: index.progress") && Date.now() < deadline) {
      const r = await Promise.race([
        reader.read(),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("sse timeout")), 3000)),
      ]);
      if (r.done) break;
      buf += dec.decode(r.value, { stream: true });
    }
    expect(buf).toContain("event: index.progress");
    abort.abort();

    await scheduler.runScan(dir); // join (or no-op) to make completion deterministic
    expect((db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n).toBe(1);
  });

  test("POST /api/index/rescan {full:true} clears and rebuilds", async () => {
    db.run("INSERT INTO parse_errors (file_path, byte_offset, line_no, error, ts) VALUES ('x', 0, 0, 'stale', 0)");
    const res = await fetch(`${base}/api/index/rescan`, {
      method: "POST",
      body: JSON.stringify({ full: true }),
    });
    expect(res.status).toBe(202);
    await scheduler.runScan(dir);
    expect((db.prepare("SELECT COUNT(*) AS n FROM parse_errors").get() as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n).toBe(1);
    expect((db.prepare("SELECT COUNT(*) AS n FROM messages").get() as { n: number }).n).toBe(1);
  });

  test("index routes absent without deps (health-only server still works)", async () => {
    const bare = createServer(0);
    try {
      const health = await fetch(`http://127.0.0.1:${bare.port}/api/health`);
      expect(health.status).toBe(200);
      const status = await fetch(`http://127.0.0.1:${bare.port}/api/index/status`);
      expect(status.status).toBe(404);
    } finally {
      bare.stop(true);
    }
  });
});
