import { describe, expect, test } from "bun:test";
import { parseMarkdown } from "../src/lib/markdown";

/**
 * Transcript text is arbitrary content from real sessions — it contains angle
 * brackets, backticks and half-written markup. Rendering must never let that
 * text become live markup.
 */
describe("parseMarkdown", () => {
  test("headings become heading blocks, not literal ##", () => {
    const blocks = parseMarkdown("## 审查报告\n正文");
    expect(blocks[0]).toEqual({ type: "heading", level: 2, text: "审查报告" });
    expect(blocks[1]).toEqual({ type: "paragraph", text: "正文" });
  });

  test("fenced code keeps its content verbatim, including markdown-looking lines", () => {
    const blocks = parseMarkdown("```ts\nconst a = **1**\n```");
    expect(blocks[0]).toEqual({ type: "code", lang: "ts", text: "const a = **1**" });
  });

  test("an unterminated fence still yields the code it opened", () => {
    const blocks = parseMarkdown("```\nhalf written");
    expect(blocks[0]).toEqual({ type: "code", lang: "", text: "half written" });
  });

  test("list items group into one list block", () => {
    const blocks = parseMarkdown("- 一\n- 二\n\n段落");
    expect(blocks[0]).toEqual({ type: "list", ordered: false, items: ["一", "二"] });
    expect(blocks[1]!.type).toBe("paragraph");
  });

  test("numbered lists are recognized as ordered", () => {
    const blocks = parseMarkdown("1. 第一\n2. 第二");
    expect(blocks[0]).toEqual({ type: "list", ordered: true, items: ["第一", "第二"] });
  });

  test("consecutive prose lines stay in one paragraph", () => {
    const blocks = parseMarkdown("第一行\n第二行\n\n新段");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ type: "paragraph", text: "第一行\n第二行" });
  });
});

describe("inline parsing", () => {
  test("bold, italic and code become spans", () => {
    const blocks = parseMarkdown("**粗** 与 `代码`");
    expect(blocks[0]!.type).toBe("paragraph");
  });

  test("XML-looking text is preserved as text, never as markup", () => {
    // the transcript is full of <task-notification>-style content
    const blocks = parseMarkdown("看 <script>alert(1)</script> 这段");
    expect(blocks[0]).toEqual({ type: "paragraph", text: "看 <script>alert(1)</script> 这段" });
  });
});
