import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { listSessions, type SessionSummary } from "../api/sessions";
import { fmtUsd } from "../components/EChart";
import { useI18n } from "../i18n";

function fmtWhen(ts: number | null): string {
  if (!ts) return "—";
  const date = new Date(ts);
  const days = (Date.now() - ts) / 86_400_000;
  if (days < 1) return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  if (days < 7) return `${Math.floor(days)} 天前`;
  return date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

export function Sessions() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [note, setNote] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  const search = params.get("q") ?? "";
  const project = params.get("project");

  useEffect(() => {
    setLoading(true);
    const qs = new URLSearchParams({ limit: "40" });
    if (search) qs.set("q", search);
    if (project) qs.set("project", project);
    void listSessions(`?${qs}`).then((res) => {
      setSessions(res.sessions);
      setCursor(res.nextCursor);
      setNote(res.note);
      setLoading(false);
    });
  }, [search, project]);

  async function loadMore() {
    if (!cursor) return;
    const qs = new URLSearchParams({ limit: "40", cursor });
    if (search) qs.set("q", search);
    if (project) qs.set("project", project);
    const res = await listSessions(`?${qs}`);
    setSessions((prev) => [...prev, ...res.sessions]);
    setCursor(res.nextCursor);
  }

  function submitSearch(event: React.FormEvent) {
    event.preventDefault();
    const next = new URLSearchParams(params);
    if (query.trim()) next.set("q", query.trim());
    else next.delete("q");
    setParams(next);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[26px] font-semibold tracking-tight">{t("会话")}</h1>
        <form onSubmit={submitSearch} className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("全文检索(中英文,至少 3 字符)")}
            className="w-72 rounded-lg border border-line bg-panel px-3 py-1.5 text-sm placeholder:text-muted"
          />
          <button
            type="submit"
            className="rounded-lg bg-accent px-3.5 py-1.5 text-sm text-white hover:bg-accent-strong dark:text-ink"
          >
            {t("搜索")}
          </button>
          {search && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                const next = new URLSearchParams(params);
                next.delete("q");
                setParams(next);
              }}
              className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:bg-hover"
            >
              {t("清除")}
            </button>
          )}
        </form>
      </div>

      {note && <p className="mt-3 text-sm text-danger">{note}</p>}
      {project && (
        <p className="mt-3 text-sm text-muted">
          已按项目筛选 ·{" "}
          <button
            type="button"
            className="text-accent hover:underline"
            onClick={() => {
              const next = new URLSearchParams(params);
              next.delete("project");
              setParams(next);
            }}
          >
            {t("取消")}
          </button>
        </p>
      )}

      <div className="mt-5 overflow-hidden rounded-2xl border border-line bg-panel">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="px-4 py-2.5 font-normal">{t("标题")}</th>
              <th className="px-4 py-2.5 font-normal">{t("项目")}</th>
              <th className="px-4 py-2.5 text-right font-normal">{t("消息")}</th>
              <th className="px-4 py-2.5 text-right font-normal">{t("费用")}</th>
              <th className="px-4 py-2.5 text-right font-normal">{t("最近")}</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted">
                  {t("加载中…")}
                </td>
              </tr>
            )}
            {!loading && sessions.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted">
                  {t("没有匹配的会话")}
                </td>
              </tr>
            )}
            {sessions.map((s) => (
              <tr key={s.id} className="border-b border-line/60 last:border-0 hover:bg-hover/40">
                <td className="max-w-md px-4 py-2.5">
                  <Link to={`/sessions/${s.id}`} className="block truncate hover:text-accent">
                    {s.title || s.id}
                  </Link>
                  <div className="mt-0.5 flex gap-2 text-xs text-muted">
                    {s.models.slice(0, 2).map((m) => (
                      <span key={m}>{m.replace(/^claude-/, "")}</span>
                    ))}
                    {s.subagentCount > 0 && <span>{s.subagentCount} 子代理</span>}
                    {s.gitBranch && <span className="font-mono">{s.gitBranch}</span>}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-muted">{s.cwd?.split("/").at(-1) ?? s.dirName}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-muted">
                  {s.userMsgCount + s.assistantMsgCount}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {s.costUsd ? fmtUsd(s.costUsd) : "—"}
                </td>
                <td className="px-4 py-2.5 text-right text-muted">{fmtWhen(s.lastTs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {cursor && (
        <button
          type="button"
          onClick={() => void loadMore()}
          className="mt-4 w-full rounded-lg border border-line py-2 text-sm text-muted hover:bg-hover"
        >
          {t("加载更多")}
        </button>
      )}
    </div>
  );
}
