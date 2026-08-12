import { describe, expect, test } from "bun:test";
import {
  buildTranscript,
  collapseMeta,
  extractMemCitation,
  filterTranscript,
  summarizeTool,
  type RawMessage,
} from "../src/lib/transcript";

let seq = 0;
function msg(record: unknown, overrides: Partial<RawMessage> = {}): RawMessage {
  return { seq: seq++, uuid: `u${seq}`, record, byteLen: 100, ...overrides };
}

describe("summarizeTool", () => {
  test("uses the input key that identifies each tool", () => {
    expect(summarizeTool("Bash", { command: "ls -la", description: "list" })).toBe("ls -la");
    expect(summarizeTool("Read", { file_path: "/tmp/a.ts" })).toBe("/tmp/a.ts");
    expect(summarizeTool("Edit", { file_path: "/tmp/b.ts", old_string: "x" })).toBe("/tmp/b.ts");
    expect(summarizeTool("Skill", { skill: "superpowers:tdd", args: "run" })).toBe("superpowers:tdd run");
    expect(summarizeTool("TaskUpdate", { taskId: "3", status: "completed" })).toBe("3 → completed");
  });

  test("mcp tools and unknown tools fall back to their first meaningful string", () => {
    expect(summarizeTool("mcp__playwright__browser_navigate", { url: "https://x.dev" })).toBe("https://x.dev");
    expect(summarizeTool("SomethingNew", { foo: 1, prompt: "do it" })).toBe("do it");
    expect(summarizeTool("Empty", {})).toBe("");
  });
});

describe("buildTranscript", () => {
  test("a tool result is attached to its call, never rendered as a user message", () => {
    const entries = buildTranscript([
      msg({
        type: "assistant",
        timestamp: "2026-08-01T10:00:00.000Z",
        message: {
          model: "claude-fable-5",
          content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "echo hi" } }],
        },
      }),
      msg({
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "hi" }] },
      }),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.kind).toBe("tool");
    expect(entries[0]!.tool!.name).toBe("Bash");
    expect(entries[0]!.tool!.summary).toBe("echo hi");
    expect(entries[0]!.tool!.result!.text).toBe("hi");
    expect(entries.some((e) => e.kind === "user")).toBe(false);
  });

  test("an error result keeps its flag", () => {
    const entries = buildTranscript([
      msg({ type: "assistant", message: { content: [{ type: "tool_use", id: "t2", name: "Read", input: {} }] } }),
      msg({
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "t2", content: "nope", is_error: true }] },
      }),
    ]);
    expect(entries[0]!.tool!.result!.isError).toBe(true);
  });

  test("an orphan result (its call is on an earlier page) still renders", () => {
    const entries = buildTranscript([
      msg({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "gone", content: "out" }] } }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.kind).toBe("tool");
    expect(entries[0]!.tool!.result!.text).toBe("out");
  });

  test("slash commands are parsed out of their wrapper tags", () => {
    const entries = buildTranscript([
      msg({
        type: "user",
        message: {
          content:
            "<command-name>/clear</command-name>\n<command-message>clear</command-message>\n<command-args></command-args>",
        },
      }),
    ]);
    expect(entries[0]!.kind).toBe("command");
    expect(entries[0]!.command!.name).toBe("/clear");
  });

  test("a caveat-only message is metadata, not something the user said", () => {
    const entries = buildTranscript([
      msg({
        type: "user",
        message: { content: "<local-command-caveat>Caveat: messages below were generated…</local-command-caveat>" },
      }),
    ]);
    expect(entries[0]!.kind).toBe("meta");
  });

  test("tool-injected context is not attributed to the user", () => {
    // skill bodies and similar arrive as user-role records carrying isMeta and
    // the id of the tool call that pulled them in
    const entries = buildTranscript([
      msg({ type: "assistant", message: { content: [{ type: "tool_use", id: "tu9", name: "Skill", input: { skill: "x" } }] } }),
      msg({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu9", content: "Launching skill: x" }] } }),
      msg({
        type: "user",
        isMeta: true,
        sourceToolUseID: "tu9",
        message: { content: [{ type: "text", text: "Base directory for this skill: /tmp/x" }] },
      }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.kind).toBe("tool");
    expect(entries[0]!.tool!.injected).toContain("Base directory");
    expect(entries.some((e) => e.kind === "user")).toBe(false);
  });

  test("injected context without a known call collapses to metadata", () => {
    const entries = buildTranscript([
      msg({ type: "user", isMeta: true, message: { content: [{ type: "text", text: "系统注入" }] } }),
    ]);
    expect(entries[0]!.kind).toBe("meta");
  });

  test("wrapper noise is stripped from a real user message", () => {
    const entries = buildTranscript([
      msg({
        type: "user",
        message: { content: "<system-reminder>ignore me</system-reminder>\n继续执行计划" },
      }),
    ]);
    expect(entries[0]!.kind).toBe("user");
    expect(entries[0]!.text).toBe("继续执行计划");
  });

  test("hook attachments and other bookkeeping records collapse to metadata", () => {
    const entries = buildTranscript([
      msg({ type: "attachment", attachment: { type: "hook_success" } }),
      msg({ type: "bridge-session" }),
      msg({ type: "queue-operation" }),
      msg({ type: "ai-title", title: "索引器修复" }),
    ]);
    expect(entries.every((e) => e.kind === "meta")).toBe(true);
    expect(entries[0]!.metaLabel).toBe("attachment · hook_success");
  });

  test("thinking and text blocks separate, and text keeps the model", () => {
    const entries = buildTranscript([
      msg({
        type: "assistant",
        message: {
          model: "claude-opus-5",
          content: [
            { type: "thinking", thinking: "weigh options" },
            { type: "text", text: "这是回答" },
          ],
        },
      }),
    ]);
    expect(entries.map((e) => e.kind)).toEqual(["thinking", "assistant"]);
    expect(entries[1]!.model).toBe("claude-opus-5");
  });

  test("an oversized body becomes a metadata placeholder rather than an empty bubble", () => {
    const entries = buildTranscript([msg(null, { truncated: true, byteLen: 11_000_000 })]);
    expect(entries[0]!.kind).toBe("meta");
    expect(entries[0]!.truncated).toBe(true);
  });
});

describe("filters and collapsing", () => {
  const entries = buildTranscript([
    msg({ type: "user", message: { content: "hi" } }),
    msg({ type: "assistant", message: { content: [{ type: "thinking", thinking: "hmm" }] } }),
    msg({ type: "assistant", message: { content: [{ type: "tool_use", id: "x", name: "Bash", input: {} }] } }),
    msg({ type: "attachment" }),
    msg({ type: "attachment" }),
    msg({ type: "assistant", message: { content: [{ type: "text", text: "done" }] } }),
  ]);

  test("metadata is hidden by default and thinking is opt-in", () => {
    const shown = filterTranscript(entries, { showThinking: false, showMeta: false, conversationOnly: false });
    expect(shown.some((e) => e.kind === "meta")).toBe(false);
    expect(shown.some((e) => e.kind === "thinking")).toBe(false);
    expect(shown.some((e) => e.kind === "tool")).toBe(true);
  });

  test("conversation-only drops tools and thinking", () => {
    const shown = filterTranscript(entries, { showThinking: true, showMeta: false, conversationOnly: true });
    expect(shown.map((e) => e.kind)).toEqual(["user", "assistant"]);
  });

  test("consecutive metadata rows group into one", () => {
    const shown = filterTranscript(entries, { showThinking: false, showMeta: true, conversationOnly: false });
    const grouped = collapseMeta(shown);
    const groups = grouped.filter((g) => Array.isArray(g)) as unknown[][];
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });
});

describe("attribution", () => {
  const raw = (seq: number, content: unknown, type = "user") => ({
    seq,
    uuid: `u${seq}`,
    byteLen: 10,
    record: { type, message: { role: type, content } },
  });

  test("a background-task notification is not attributed to the user", () => {
    const entries = buildTranscript([
      raw(0, "<task-notification>\n<status>completed</status>\n<result>审查完成</result>\n</task-notification>"),
    ]);
    expect(entries[0]!.kind).not.toBe("user");
    expect(entries[0]!.metaLabel).toBe("task-notification");
  });

  test("the notification body stays readable — it carries the agent's result", () => {
    const entries = buildTranscript([raw(0, "<task-notification>agent finished the review</task-notification>")]);
    expect(entries[0]!.text).toContain("agent finished the review");
  });

  test("a real message with an appended reminder is still the user talking", () => {
    const entries = buildTranscript([raw(0, "接着做第三步\n<system-reminder>be brief</system-reminder>")]);
    expect(entries[0]!.kind).toBe("user");
    expect(entries[0]!.text).toBe("接着做第三步");
  });
});

describe("rewound content", () => {
  const raw = (seq: number, text: string, superseded?: boolean) => ({
    seq,
    uuid: `u${seq}`,
    byteLen: 10,
    superseded,
    record: { type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } },
  });

  test("is hidden by default — it is not how the session went", () => {
    const entries = buildTranscript([raw(0, "第一次尝试", true), raw(1, "重来一次")]);
    const shown = filterTranscript(entries, { showThinking: true, showMeta: true, conversationOnly: false });
    expect(shown.map((e) => e.text)).toEqual(["重来一次"]);
  });

  test("is shown when asked for, and stays marked", () => {
    const entries = buildTranscript([raw(0, "第一次尝试", true), raw(1, "重来一次")]);
    const shown = filterTranscript(entries, {
      showThinking: true,
      showMeta: true,
      conversationOnly: false,
      showSuperseded: true,
    });
    expect(shown).toHaveLength(2);
    expect(shown[0]!.superseded).toBe(true);
  });
});

describe("extractMemCitation", () => {
  // Codex memory instructs the model to append this machine-readable block
  // to its final reply; Codex's own UI strips it, and so must ours.
  const block = [
    "<oai-mem-citation>",
    "<citation_entries>",
    "MEMORY.md:72-74|note=[neutral engineering language]",
    "rollout_summaries/2026-07-31-example.md:19-28|note=[prior isolation approach]",
    "</citation_entries>",
    "<rollout_ids>",
    "019fb750-6e1a-7ce2-8450-1d6361402ac1",
    "</rollout_ids>",
    "</oai-mem-citation>",
  ].join("\n");

  test("strips the block from the prose and parses its parts", () => {
    const { text, citation } = extractMemCitation(`PASS。两项均已关闭。\n\n${block}`);
    expect(text).toBe("PASS。两项均已关闭。");
    expect(citation!.entries).toEqual([
      { ref: "MEMORY.md:72-74", note: "neutral engineering language" },
      { ref: "rollout_summaries/2026-07-31-example.md:19-28", note: "prior isolation approach" },
    ]);
    expect(citation!.rolloutIds).toEqual(["019fb750-6e1a-7ce2-8450-1d6361402ac1"]);
  });

  test("text without a citation block passes through untouched", () => {
    const { text, citation } = extractMemCitation("普通回复");
    expect(text).toBe("普通回复");
    expect(citation).toBeUndefined();
  });

  test("an entry without a note keeps its reference", () => {
    const { citation } = extractMemCitation(
      "答\n<oai-mem-citation>\n<citation_entries>\nMEMORY.md:1-2\n</citation_entries>\n</oai-mem-citation>",
    );
    expect(citation!.entries).toEqual([{ ref: "MEMORY.md:1-2", note: null }]);
  });
});
