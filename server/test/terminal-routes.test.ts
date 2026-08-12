import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations, openDb } from "../db/db";
import { SseHub } from "../http/sse";
import { createServer } from "../index";
import { IndexScheduler } from "../indexer/scheduler";
import { killSession, listTmuxSessions, startSession } from "../terminal/tmux";

let dir: string;
let home: string;
let prevHome: string | undefined;
let db: Database;
let server: ReturnType<typeof createServer>;
let base: string;
const spawned: string[] = [];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "cocopit-term-"));
  home = mkdtempSync(join(tmpdir(), "cocopit-term-home-"));
  prevHome = process.env.COCOPIT_HOME;
  process.env.COCOPIT_HOME = home;

  const p1 = join(dir, "projects", "-term-proj");
  mkdirSync(p1, { recursive: true });
  writeFileSync(
    join(p1, "term-sess.jsonl"),
    JSON.stringify({
      uuid: "u1",
      sessionId: "term-sess",
      timestamp: "2026-08-01T10:00:00.000Z",
      cwd: "/tmp",
      type: "user",
      message: { role: "user", content: "terminal fixture" },
    }) + "\n",
  );

  db = openDb(":memory:");
  applyMigrations(db);
  const scheduler = new IndexScheduler(db, { workers: 1 });
  await scheduler.runScan([{ profileId: "default", dir }]);

  server = createServer(0, {
    db,
    scheduler,
    hub: new SseHub(),
    claudeDir: dir,
    claudeJsonPath: join(dir, "claude.json"),
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  for (const name of spawned) killSession(name);
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
  if (prevHome === undefined) delete process.env.COCOPIT_HOME;
  else process.env.COCOPIT_HOME = prevHome;
});

describe("terminal routes", () => {
  test("GET /api/terminal reports availability", async () => {
    const body = (await (await fetch(`${base}/api/terminal`)).json()) as any;
    expect(body.available).toBe(true);
    expect(Array.isArray(body.terminals)).toBe(true);
  });

  test("POST requires a known session or project", async () => {
    const empty = await fetch(`${base}/api/terminal`, { method: "POST", body: "{}" });
    expect(empty.status).toBe(400);
    const missing = await fetch(`${base}/api/terminal`, {
      method: "POST",
      body: JSON.stringify({ sessionId: "nope" }),
    });
    expect(missing.status).toBe(404);
  });

  test("POST creates a tmux session for a resume target", async () => {
    const res = await fetch(`${base}/api/terminal`, {
      method: "POST",
      body: JSON.stringify({ sessionId: "term-sess", cols: 100, rows: 30 }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    spawned.push(body.name);
    expect(body.name).toBe("cc-term-sess");
    expect(body.kind).toBe("resume");
    expect(listTmuxSessions().some((s) => s.name === "cc-term-sess")).toBe(true);

    // creating again attaches to the same session rather than duplicating
    const again = await fetch(`${base}/api/terminal`, {
      method: "POST",
      body: JSON.stringify({ sessionId: "term-sess" }),
    });
    expect(again.status).toBe(201);
    expect(listTmuxSessions().filter((s) => s.name === "cc-term-sess")).toHaveLength(1);
  });

  test("websocket attach streams output and accepts input", async () => {
    // a plain shell, not the resume target: typing into Claude Code's TUI tests
    // that TUI's rendering and boot time, not this websocket
    startSession({ name: "cc-term-ws", command: "sh", cwd: "/tmp", cols: 100, rows: 30 });
    spawned.push("cc-term-ws");
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/api/terminal/cc-term-ws/attach`);
    const messages: any[] = [];
    ws.onmessage = (event) => messages.push(JSON.parse(String(event.data)));
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("ws failed"));
      setTimeout(() => reject(new Error("ws timeout")), 4000);
    });

    // wait for the ready handshake (snapshot may precede it)
    const deadline = Date.now() + 4000;
    while (!messages.some((m) => m.type === "ready") && Date.now() < deadline) await Bun.sleep(100);
    expect(messages.some((m) => m.type === "ready")).toBe(true);

    // "ready" means the tmux attachment is live, not that the shell inside has
    // finished starting — keystrokes sent too early are simply lost, so resend
    // until the round trip lands rather than racing the shell's startup
    const seen = () => messages.some((m) => m.type === "output" && String(m.data).includes("WS_ROUND_TRIP"));
    const outDeadline = Date.now() + 10000;
    while (!seen() && Date.now() < outDeadline) {
      ws.send(JSON.stringify({ type: "input", data: "echo WS_ROUND_TRIP\n" }));
      for (let i = 0; i < 8 && !seen(); i++) await Bun.sleep(100);
    }
    expect(messages.some((m) => m.type === "output" && String(m.data).includes("WS_ROUND_TRIP"))).toBe(true);

    ws.close();
    await Bun.sleep(300);
    // detaching must not kill the session — that is the whole point of tmux
    expect(listTmuxSessions().some((s) => s.name === "cc-term-ws")).toBe(true);
  }, 20000);

  test("cross-origin websocket upgrades are refused", async () => {
    const res = await fetch(`${base}/api/terminal/cc-term-sess/attach`, {
      headers: {
        origin: "https://evil.example",
        upgrade: "websocket",
        connection: "Upgrade",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
      },
    });
    expect(res.status).toBe(403);
  });

  test("only cc- prefixed terminals can be closed", async () => {
    const bad = await fetch(`${base}/api/terminal/other-session`, { method: "DELETE" });
    expect(bad.status).toBe(400);

    const ok = await fetch(`${base}/api/terminal/cc-term-sess`, { method: "DELETE" });
    expect(ok.status).toBe(200);
    await Bun.sleep(300);
    expect(listTmuxSessions().some((s) => s.name === "cc-term-sess")).toBe(false);
  });
});
