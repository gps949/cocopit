import { describe, expect, test } from "bun:test";
import { parseInline, parseMarkdown } from "../src/lib/markdown";

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

  test("http links become anchors", () => {
    const spans = parseInline("[docs](https://example.com)");
    expect(spans).toEqual([{ type: "link", text: "docs", href: "https://example.com" }]);
  });

  test("app-scheme URIs stay visible but never become anchors", () => {
    // Codex Desktop injects [对话](chatgpt-conversation://uuid) references —
    // a browser can't follow that scheme, so a hyperlink would be a dead click
    const spans = parseInline("[对话](chatgpt-conversation://6a7a8c90)");
    expect(spans.find((s) => s.type === "link")).toBeUndefined();
    expect(spans).toContainEqual({ type: "code", text: "chatgpt-conversation://6a7a8c90" });
  });

  test("javascript: href is refused", () => {
    const spans = parseInline("[x](javascript:alert(1))");
    expect(spans.find((s) => s.type === "link")).toBeUndefined();
  });
});

describe("tables and rules", () => {
  test("a pipe table becomes a table block with its header", () => {
    const blocks = parseMarkdown("| 模型 | 费用 |\n| --- | ---: |\n| opus | $5 |\n| sonnet | $3 |");
    expect(blocks[0]).toEqual({
      type: "table",
      header: ["模型", "费用"],
      align: ["left", "right"],
      rows: [
        ["opus", "$5"],
        ["sonnet", "$3"],
      ],
    });
  });

  test("a table with ragged rows still renders every cell it has", () => {
    const blocks = parseMarkdown("| a | b |\n| --- | --- |\n| 1 |");
    expect((blocks[0] as { rows: string[][] }).rows).toEqual([["1"]]);
  });

  test("pipes inside a row are not lost to the leading/trailing delimiters", () => {
    const blocks = parseMarkdown("a | b\n--- | ---\n1 | 2");
    expect(blocks[0]).toMatchObject({ header: ["a", "b"], rows: [["1", "2"]] });
  });

  test("a line of dashes is a rule, not a heading underline", () => {
    expect(parseMarkdown("上文\n\n---\n\n下文")[1]).toEqual({ type: "rule" });
    expect(parseMarkdown("***")[0]).toEqual({ type: "rule" });
    expect(parseMarkdown("___")[0]).toEqual({ type: "rule" });
  });

  test("a fenced block containing pipes is still code", () => {
    const blocks = parseMarkdown("```\n| a | b |\n| --- | --- |\n```");
    expect(blocks[0]!.type).toBe("code");
  });
});
