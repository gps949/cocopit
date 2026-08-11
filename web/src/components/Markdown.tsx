import { memo, useState } from "react";
import { useI18n } from "../i18n";
import { parseInline, parseMarkdown, type InlineSpan } from "../lib/markdown";

/** Code is the thing people want out of a transcript, so make it one click. */
function CodeBlock({ lang, text }: { lang: string; text: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // clipboard API needs a secure context; fall back to a selection copy
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="group relative">
      <pre className="overflow-x-auto rounded-lg border border-line bg-bg px-3 py-2 font-mono text-xs leading-relaxed">
        <code>{text}</code>
      </pre>
      {lang && (
        <span className="pointer-events-none absolute top-1.5 right-16 font-mono text-[10px] text-muted opacity-50">
          {lang}
        </span>
      )}
      <button
        type="button"
        onClick={() => void copy()}
        // faint rather than hidden: a touch device never hovers
        className="absolute top-1.5 right-1.5 rounded-md border border-line bg-panel px-2 py-0.5 text-[11px] text-muted opacity-60 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-ink"
      >
        {copied ? t("已复制") : t("复制")}
      </button>
    </div>
  );
}

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
            return <CodeBlock key={i} lang={block.lang} text={block.text} />;
          case "rule":
            return <hr key={i} className="my-4 border-0 border-t border-line" />;
          case "table":
            return (
              // its own scroller: a wide table must not push the page sideways
              <div key={i} className="-mx-1 overflow-x-auto px-1">
                <table className="w-full min-w-max border-collapse text-[13px]">
                  <thead>
                    <tr className="border-b border-line">
                      {block.header.map((cell, j) => (
                        <th
                          key={j}
                          className="px-3 py-1.5 font-medium text-muted"
                          style={{ textAlign: block.align[j] ?? "left" }}
                        >
                          <Inline spans={parseInline(cell)} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={r} className="border-b border-line/50 last:border-0">
                        {row.map((cell, c) => (
                          <td key={c} className="px-3 py-1.5" style={{ textAlign: block.align[c] ?? "left" }}>
                            <Inline spans={parseInline(cell)} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
