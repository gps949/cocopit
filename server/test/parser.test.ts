import { describe, expect, test } from "bun:test";
import { normalizeModel, parseLine } from "../indexer/parser";
import { LineSplitter, type RawLine } from "../indexer/scanner-lines";

function raw(text: string, byteOffset = 0): RawLine {
  return { text, byteOffset, byteLen: Buffer.byteLength(text, "utf8") + 1 };
}

const ENVELOPE = {
  uuid: "u1",
  parentUuid: "p1",
  sessionId: "s1",
  timestamp: "2026-08-09T12:00:00.000Z",
  cwd: "/tmp/proj",
  gitBranch: "main",
  version: "2.1.226",
  slug: "test-slug",
  isSidechain: false,
};

describe("normalizeModel", () => {
  test("plain model → default tier", () => {
    expect(normalizeModel("claude-fable-5")).toEqual({
      base: "claude-fable-5",
      contextTier: "default",
      synthetic: false,
    });
  });

  test("[1m] suffix → stripped base + long tier", () => {
    expect(normalizeModel("claude-opus-4-8[1m]")).toEqual({
      base: "claude-opus-4-8",
      contextTier: "long",
      synthetic: false,
    });
  });

  test("<synthetic> → synthetic flag", () => {
    expect(normalizeModel("<synthetic>").synthetic).toBe(true);
  });
});

describe("parseLine: assistant", () => {
  test("full usage with 5m/1h split and server_tool_use", () => {
    const line = {
      ...ENVELOPE,
      type: "assistant",
      message: {
        model: "claude-fable-5",
        role: "assistant",
        content: [{ type: "text", text: "hello world" }],
        stop_reason: "end_turn",
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          cache_creation_input_tokens: 30,
          cache_read_input_tokens: 40,
          cache_creation: { ephemeral_5m_input_tokens: 12, ephemeral_1h_input_tokens: 18 },
          service_tier: "standard",
          server_tool_use: { web_search_requests: 2, web_fetch_requests: 3 },
        },
      },
    };
    const p = parseLine(raw(JSON.stringify(line)), 0);
    expect(p.ok).toBe(true);
    expect(p.uuid).toBe("u1");
    expect(p.parentUuid).toBe("p1");
    expect(p.sessionId).toBe("s1");
    expect(p.cwd).toBe("/tmp/proj");
    expect(p.gitBranch).toBe("main");
    expect(p.version).toBe("2.1.226");
    expect(p.slug).toBe("test-slug");
    expect(p.isSidechain).toBe(false);
    expect(p.ts).toBe(Date.parse("2026-08-09T12:00:00.000Z"));
    expect(p.type).toBe("assistant");
    expect(p.model).toBe("claude-fable-5");
    expect(p.usage).toEqual({
      model: "claude-fable-5",
      contextTier: "default",
      serviceTier: "standard",
      input: 10,
      output: 20,
      cacheRead: 40,
      cacheW5m: 12,
      cacheW1h: 18,
      webSearch: 2,
      webFetch: 3,
    });
    expect(p.assistantText).toBe("hello world");
    expect(p.snippet).toBe("hello world");
  });

  test("usage without cache_creation breakdown → full amount into cacheW5m", () => {
    const line = {
      ...ENVELOPE,
      type: "assistant",
      message: {
        model: "claude-fable-5",
        role: "assistant",
        content: [],
        usage: { input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 99 },
      },
    };
    const p = parseLine(raw(JSON.stringify(line)), 0);
    expect(p.usage?.cacheW5m).toBe(99);
    expect(p.usage?.cacheW1h).toBe(0);
    expect(p.usage?.cacheRead).toBe(0);
    expect(p.usage?.webSearch).toBe(0);
    expect(p.usage?.webFetch).toBe(0);
    expect(p.usage?.serviceTier).toBeUndefined();
  });

  test("[1m] model → usage carries stripped base + long tier, p.model keeps raw", () => {
    const line = {
      ...ENVELOPE,
      type: "assistant",
      message: {
        model: "claude-opus-4-8[1m]",
        role: "assistant",
        content: [],
        usage: { input_tokens: 5 },
      },
    };
    const p = parseLine(raw(JSON.stringify(line)), 0);
    expect(p.model).toBe("claude-opus-4-8[1m]");
    expect(p.usage?.model).toBe("claude-opus-4-8");
    expect(p.usage?.contextTier).toBe("long");
    expect(p.usage?.input).toBe(5);
    expect(p.usage?.output).toBe(0);
  });

  test("<synthetic> model → no usage", () => {
    const line = {
      ...ENVELOPE,
      type: "assistant",
      message: {
        model: "<synthetic>",
        role: "assistant",
        content: [{ type: "text", text: "synthetic reply" }],
        usage: { input_tokens: 10, output_tokens: 10 },
      },
    };
    const p = parseLine(raw(JSON.stringify(line)), 0);
    expect(p.ok).toBe(true);
    expect(p.model).toBe("<synthetic>");
    expect(p.usage).toBeUndefined();
  });

  test("missing model → no usage", () => {
    const line = {
      ...ENVELOPE,
      type: "assistant",
      message: { role: "assistant", content: [], usage: { input_tokens: 10 } },
    };
    const p = parseLine(raw(JSON.stringify(line)), 0);
    expect(p.usage).toBeUndefined();
  });

  test("missing usage object → no usage event", () => {
    const line = {
      ...ENVELOPE,
      type: "assistant",
      message: { model: "claude-fable-5", role: "assistant", content: [] },
    };
    const p = parseLine(raw(JSON.stringify(line)), 0);
    expect(p.usage).toBeUndefined();
  });

  test("tool_use blocks → toolNames, thinking blocks ignored in text", () => {
    const line = {
      ...ENVELOPE,
      type: "assistant",
      message: {
        model: "claude-fable-5",
        role: "assistant",
        content: [
          { type: "thinking", thinking: "let me think" },
          { type: "text", text: "running tests" },
          { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } },
          { type: "tool_use", id: "t2", name: "Read", input: { file_path: "/x" } },
        ],
      },
    };
    const p = parseLine(raw(JSON.stringify(line)), 0);
    expect(p.toolNames).toEqual(["Bash", "Read"]);
    expect(p.assistantText).toBe("running tests");
  });
});

describe("parseLine: system", () => {
  test("api_error subtype → no usage even if usage present", () => {
    const line = {
      ...ENVELOPE,
      type: "system",
      subtype: "api_error",
      message: { model: "claude-fable-5", usage: { input_tokens: 7 } },
    };
    const p = parseLine(raw(JSON.stringify(line)), 0);
    expect(p.ok).toBe(true);
    expect(p.subtype).toBe("api_error");
    expect(p.usage).toBeUndefined();
  });

  test("turn_duration subtype extracted", () => {
    const line = { ...ENVELOPE, type: "system", subtype: "turn_duration" };
    const p = parseLine(raw(JSON.stringify(line)), 0);
    expect(p.type).toBe("system");
    expect(p.subtype).toBe("turn_duration");
  });
});

describe("parseLine: user", () => {
  test("string content → firstUserText + snippet", () => {
    const line = {
      ...ENVELOPE,
      type: "user",
      message: { role: "user", content: "修复这个 bug" },
    };
    const p = parseLine(raw(JSON.stringify(line)), 0);
    expect(p.firstUserText).toBe("修复这个 bug");
    expect(p.snippet).toBe("修复这个 bug");
  });

  test("array content: text blocks joined, tool_result ignored", () => {
    const line = {
      ...ENVELOPE,
      type: "user",
      message: {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "t1", content: "big output" },
          { type: "text", text: "please continue" },
        ],
      },
    };
    const p = parseLine(raw(JSON.stringify(line)), 0);
    expect(p.firstUserText).toBe("please continue");
  });

  test("isMeta user line → no firstUserText", () => {
    const line = {
      ...ENVELOPE,
      isMeta: true,
      type: "user",
      message: { role: "user", content: "meta content" },
    };
    const p = parseLine(raw(JSON.stringify(line)), 0);
    expect(p.firstUserText).toBeUndefined();
    expect(p.snippet).toBeUndefined();
  });

  test("snippet is single-lined and capped at 300 characters", () => {
    const text = "a".repeat(150) + "\n" + "b".repeat(200);
    const line = { ...ENVELOPE, type: "user", message: { role: "user", content: text } };
    const p = parseLine(raw(JSON.stringify(line)), 0);
    expect(p.snippet).toBe(("a".repeat(150) + " " + "b".repeat(200)).slice(0, 300));
    expect(p.snippet?.length).toBe(300);
    expect(p.snippet?.includes("\n")).toBe(false);
    expect(p.firstUserText).toBe(text);
  });
});

describe("parseLine: other record types", () => {
  test("ai-title with title field", () => {
    const line = { ...ENVELOPE, type: "ai-title", title: "索引器实现" };
    const p = parseLine(raw(JSON.stringify(line)), 0);
    expect(p.aiTitle).toBe("索引器实现");
  });

  test("ai-title with content field fallback", () => {
    const line = { ...ENVELOPE, type: "ai-title", content: "Session title" };
    const p = parseLine(raw(JSON.stringify(line)), 0);
    expect(p.aiTitle).toBe("Session title");
  });

  test("unknown type → ok with envelope only", () => {
    const line = { ...ENVELOPE, type: "file-history-snapshot", snapshot: { big: true } };
    const p = parseLine(raw(JSON.stringify(line)), 7);
    expect(p.ok).toBe(true);
    expect(p.seq).toBe(7);
    expect(p.type).toBe("file-history-snapshot");
    expect(p.uuid).toBe("u1");
    expect(p.usage).toBeUndefined();
    expect(p.firstUserText).toBeUndefined();
    expect(p.assistantText).toBeUndefined();
    expect(p.snippet).toBeUndefined();
    expect(p.toolNames).toBeUndefined();
  });

  test("malformed JSON → ok=false with error, offsets preserved", () => {
    const p = parseLine(raw("{ not json at all", 42), 3);
    expect(p.ok).toBe(false);
    expect(p.error).toBeTruthy();
    expect(p.seq).toBe(3);
    expect(p.byteOffset).toBe(42);
    expect(p.byteLen).toBe(Buffer.byteLength("{ not json at all") + 1);
  });

  test("JSON scalar (not an object) → ok=false", () => {
    const p = parseLine(raw("42"), 0);
    expect(p.ok).toBe(false);
    expect(p.error).toBeTruthy();
  });

  test("invalid timestamp → ts undefined", () => {
    const line = { ...ENVELOPE, timestamp: "not-a-date", type: "user", message: { content: "x" } };
    const p = parseLine(raw(JSON.stringify(line)), 0);
    expect(p.ts).toBeUndefined();
  });
});

describe("byte accuracy end to end", () => {
  test("multi-byte lines through LineSplitter keep exact byte offsets", () => {
    const l1 = JSON.stringify({
      uuid: "a",
      type: "user",
      message: { role: "user", content: "你好,世界——多字节测试" },
    });
    const l2 = JSON.stringify({ uuid: "b", type: "user", message: { role: "user", content: "ok" } });
    const s = new LineSplitter(0);
    const rawLines = s.push(new TextEncoder().encode(l1 + "\n" + l2 + "\n"));
    const b1 = Buffer.byteLength(l1, "utf8") + 1;
    const b2 = Buffer.byteLength(l2, "utf8") + 1;
    expect(rawLines).toHaveLength(2);
    expect(rawLines[0]!.byteLen).toBe(b1);
    expect(rawLines[1]!.byteOffset).toBe(b1);
    expect(rawLines[1]!.byteLen).toBe(b2);
    expect(s.consumedBytes).toBe(b1 + b2);

    const p1 = parseLine(rawLines[0]!, 0);
    const p2 = parseLine(rawLines[1]!, 1);
    expect(p1.byteOffset).toBe(0);
    expect(p1.byteLen).toBe(b1);
    expect(p1.firstUserText).toBe("你好,世界——多字节测试");
    expect(p2.byteOffset).toBe(b1);
    expect(p2.uuid).toBe("b");
  });
});
