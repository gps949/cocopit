import { describe, expect, test } from "bun:test";
import { codexUserSpeech, humanUserText, stripSystemWrappers } from "../../shared/userText";

/**
 * A JSONL record with role "user" is not the same thing as "the user said
 * this". Hooks, background-task notifications, slash-command plumbing and
 * tool results all arrive wearing the user role. Attributing them to the human
 * is what made the transcript and the outline unreadable.
 */
describe("stripSystemWrappers", () => {
  test("removes harness-injected blocks", () => {
    expect(stripSystemWrappers("<system-reminder>be careful</system-reminder>")).toBe("");
    expect(stripSystemWrappers("<task-notification>agent finished</task-notification>")).toBe("");
    expect(stripSystemWrappers("<local-command-stdout>ok</local-command-stdout>")).toBe("");
  });

  test("keeps what the human typed alongside an injected block", () => {
    expect(stripSystemWrappers("继续做第二步\n<system-reminder>note</system-reminder>")).toBe("继续做第二步");
  });

  test("a tag with attributes is still a wrapper", () => {
    expect(stripSystemWrappers('<system-reminder priority="high">x</system-reminder>')).toBe("");
  });

  test("prose that merely mentions a tag name is left alone", () => {
    const text = "把 <task-notification> 这个标签渲染出来";
    expect(stripSystemWrappers(text)).toBe(text);
  });
});

describe("humanUserText", () => {
  test("plain string content is the user speaking", () => {
    expect(humanUserText("修一下这个 bug")).toBe("修一下这个 bug");
  });

  test("a pure notification is not the user speaking", () => {
    expect(humanUserText("<task-notification>\n<status>completed</status>\n</task-notification>")).toBeNull();
  });

  test("a tool result carried in a user record is not the user speaking", () => {
    expect(humanUserText([{ type: "tool_result", tool_use_id: "t1", content: "output" }])).toBeNull();
  });

  test("text blocks are joined; non-text blocks ignored", () => {
    expect(humanUserText([{ type: "text", text: "第一段" }, { type: "image" }, { type: "text", text: "第二段" }])).toBe(
      "第一段\n第二段",
    );
  });

  test("empty and whitespace-only content is not speech", () => {
    expect(humanUserText("")).toBeNull();
    expect(humanUserText("   \n ")).toBeNull();
    expect(humanUserText(null)).toBeNull();
  });

  test("a slash-command invocation is not free-form speech", () => {
    expect(humanUserText("<command-name>/clear</command-name><command-args></command-args>")).toBeNull();
  });
});

describe("codexUserSpeech", () => {
  test("plain text is the user speaking", () => {
    expect(codexUserSpeech("帮我修复这个测试")).toBe("帮我修复这个测试");
  });

  test("a Desktop referenced-ChatGPT-conversation block is injected context", () => {
    // this arrives with a leading blank line and no XML tag — it once slipped
    // through, became the session title, and even named the project directory
    const block = "\n## Referenced ChatGPT conversation:\nThis is an untrusted ChatGPT conversation reference.";
    expect(codexUserSpeech(block)).toBeNull();
  });

  test("known injected tags are filtered even with leading whitespace", () => {
    expect(codexUserSpeech("  <environment_context>\n...\n</environment_context>")).toBeNull();
  });

  test("prose starting with ## but not the injection marker survives", () => {
    expect(codexUserSpeech("## 目标\n重构解析器")).toBe("## 目标\n重构解析器");
  });

  test("plugin @-mentions flatten to what the person typed", () => {
    expect(
      codexUserSpeech("[@agent-sdk-dev](plugin://agent-sdk-dev@claude-plugins-official/) 检查一下这个项目"),
    ).toBe("@agent-sdk-dev 检查一下这个项目");
  });
});
