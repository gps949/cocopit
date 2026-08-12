import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations, openDb } from "../db/db";
import { SseHub } from "../http/sse";
import { createServer } from "../index";
import { IndexScheduler } from "../indexer/scheduler";

const T = (s: number) => `2026-08-0${s}T10:00:00.000Z`;
const l = (obj: unknown) => JSON.stringify(obj) + "\n";

let dir: string;
let db: Database;
let server: ReturnType<typeof createServer>;
let base: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "cocopit-sess-"));
  const p1 = join(dir, "projects", "-proj-alpha");
  mkdirSync(p1, { recursive: true });

  // session one: Chinese content + assistant + subagent
  writeFileSync(
    join(p1, "sess-one.jsonl"),
    l({
      uuid: "u1",
      parentUuid: null,
      sessionId: "sess-one",
      timestamp: T(1),
      cwd: "/tmp/alpha",
      type: "user",
      message: { role: "user", content: "优化数据库索引结构" },
    }) +
      l({
        uuid: "a1",
        parentUuid: "u1",
        sessionId: "sess-one",
        timestamp: T(2),
        type: "assistant",
        message: {
          model: "claude-fable-5",
          role: "assistant",
          content: [{ type: "text", text: "好的,我们从 B+ 树讲起" }],
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      }),
  );
  const subDir = join(p1, "sess-one", "subagents");
  mkdirSync(subDir, { recursive: true });
  writeFileSync(
    join(subDir, "agent-z9.jsonl"),
    l({
      uuid: "sz1",
      timestamp: T(2),
      type: "assistant",
      message: {
        model: "claude-haiku-4-5",
        role: "assistant",
        content: [{ type: "text", text: "sub" }],
        usage: { input_tokens: 3, output_tokens: 1 },
      },
    }),
  );
  writeFileSync(join(subDir, "agent-z9.meta.json"), JSON.stringify({ agentType: "explore" }));

  // session two: later, english
  writeFileSync(
    join(p1, "sess-two.jsonl"),
    l({
      uuid: "u2",
      parentUuid: null,
      sessionId: "sess-two",
      timestamp: T(3),
      cwd: "/tmp/alpha",
      type: "user",
      message: { role: "user", content: "review the webpack config" },
    }),
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
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

async function get(path: string): Promise<any> {
  const res = await fetch(`${base}${path}`);
  expect(res.status).toBe(200);
  return res.json();
}

describe("projects & sessions routes", () => {
  test("GET /api/projects lists projects with rollups", async () => {
    const body = await get("/api/projects");
    expect(body.projects).toHaveLength(1);
    const p = body.projects[0];
    expect(p.cwd).toBe("/tmp/alpha");
    expect(p.sessionCount).toBe(2);
    expect(p.costUsd).toBeGreaterThan(0);
  });

  test("GET /api/sessions lists newest first with summary fields", async () => {
    const body = await get("/api/sessions");
    expect(body.sessions).toHaveLength(2);
    expect(body.sessions[0].id).toBe("sess-two");
    expect(body.sessions[1].id).toBe("sess-one");
    expect(body.sessions[1].title).toBe("优化数据库索引结构");
    expect(body.sessions[1].subagentCount).toBe(1);
  });

  test("FTS q matches Chinese substrings and filters sessions", async () => {
    const body = await get(`/api/sessions?q=${encodeURIComponent("数据库索引")}`);
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].id).toBe("sess-one");

    const english = await get("/api/sessions?q=webpack");
    expect(english.sessions).toHaveLength(1);
    expect(english.sessions[0].id).toBe("sess-two");

    const none = await get(`/api/sessions?q=${encodeURIComponent("不存在的词组")}`);
    expect(none.sessions).toHaveLength(0);
  });

  test("keyset pagination via cursor", async () => {
    const page1 = await get("/api/sessions?limit=1");
    expect(page1.sessions).toHaveLength(1);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = await get(`/api/sessions?limit=1&cursor=${encodeURIComponent(page1.nextCursor)}`);
    expect(page2.sessions).toHaveLength(1);
    expect(page2.sessions[0].id).not.toBe(page1.sessions[0].id);
    expect(page2.nextCursor).toBeNull();
  });

  test("GET /api/sessions/:id returns summary plus subagents", async () => {
    const body = await get("/api/sessions/sess-one");
    expect(body.session.id).toBe("sess-one");
    expect(body.session.models).toEqual(["claude-fable-5"]);
    expect(body.subagents).toHaveLength(1);
    expect(body.subagents[0].agentId).toBe("z9");
    expect(body.subagents[0].agentType).toBe("explore");
  });

  test("messages endpoint seeks原文 from the jsonl file", async () => {
    const body = await get("/api/sessions/sess-one/messages?fromSeq=0&limit=10");
    expect(body.messages).toHaveLength(2);
    const first = body.messages[0];
    expect(first.seq).toBe(0);
    expect(first.uuid).toBe("u1");
    expect(first.record.message.content).toBe("优化数据库索引结构");
    const second = body.messages[1];
    expect(second.record.message.content[0].text).toBe("好的,我们从 B+ 树讲起");
    expect(body.nextFromSeq).toBeNull();
  });

  test("single message by uuid", async () => {
    const body = await get("/api/sessions/sess-one/messages/a1");
    expect(body.record.message.usage.input_tokens).toBe(10);
  });

  test("oversized bodies are skipped in list reads, still fetchable one by one", async () => {
    // a single line can reach ~10MB in real transcripts; a 200-row page must not
    // try to materialize them all
    const list = await get("/api/sessions/sess-one/messages?maxBodyBytes=20");
    expect(list.messages).toHaveLength(2);
    expect(list.messages.every((m: any) => m.record === null && m.truncated === true)).toBe(true);
    expect(list.messages[0].byteLen).toBeGreaterThan(20);

    // the single-message endpoint ignores the list cap
    const single = await get("/api/sessions/sess-one/messages/u1?maxBodyBytes=20");
    expect(single.record.message.content).toBe("优化数据库索引结构");
  });

  test("outline lists only real user turns, straight from the index", async () => {
    const body = await get("/api/sessions/sess-one/outline");
    // tool-result carriers and assistant records must not appear as turns
    expect(body.turns).toHaveLength(1);
    expect(body.turns[0].snippet).toBe("优化数据库索引结构");
    expect(body.turns[0].seq).toBe(0);
    expect(body.total).toBe(2);
  });

  test("tail returns the newest window, still in chronological order", async () => {
    const body = await get("/api/sessions/sess-one/messages?tail=1");
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].uuid).toBe("a1"); // the last one
    expect(body.nextFromSeq).toBeNull(); // already at the end
    expect(body.prevBeforeSeq).toBe(1); // older messages remain above
  });

  test("before= loads the window above, ascending", async () => {
    const body = await get("/api/sessions/sess-one/messages?before=1&limit=10");
    expect(body.messages.map((m: any) => m.uuid)).toEqual(["u1"]);
    expect(body.prevBeforeSeq).toBeNull(); // reached the beginning
  });

  test("in-session search returns seq to jump to", async () => {
    const r = await get("/api/sessions/sess-one/search?q=数据库索引");
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0].type).toBe("user");
    expect(typeof r.hits[0].seq).toBe("number");
    expect(r.hits[0].snippet).toContain("数据库索引");

    // a hit in another session must not leak in
    const none = await get("/api/sessions/sess-two/search?q=数据库索引");
    expect(none.hits).toHaveLength(0);
  });

  test("in-session search rejects short queries", async () => {
    const res = await fetch(`${base}/api/sessions/sess-one/search?q=ab`);
    expect(res.status).toBe(400);
  });

  test("404 for unknown session", async () => {
    const res = await fetch(`${base}/api/sessions/nope`);
    expect(res.status).toBe(404);
  });
});
