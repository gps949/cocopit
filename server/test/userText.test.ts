import { describe, expect, test } from "bun:test";
import { humanUserText, stripSystemWrappers } from "../../shared/userText";

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
