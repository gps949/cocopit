/**
 * A deliberately small markdown reader for transcript text.
 *
 * Assistant messages are written in markdown, so showing them raw turns
 * headings into "##" and emphasis into asterisks. A full markdown library would
 * also bring an HTML pass, and transcript text is arbitrary — it contains
 * angle brackets, half-written tags and code that looks like markup. Producing
 * a block tree instead of an HTML string means React renders text as text and
 * there is no sanitizer to get wrong.
 */

export type InlineSpan =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "bold"; text: string }
  | { type: "italic"; text: string }
  | { type: "link"; text: string; href: string };

export type CellAlign = "left" | "center" | "right";

export type MdBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: number; text: string }
  | { type: "code"; lang: string; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "quote"; text: string }
  | { type: "rule" }
  | { type: "table"; header: string[]; align: CellAlign[]; rows: string[][] };

const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^```(\S*)\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
// the row under the header, e.g. | --- | :---: | ---: |
const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/;

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function alignOf(spec: string): CellAlign {
  const s = spec.trim();
  if (s.startsWith(":") && s.endsWith(":")) return "center";
  if (s.endsWith(":")) return "right";
  return "left";
}

export function parseMarkdown(source: string): MdBlock[] {
  const lines = source.split("\n");
  const blocks: MdBlock[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: "paragraph", text: paragraph.join("\n") });
      paragraph = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    const fence = FENCE.exec(line);
    if (fence) {
      flushParagraph();
      const body: string[] = [];
      i++;
      // an unterminated fence runs to the end — transcripts get truncated
      while (i < lines.length && !/^```/.test(lines[i]!)) body.push(lines[i++]!);
      blocks.push({ type: "code", lang: fence[1] ?? "", text: body.join("\n") });
      continue;
    }

    // a table announces itself by its divider row, so look one line ahead
    if (i + 1 < lines.length && line.includes("|") && TABLE_DIVIDER.test(lines[i + 1]!)) {
      flushParagraph();
      const header = splitRow(line);
      const align = splitRow(lines[i + 1]!).map(alignOf);
      i += 1;
      const rows: string[][] = [];
      while (i + 1 < lines.length && lines[i + 1]!.includes("|") && lines[i + 1]!.trim() !== "") {
        rows.push(splitRow(lines[++i]!));
      }
      blocks.push({ type: "table", header, align, rows });
      continue;
    }

    if (RULE.test(line)) {
      flushParagraph();
      blocks.push({ type: "rule" });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({ type: "heading", level: heading[1]!.length, text: heading[2]!.trim() });
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      const items: string[] = [(bullet ?? numbered)![1]!];
      while (i + 1 < lines.length) {
        const next = ordered ? NUMBERED.exec(lines[i + 1]!) : BULLET.exec(lines[i + 1]!);
        if (!next) break;
        items.push(next[1]!);
        i++;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote) {
      flushParagraph();
      const parts: string[] = [quote[1]!];
      while (i + 1 < lines.length) {
        const next = QUOTE.exec(lines[i + 1]!);
        if (!next) break;
        parts.push(next[1]!);
        i++;
      }
      blocks.push({ type: "quote", text: parts.join("\n") });
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return blocks;
}

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(\[[^\]]+\]\([^)\s]+\))/g;

/** Splits one line of text into inline spans. Unmatched text stays text. */
export function parseInline(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const start = match.index;
    if (start > last) spans.push({ type: "text", text: text.slice(last, start) });
    const token = match[0];
    if (token.startsWith("`")) {
      spans.push({ type: "code", text: token.slice(1, -1) });
    } else if (token.startsWith("**")) {
      spans.push({ type: "bold", text: token.slice(2, -2) });
    } else if (token.startsWith("*")) {
      spans.push({ type: "italic", text: token.slice(1, -1) });
    } else {
      const split = token.indexOf("](");
      const label = token.slice(1, split);
      const href = token.slice(split + 2, -1);
      // only schemes a browser can actually follow become anchors; opaque app
      // URIs (chatgpt-conversation://…) and javascript: stay visible as text —
      // a dead or dangerous hyperlink is worse than no hyperlink
      if (/^(https?:\/\/|mailto:|#|\/)/i.test(href)) {
        spans.push({ type: "link", text: label, href });
      } else {
        spans.push({ type: "text", text: `${label} (` }, { type: "code", text: href }, { type: "text", text: ")" });
      }
    }
    last = start + token.length;
  }
  if (last < text.length) spans.push({ type: "text", text: text.slice(last) });
  return spans;
}
