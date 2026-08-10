import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IndexStatus } from "../../shared/types";
import { applyMigrations, openDb } from "../db/db";
import { IndexScheduler } from "../indexer/scheduler";

const T1 = "2026-08-01T10:00:00.000Z";
const T2 = "2026-08-01T10:00:05.000Z";
const T3 = "2026-08-01T10:00:10.000Z";

const l = (obj: unknown) => JSON.stringify(obj) + "\n";

const userA = {
  uuid: "ua1",
  parentUuid: null,
  sessionId: "s-aaa",
  timestamp: T1,
  cwd: "/Users/x/proj-a",
  gitBranch: "main",
  version: "2.1.226",
  slug: "fix-indexer",
  type: "user",
  message: { role: "user", content: "帮我修复索引器的 bug" },
};
const asstA = {
  uuid: "aa1",
  parentUuid: "ua1",
  sessionId: "s-aaa",
  timestamp: T2,
  type: "assistant",
  message: {
    model: "claude-fable-5",
    role: "assistant",
    content: [
      { type: "text", text: "好的,我来看看代码" },
      { type: "tool_use", id: "tu1", name: "Bash", input: { command: "ls" } },
    ],
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 10,
      cache_creation_input_tokens: 20,
    },
  },
};
const titleA = { uuid: "ta1", sessionId: "s-aaa", timestamp: T3, type: "ai-title", title: "索引器修复" };
const BROKEN_LINE = "{ broken json\n";
const TRUNC_HEAD = '{"type":"user","uuid":"trunc","sessionId":"s-aaa","timestamp":"' + T3 + '"';
const TRUNC_TAIL = ',"message":{"role":"user","content":"resumed"}}';

const subLine = {
  uuid: "sa1",
  timestamp: T2,
  type: "assistant",
  message: {
    model: "claude-fable-5",
    role: "assistant",
    content: [{ type: "text", text: "sub result" }],
    usage: { input_tokens: 30, output_tokens: 5 },
  },
};

const userB = {
  uuid: "ub1",
  sessionId: "s-bbb",
  timestamp: T1,
  cwd: "/Users/x/proj-a",
  type: "user",
  message: { role: "user", content: "hello bbb" },
};
const asstB = {
  uuid: "ab1",
  sessionId: "s-bbb",
  timestamp: T2,
  type: "assistant",
  message: {
    model: "claude-opus-4-8[1m]",
    role: "assistant",
    content: [{ type: "text", text: "greetings from bbb assistant" }],
    usage: { input_tokens: 10, output_tokens: 5 },
  },
};

const commandNoiseC = {
  uuid: "uc0",
  sessionId: "s-ccc",
  timestamp: T2,
  cwd: "/Users/y/proj-b",
  type: "user",
  message: {
    role: "user",
    content: "<command-name>/clear</command-name>\n<command-message>clear</command-message>",
  },
};
const userC = {
  uuid: "uc1",
  sessionId: "s-ccc",
  timestamp: T3,
  cwd: "/Users/y/proj-b",
  type: "user",
  message: { role: "user", content: "test c" },
};

let dir: string;
let workDir: string;
let db: Database;
let scheduler: IndexScheduler;
let aaaPath: string;
let bbbPath: string;
const events: IndexStatus[] = [];

const sources = () => [
  { profileId: "default", dir },
  { profileId: "work", dir: workDir },
];

const AAA_COMPLETE = l(userA) + l(asstA) + l(titleA) + BROKEN_LINE;
const AAA_CONTENT = AAA_COMPLETE + TRUNC_HEAD;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ccockpit-pipeline-"));
  const p1 = join(dir, "projects", "-p1");
  const p2 = join(dir, "projects", "-p2");
  mkdirSync(p1, { recursive: true });
  mkdirSync(p2, { recursive: true });

  aaaPath = join(p1, "s-aaa.jsonl");
  writeFileSync(aaaPath, AAA_CONTENT);

  const subDir = join(p1, "s-aaa", "subagents");
  mkdirSync(subDir, { recursive: true });
  writeFileSync(join(subDir, "agent-x1.jsonl"), l(subLine));
  writeFileSync(
    join(subDir, "agent-x1.meta.json"),
    JSON.stringify({ agentType: "explore", description: "search files", toolUseId: "tu1", spawnDepth: 1 }),
  );

  bbbPath = join(p1, "s-bbb.jsonl");
  writeFileSync(bbbPath, l(userB) + l(asstB));
  writeFileSync(join(p2, "s-ccc.jsonl"), l(commandNoiseC) + l(userC));

  // a second profile's config dir with its own project/session
  workDir = mkdtempSync(join(tmpdir(), "ccockpit-pipeline-work-"));
  const wp = join(workDir, "projects", "-wp1");
  mkdirSync(wp, { recursive: true });
  writeFileSync(
    join(wp, "s-work.jsonl"),
    l({
      uuid: "uw1",
      sessionId: "s-work",
      timestamp: T1,
      cwd: "/tmp/workproj",
      type: "user",
      message: { role: "user", content: "work profile session" },
    }),
  );

  db = openDb(":memory:");
  applyMigrations(db);
  scheduler = new IndexScheduler(db, { workers: 2 });
  scheduler.addEventListener("progress", (e) => {
    events.push((e as CustomEvent<IndexStatus>).detail);
  });
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(workDir, { recursive: true, force: true });
});

function count(sql: string, ...params: unknown[]): number {
  return (db.prepare(sql).get(...(params as never[])) as { n: number }).n;
}

describe("index pipeline", () => {
  test("full scan indexes sessions, messages, usage, tools, subagents, fts, errors", async () => {
    const summary = await scheduler.runScan(sources());
    expect(summary.workItems).toBe(5); // 3 default sessions + 1 subagent + 1 work-profile session

    const aaa = db.prepare("SELECT * FROM sessions WHERE id = 's-aaa'").get() as Record<string, unknown>;
    expect(aaa.line_count).toBe(4); // truncated tail not consumed
    expect(aaa.user_msg_count).toBe(1);
    expect(aaa.assistant_msg_count).toBe(1);
    expect(aaa.title).toBe("索引器修复");
    expect(aaa.slug).toBe("fix-indexer");
    expect(aaa.git_branch).toBe("main");
    expect(aaa.cc_version).toBe("2.1.226");
    expect(aaa.input_tokens).toBe(100);
    expect(aaa.output_tokens).toBe(50);
    expect(aaa.cache_read_tokens).toBe(10);
    expect(aaa.cache_creation_tokens).toBe(20);
    expect(JSON.parse(aaa.models as string)).toEqual(["claude-fable-5"]);
    expect(aaa.parsed_bytes).toBe(Buffer.byteLength(AAA_COMPLETE));
    expect(aaa.file_size).toBe(Buffer.byteLength(AAA_CONTENT));
    expect(aaa.subagent_count).toBe(1);
    expect(aaa.first_ts).toBe(Date.parse(T1));
    expect(aaa.last_ts).toBe(Date.parse(T3));

    const bbb = db.prepare("SELECT * FROM sessions WHERE id = 's-bbb'").get() as Record<string, unknown>;
    expect(JSON.parse(bbb.models as string)).toEqual(["claude-opus-4-8"]);
    expect(bbb.title).toBe("hello bbb"); // no ai-title → first user text

    // command-noise user lines must not become the title fallback
    const ccc = db.prepare("SELECT * FROM sessions WHERE id = 's-ccc'").get() as Record<string, unknown>;
    expect(ccc.title).toBe("test c");

    expect(count("SELECT COUNT(*) AS n FROM sessions")).toBe(4);
    expect(count("SELECT COUNT(*) AS n FROM projects")).toBe(3);
    const workProject = db
      .prepare("SELECT * FROM projects WHERE profile_id = 'work'")
      .get() as Record<string, unknown>;
    expect(workProject.dir_name).toBe("-wp1");
    expect(workProject.cwd).toBe("/tmp/workproj");
    const p1 = db.prepare("SELECT * FROM projects WHERE dir_name = '-p1'").get() as Record<string, unknown>;
    expect(p1.cwd).toBe("/Users/x/proj-a");

    // messages: seq contiguous, broken line excluded
    const msgs = db
      .prepare("SELECT uuid, seq, byte_offset, byte_len, type FROM messages WHERE session_id = 's-aaa' ORDER BY seq")
      .all() as Array<Record<string, unknown>>;
    expect(msgs.map((m) => m.uuid)).toEqual(["ua1", "aa1", "ta1"]);
    expect(msgs.map((m) => m.seq)).toEqual([0, 1, 2]);

    // byte_offset round-trip: slice the original file and re-read the line
    const fileBytes = readFileSync(aaaPath);
    const m1 = msgs[1]!;
    const sliced = fileBytes
      .subarray(m1.byte_offset as number, (m1.byte_offset as number) + (m1.byte_len as number))
      .toString("utf8");
    expect(sliced).toBe(l(asstA));

    // usage events: aaa main + aaa subagent + bbb
    expect(count("SELECT COUNT(*) AS n FROM usage_events")).toBe(3);

    // priced at ingest time: fable-5 rates for asstA
    const aaaUsage = db
      .prepare("SELECT * FROM usage_events WHERE session_id = 's-aaa' AND source = 'main'")
      .get() as Record<string, unknown>;
    // 100 in ×$10 + 50 out ×$50 + 10 read ×$1 + 20 w5m ×$12.50, per MTok
    expect(aaaUsage.cost_usd as number).toBeCloseTo((100 * 10 + 50 * 50 + 10 * 1 + 20 * 12.5) / 1e6, 12);
    expect(aaaUsage.pricing_version).toBe(1);
    // session rollup includes the subagent's spend (30 in ×$10 + 5 out ×$50 per MTok)
    const subCost = (30 * 10 + 5 * 50) / 1e6;
    expect(aaa.cost_usd as number).toBeCloseTo((aaaUsage.cost_usd as number) + subCost, 12);
    const subUsage = db
      .prepare("SELECT * FROM usage_events WHERE source = 'subagent'")
      .get() as Record<string, unknown>;
    expect(subUsage.session_id).toBe("s-aaa");
    expect(subUsage.agent_id).toBe("x1");
    expect(subUsage.input_tokens).toBe(30);
    const bbbUsage = db
      .prepare("SELECT * FROM usage_events WHERE session_id = 's-bbb'")
      .get() as Record<string, unknown>;
    expect(bbbUsage.model).toBe("claude-opus-4-8");
    expect(bbbUsage.context_tier).toBe("long"); // [1m] variant priced separately
    expect(subUsage.context_tier).toBe("default");

    // tool calls
    const tools = db.prepare("SELECT * FROM tool_calls").all() as Array<Record<string, unknown>>;
    expect(tools).toHaveLength(1);
    expect(tools[0]!.tool_name).toBe("Bash");

    // subagents
    const sub = db.prepare("SELECT * FROM subagents").get() as Record<string, unknown>;
    expect(sub.session_id).toBe("s-aaa");
    expect(sub.agent_id).toBe("x1");
    expect(sub.agent_type).toBe("explore");
    expect(sub.spawn_depth).toBe(1);
    expect(sub.parsed_bytes).toBe(Buffer.byteLength(l(subLine)));

    // parse errors: exactly the broken line
    const errs = db.prepare("SELECT * FROM parse_errors").all() as Array<Record<string, unknown>>;
    expect(errs).toHaveLength(1);
    expect(errs[0]!.file_path).toBe(aaaPath);

    // FTS trigram: Chinese and English substrings
    expect(count("SELECT COUNT(*) AS n FROM fts_messages WHERE fts_messages MATCH '索引器'")).toBeGreaterThan(0);
    expect(count("SELECT COUNT(*) AS n FROM fts_messages WHERE fts_messages MATCH 'bbb assistant'")).toBe(1);
  });

  test("append resumes from cursor without duplicates", async () => {
    const newAsst = {
      uuid: "aa2",
      sessionId: "s-aaa",
      timestamp: T3,
      type: "assistant",
      message: {
        model: "claude-fable-5",
        role: "assistant",
        content: [{ type: "text", text: "appended reply" }],
        usage: { input_tokens: 7, output_tokens: 3 },
      },
    };
    appendFileSync(aaaPath, TRUNC_TAIL + "\n" + l(newAsst));

    const summary = await scheduler.runScan(sources());
    expect(summary.workItems).toBe(1);

    const aaa = db.prepare("SELECT * FROM sessions WHERE id = 's-aaa'").get() as Record<string, unknown>;
    expect(aaa.line_count).toBe(6);
    expect(aaa.user_msg_count).toBe(2); // + resumed truncated user line
    expect(aaa.assistant_msg_count).toBe(2);
    expect(aaa.input_tokens).toBe(107);
    expect(aaa.output_tokens).toBe(53);
    expect(aaa.title).toBe("索引器修复"); // preserved across append
    expect(aaa.parsed_bytes).toBe(Buffer.byteLength(readFileSync(aaaPath)));

    const msgs = db
      .prepare("SELECT uuid, seq FROM messages WHERE session_id = 's-aaa' ORDER BY seq")
      .all() as Array<Record<string, unknown>>;
    expect(msgs.map((m) => m.uuid)).toEqual(["ua1", "aa1", "ta1", "trunc", "aa2"]);
    expect(msgs.map((m) => m.seq)).toEqual([0, 1, 2, 4, 5]); // seq 3 was the broken line

    expect(count("SELECT COUNT(*) AS n FROM usage_events WHERE session_id = 's-aaa' AND source = 'main'")).toBe(2);
    expect(count("SELECT COUNT(*) AS n FROM parse_errors")).toBe(1); // broken line not re-recorded
  });

  test("shrunk file reparses cleanly", async () => {
    writeFileSync(bbbPath, l(userB)); // drop the assistant line
    const summary = await scheduler.runScan(sources());
    expect(summary.workItems).toBe(1);

    const bbb = db.prepare("SELECT * FROM sessions WHERE id = 's-bbb'").get() as Record<string, unknown>;
    expect(bbb.line_count).toBe(1);
    expect(bbb.input_tokens).toBe(0);
    expect(JSON.parse(bbb.models as string)).toEqual([]);

    expect(count("SELECT COUNT(*) AS n FROM messages WHERE session_id = 's-bbb'")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM usage_events WHERE session_id = 's-bbb'")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM fts_messages WHERE fts_messages MATCH 'bbb assistant'")).toBe(0);
  });

  test("status flips to scanning synchronously on runScan (no idle race window)", async () => {
    const promise = scheduler.runScan(sources());
    // before any await resolves, a status probe must not report the stale idle
    expect(scheduler.status.phase).toBe("scanning");
    await promise;
    expect(scheduler.status.phase).toBe("idle");
  });

  test("second scan with no changes is a no-op", async () => {
    const before = count("SELECT COUNT(*) AS n FROM messages");
    const summary = await scheduler.runScan(sources());
    expect(summary.workItems).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM messages")).toBe(before);
  });

  test("progress events fired and status settled to idle", () => {
    expect(events.length).toBeGreaterThan(0);
    expect(events.at(-1)!.pct).toBe(1);
    const status = scheduler.status;
    expect(status.phase).toBe("idle");
    expect(status.filesDone).toBe(status.filesTotal);
    expect(db.prepare("SELECT value FROM meta WHERE key = 'last_scan_at'").get()).toBeTruthy();
  });
});
