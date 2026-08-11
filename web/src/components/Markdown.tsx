import { memo } from "react";
import { parseInline, parseMarkdown, type InlineSpan } from "../lib/markdown";

function Inline({ spans }: { spans: InlineSpan[] }) {
  return (
    <>
      {spans.map((span, i) => {
        switch (span.type) {
          case "code":
            return (
              <code key={i} className="rounded bg-hover px-1 py-0.5 font-mono text-[0.9em] text-ink">
                {span.text}
              </code>
            );
          case "bold":
            return (
              <strong key={i} className="font-medium text-ink">
                {span.text}
              </strong>
            );
          case "italic":
            return (
              <em key={i} className="italic">
                {span.text}
              </em>
            );
          case "link":
            return (
              <a
                key={i}
                href={span.href}
                target="_blank"
                rel="noreferrer noopener"
                className="text-accent underline underline-offset-2 hover:text-accent-strong"
              >
                {span.text}
              </a>
            );
          default:
            return <span key={i}>{span.text}</span>;
        }
      })}
    </>
  );
}

/** Multi-line text where each line gets inline formatting. */
function Lines({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, i) => (
        <span key={i}>
          <Inline spans={parseInline(line)} />
          {i < lines.length - 1 && <br />}
        </span>
      ))}
    </>
  );
}

const HEADING_SIZE: Record<number, string> = {
  1: "text-[17px] font-medium",
  2: "text-[15px] font-medium",
  3: "text-[14px] font-medium",
};

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const blocks = parseMarkdown(text);
  return (
    <div className="min-w-0 space-y-2.5 text-[13.5px] leading-relaxed">
      {blocks.map((block, i) => {
        switch (block.type) {
          case "heading":
            return (
              <div key={i} className={`${HEADING_SIZE[block.level] ?? "text-[13.5px] font-medium"} mt-3 text-ink`}>
                <Inline spans={parseInline(block.text)} />
              </div>
            );
          case "code":
            return (
              <pre
                key={i}
                className="overflow-x-auto rounded-lg border border-line bg-bg px-3 py-2 font-mono text-xs leading-relaxed"
              >
                <code>{block.text}</code>
              </pre>
            );
          case "list":
            return (
              <ul key={i} className="ml-1 space-y-1">
                {block.items.map((item, j) => (
                  <li key={j} className="flex min-w-0 gap-2">
                    <span className="shrink-0 text-muted">{block.ordered ? `${j + 1}.` : "·"}</span>
                    <span className="min-w-0 break-words">
                      <Inline spans={parseInline(item)} />
                    </span>
                  </li>
                ))}
              </ul>
            );
          case "quote":
            return (
              <blockquote key={i} className="border-l-2 border-line pl-3 text-muted">
                <Lines text={block.text} />
              </blockquote>
            );
          default:
            return (
              <p key={i} className="break-words">
                <Lines text={block.text} />
              </p>
            );
        }
      })}
    </div>
  );
});
