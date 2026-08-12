import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { listSessions, type SessionSummary } from "../api/sessions";
import { fmtUsd } from "../lib/format";
import { localeOf, useI18n, type Lang, type Translate } from "../i18n";

// module scope has no hook access — the caller passes its translator in
function fmtWhen(ts: number | null, t: Translate, lang: Lang): string {
  if (!ts) return "—";
  const date = new Date(ts);
  const locale = localeOf(lang);
  const days = (Date.now() - ts) / 86_400_000;
  if (days < 1) return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  if (days < 7) return t("{n} 天前", { n: Math.floor(days) });
  return date.toLocaleDateString(locale, { month: "2-digit", day: "2-digit" });
}

export function Sessions() {
  const { t, lang } = useI18n();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [note, setNote] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<Array<{ id: string; name: string }>>([]);

  const search = params.get("q") ?? "";
  const project = params.get("project");
  const profileId = params.get("profileId") ?? "";

  useEffect(() => {
    void fetch("/api/profiles")
      .then((res) => res.json() as Promise<{ profiles: Array<{ id: string; name: string }> }>)
      .then((data) => setProfiles(data.profiles))
      .catch(() => setProfiles([]));
  }, []);

  useEffect(() => {
    setLoading(true);
    const qs = new URLSearchParams({ limit: "40" });
    if (search) qs.set("q", search);
    if (project) qs.set("project", project);
    if (profileId) qs.set("profileId", profileId);
    void listSessions(`?${qs}`).then((res) => {
      setSessions(res.sessions);
      setCursor(res.nextCursor);
      setNote(res.note);
      setLoading(false);
    });
  }, [search, project, profileId]);

  async function loadMore() {
    if (!cursor) return;
    const qs = new URLSearchParams({ limit: "40", cursor });
    if (search) qs.set("q", search);
    if (project) qs.set("project", project);
    if (profileId) qs.set("profileId", profileId);
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
        {profiles.length > 1 && (
          <select
            value={profileId}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              if (e.target.value) next.set("profileId", e.target.value);
              else next.delete("profileId");
              setParams(next);
            }}
            className="rounded-lg border border-line bg-panel px-3 py-1.5 text-sm"
          >
            <option value="">{t("全部账号")}</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {t(p.name)}
              </option>
            ))}
          </select>
        )}
        <form onSubmit={submitSearch} className="flex w-full gap-2 sm:w-auto">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("全文检索(中英文,至少 3 字符)")}
            className="w-full rounded-lg border border-line bg-panel px-3 py-1.5 text-sm placeholder:text-muted sm:w-72"
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
          {t("已按项目筛选")} ·{" "}
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

      {/* A table needs its columns; a 390px screen cannot give them, and the
          previous compromise hid the project and still scrolled sideways. Below
          sm each session is a card instead, which fits and shows everything. */}
      <div className="mt-5 space-y-2 sm:hidden">
        {sessions.length === 0 && !loading && (
          <p className="rounded-2xl border border-line bg-panel px-4 py-8 text-center text-sm text-muted">
            {t("没有匹配的会话")}
          </p>
        )}
        {sessions.map((s) => (
          <Link
            key={s.id}
            to={`/sessions/${s.id}`}
            className="block min-w-0 rounded-2xl border border-line bg-panel px-4 py-3 transition-colors hover:border-accent"
          >
            <div className="truncate text-sm">{s.title || s.id}</div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs text-muted">
              <span className="min-w-0 truncate font-mono">{s.cwd?.split("/").at(-1) ?? s.dirName}</span>
              <span className="tabular-nums">{s.costUsd ? fmtUsd(s.costUsd) : "—"}</span>
              <span className="tabular-nums">{s.userMsgCount + s.assistantMsgCount} {t("消息")}</span>
              <span className="ml-auto shrink-0">{fmtWhen(s.lastTs, t, lang)}</span>
            </div>
          </Link>
        ))}
      </div>

      <div className="mt-5 hidden overflow-x-auto rounded-2xl border border-line bg-panel sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="px-4 py-2.5 font-normal">{t("标题")}</th>
              <th className="hidden px-4 py-2.5 font-normal sm:table-cell">{t("项目")}</th>
              <th className="hidden px-4 py-2.5 text-right font-normal sm:table-cell">{t("消息")}</th>
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
                    {s.subagentCount > 0 && <span>{t("{n} 子代理", { n: s.subagentCount })}</span>}
                    {s.gitBranch && <span className="font-mono">{s.gitBranch}</span>}
                  </div>
                </td>
                <td className="hidden px-4 py-2.5 text-muted sm:table-cell">{s.cwd?.split("/").at(-1) ?? s.dirName}</td>
                <td className="hidden px-4 py-2.5 text-right tabular-nums text-muted sm:table-cell">
                  {s.userMsgCount + s.assistantMsgCount}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {s.costUsd ? fmtUsd(s.costUsd) : "—"}
                </td>
                <td className="px-4 py-2.5 text-right text-muted">{fmtWhen(s.lastTs, t, lang)}</td>
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
