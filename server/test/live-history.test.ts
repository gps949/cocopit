import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importPromptHistory } from "../cc/history";
import { listLiveSessions } from "../cc/liveSessions";
import { applyMigrations, openDb } from "../db/db";
import { SseHub } from "../http/sse";
import { createServer } from "../index";
import { IndexScheduler } from "../indexer/scheduler";

let dir: string;
let db: Database;
let server: ReturnType<typeof createServer>;
let base: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "cocopit-live-"));
  mkdirSync(join(dir, "sessions"), { recursive: true });
  writeFileSync(
    join(dir, "sessions", "1.json"),
    JSON.stringify({
      pid: process.pid, // definitely alive
      sessionId: "live-1",
      cwd: "/tmp/x",
      name: "活跃会话",
      status: "idle",
      startedAt: 1,
      updatedAt: 2,
    }),
  );
  writeFileSync(
    join(dir, "sessions", "2.json"),
    JSON.stringify({ pid: 99999999, sessionId: "dead-1", cwd: "/tmp/y", startedAt: 1 }),
  );
  // same live pid, but a procStart that cannot match → PID was reused
  writeFileSync(
    join(dir, "sessions", "3.json"),
    JSON.stringify({
      pid: process.pid,
      sessionId: "reused-1",
      cwd: "/tmp/z",
      procStart: "Mon Jan  1 00:00:00 2001",
      startedAt: 1,
    }),
  );
  writeFileSync(join(dir, "sessions", "junk.json"), "{ not json");

  writeFileSync(
    join(dir, "history.jsonl"),
    [
      JSON.stringify({ display: "优化索引结构", timestamp: 100, project: "/tmp/x", sessionId: "s1" }),
      JSON.stringify({ display: "fix webpack", timestamp: 200, project: "/tmp/y", sessionId: "s2" }),
    ].join("\n") + "\n",
  );

  db = openDb(":memory:");
  applyMigrations(db);
  server = createServer(0, {
    db,
    scheduler: new IndexScheduler(db, { workers: 1 }),
    hub: new SseHub(),
    claudeDir: dir,
    claudeJsonPath: join(dir, "claude.json"),
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

describe("live sessions", () => {
  test("lists registry entries with liveness check", () => {
    const sessions = listLiveSessions(dir);
    expect(sessions).toHaveLength(3); // junk tolerated & skipped
    const alive = sessions.find((s) => s.sessionId === "live-1")!;
    expect(alive.alive).toBe(true);
    expect(alive.name).toBe("活跃会话");
    const dead = sessions.find((s) => s.sessionId === "dead-1")!;
    expect(dead.alive).toBe(false);
  });

  test("a recycled pid is not reported alive (procStart mismatch)", () => {
    const reused = listLiveSessions(dir).find((s) => s.sessionId === "reused-1")!;
    expect(reused.alive).toBe(false);
  });

  test("a genuine procStart matches — Claude Code records it in UTC, ps prints local", () => {
    // Regression: comparing the stored UTC string against local `ps` output
    // marks every live session dead.
    const child = spawn("sleep", ["30"], { stdio: "ignore" });
    try {
      const utcStart = spawnSync("ps", ["-o", "lstart=", "-p", String(child.pid)], {
        encoding: "utf8",
        env: { ...process.env, TZ: "UTC" },
      }).stdout.trim();
      expect(utcStart.length).toBeGreaterThan(0);

      const liveDir = mkdtempSync(join(tmpdir(), "cocopit-live-real-"));
      mkdirSync(join(liveDir, "sessions"), { recursive: true });
      writeFileSync(
        join(liveDir, "sessions", "x.json"),
        JSON.stringify({ pid: child.pid, sessionId: "real-1", cwd: "/tmp", procStart: utcStart }),
      );
      const found = listLiveSessions(liveDir).find((s) => s.sessionId === "real-1")!;
      expect(found.alive).toBe(true);
      rmSync(liveDir, { recursive: true, force: true });
    } finally {
      child.kill();
    }
  });

  test("GET /api/live serves them", async () => {
    const res = await fetch(`${base}/api/live`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessions: any[] };
    expect(body.sessions.some((s) => s.sessionId === "live-1" && s.alive)).toBe(true);
  });
});

describe("prompt history", () => {
  test("imports incrementally via byte cursor", () => {
    const first = importPromptHistory(db, dir);
    expect(first.imported).toBe(2);
    appendFileSync(
      join(dir, "history.jsonl"),
      JSON.stringify({ display: "再来一条", timestamp: 300, project: "/tmp/x", sessionId: "s3" }) + "\n",
    );
    const second = importPromptHistory(db, dir);
    expect(second.imported).toBe(1);
    const n = db.prepare("SELECT COUNT(*) AS n FROM prompt_history").get() as { n: number };
    expect(n.n).toBe(3);
    // idempotent when nothing changed
    expect(importPromptHistory(db, dir).imported).toBe(0);
  });

  test("GET /api/history?q filters with LIKE, newest first", async () => {
    const res = await fetch(`${base}/api/history?q=${encodeURIComponent("索引")}`);
    const body = (await res.json()) as { entries: any[] };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].display).toBe("优化索引结构");

    const all = (await (await fetch(`${base}/api/history`)).json()) as { entries: any[] };
    expect(all.entries[0].timestamp).toBe(300);
    expect(all.entries).toHaveLength(3);
  });
});
