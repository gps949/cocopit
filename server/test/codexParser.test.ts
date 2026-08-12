import { describe, expect, test } from "bun:test";
import { parseCodexLine, type CodexContext } from "../indexer/parser";
import type { RawLine } from "../indexer/scanner-lines";

const raw = (obj: unknown): RawLine => {
  const text = JSON.stringify(obj);
  return { text, byteOffset: 0, byteLen: Buffer.byteLength(text) + 1 };
};

const ctx = (): CodexContext => ({ sessionId: "0199-abc" });

describe("parseCodexLine", () => {
  test("session_meta yields cwd and cli version, no message row", () => {
    const line = parseCodexLine(
      raw({
        timestamp: "2026-06-27T01:41:29.584Z",
        type: "session_meta",
        payload: { id: "x", cwd: "/Users/demo/proj", cli_version: "0.137.0" },
      }),
      0,
      ctx(),
    );
    expect(line.type).toBe("session_meta");
    expect(line.cwd).toBe("/Users/demo/proj");
    expect(line.version).toBe("0.137.0");
    expect(line.uuid).toBeUndefined();
  });

  test("turn_context remembers the model for later token_counts", () => {
    const c = ctx();
    parseCodexLine(raw({ type: "turn_context", payload: { model: "gpt-5.3-codex" } }), 0, c);
    const usage = parseCodexLine(
      raw({
        timestamp: "2026-06-27T01:42:00.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 17880,
              cached_input_tokens: 4480,
              output_tokens: 261,
            },
          },
          rate_limits: { primary: { used_percent: 28, resets_at: 1770834889 } },
        },
      }),
      1,
      c,
    );
    expect(usage.usage).toMatchObject({
      model: "gpt-5.3-codex",
      // cached is a subset of input in OpenAI's accounting — split apart here
      input: 17880 - 4480,
      cacheRead: 4480,
      output: 261,
      cacheW5m: 0,
      cacheW1h: 0,
    });
    expect(usage.codexRateLimits?.primary?.used_percent).toBe(28);
    expect(usage.uuid).toBeUndefined(); // usage only, no message row
  });

  test("user speech gets a snippet; injected context does not", () => {
    const speech = parseCodexLine(
      raw({
        type: "response_item",
        payload: { type: "message", role: "user", content: [{ type: "input_text", text: "修复登录竞态" }] },
      }),
      3,
      ctx(),
    );
    expect(speech.type).toBe("user");
    expect(speech.snippet).toBe("修复登录竞态");
    expect(speech.uuid).toBe("cx-0199-abc-3");

    const noise = parseCodexLine(
      raw({
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "<environment_context>\n<cwd>/x</cwd>" }],
        },
      }),
      4,
      ctx(),
    );
    expect(noise.type).toBe("user");
    expect(noise.snippet).toBeUndefined();
  });

  test("assistant text is indexed for search; tools and reasoning are typed", () => {
    const c = ctx();
    parseCodexLine(raw({ type: "turn_context", payload: { model: "gpt-5.3-codex" } }), 0, c);
    const assistant = parseCodexLine(
      raw({
        type: "response_item",
        payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Done." }] },
      }),
      1,
      c,
    );
    expect(assistant.type).toBe("assistant");
    expect(assistant.assistantText).toBe("Done.");
    expect(assistant.model).toBe("gpt-5.3-codex");

    const call = parseCodexLine(
      raw({
        type: "response_item",
        payload: { type: "function_call", name: "exec_command", call_id: "call_1", arguments: "{}" },
      }),
      2,
      c,
    );
    expect(call.type).toBe("tool");
    expect(call.toolNames).toEqual(["exec_command"]);

    const reasoning = parseCodexLine(
      raw({ type: "response_item", payload: { type: "reasoning", summary: [] } }),
      3,
      c,
    );
    expect(reasoning.type).toBe("thinking");
  });

  test("developer instructions become meta, not conversation", () => {
    const line = parseCodexLine(
      raw({
        type: "response_item",
        payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "rules" }] },
      }),
      5,
      ctx(),
    );
    expect(line.type).toBe("meta");
    expect(line.snippet).toBeUndefined();
  });
});
