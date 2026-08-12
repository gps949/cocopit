import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { localeOf, useI18n } from "../i18n";

interface HistoryEntry {
  timestamp: number;
  project: string | null;
  sessionId: string | null;
  display: string;
}

/**
 * Claude Code's prompt history (history.jsonl), imported into the index and
 * searchable — "what did I ask, and where" across every project and session.
 */
export function History() {
  const { t, lang } = useI18n();
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);

  useEffect(() => {
    const qs = new URLSearchParams({ limit: "200" });
    if (applied) qs.set("q", applied);
    void fetch(`/api/history?${qs}`)
      .then((res) => res.json() as Promise<{ entries: HistoryEntry[] }>)
      .then((data) => setEntries(data.entries))
      .catch(() => setEntries([]));
  }, [applied]);

  const fmtTs = (ts: number) =>
    new Date(ts).toLocaleString(localeOf(lang), {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div className="max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[26px] font-semibold tracking-tight">{t("提示词历史")}</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(query.trim());
          }}
          className="flex w-full gap-2 sm:w-auto"
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("搜索你输入过的提示词")}
            className="w-full rounded-lg border border-line bg-panel px-3 py-1.5 text-sm placeholder:text-muted sm:w-72"
          />
          <button
            type="submit"
            className="rounded-lg bg-accent px-3.5 py-1.5 text-sm text-white hover:bg-accent-strong dark:text-ink"
          >
            {t("搜索")}
          </button>
        </form>
      </div>
      <p className="mt-2 text-sm text-muted">{t("你在 Claude Code 中输入过的每一条提示词,跨项目与会话。")}</p>

      <div className="mt-5 space-y-1.5">
        {entries === null && <p className="text-sm text-muted">{t("加载中…")}</p>}
        {entries?.length === 0 && (
          <p className="rounded-2xl border border-line bg-panel px-4 py-8 text-center text-sm text-muted">
            {t("没有匹配的记录")}
          </p>
        )}
        {entries?.map((entry, i) => {
          const body = (
            <>
              <div className="min-w-0 break-words text-sm leading-relaxed">{entry.display}</div>
              <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
                <span>{fmtTs(entry.timestamp)}</span>
                {entry.project && (
                  <span className="min-w-0 truncate font-mono">{entry.project.split("/").at(-1)}</span>
                )}
                {entry.sessionId && <span className="text-accent">{t("打开会话")} →</span>}
              </div>
            </>
          );
          return entry.sessionId ? (
            <Link
              key={`${entry.timestamp}-${i}`}
              to={`/sessions/${entry.sessionId}`}
              className="block min-w-0 rounded-xl border border-line bg-panel px-4 py-2.5 transition-colors hover:border-accent"
            >
              {body}
            </Link>
          ) : (
            <div key={`${entry.timestamp}-${i}`} className="min-w-0 rounded-xl border border-line bg-panel px-4 py-2.5">
              {body}
            </div>
          );
        })}
      </div>
    </div>
  );
}
