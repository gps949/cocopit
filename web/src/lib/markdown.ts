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

export type MdBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: number; text: string }
  | { type: "code"; lang: string; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "quote"; text: string };

const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^```(\S*)\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;

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
      spans.push({ type: "link", text: token.slice(1, split), href: token.slice(split + 2, -1) });
    }
    last = start + token.length;
  }
  if (last < text.length) spans.push({ type: "text", text: text.slice(last) });
  return spans;
}
