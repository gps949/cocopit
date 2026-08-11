import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listLive, type LiveSessionRow } from "../api/sessions";
import { TerminalPane } from "../components/Terminal";
import { useI18n } from "../i18n";

interface TerminalInfo {
  name: string;
  windows: number;
  createdAt: number;
  attached: boolean;
}

export function Live() {
  const { t } = useI18n();
  const [sessions, setSessions] = useState<LiveSessionRow[] | null>(null);
  const [terminals, setTerminals] = useState<TerminalInfo[]>([]);
  const [available, setAvailable] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const load = () => {
      void listLive().then((res) => setSessions(res.sessions));
      void fetch("/api/terminal")
        .then((r) => r.json())
        .then((r: { available: boolean; terminals: TerminalInfo[] }) => {
          setAvailable(r.available);
          setTerminals(r.terminals);
        });
    };
    load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, []);

  async function closeTerminal(name: string) {
    if (!window.confirm(t("关闭终端 {name}?其中运行的会话会被结束。", { name }))) return;
    await fetch(`/api/terminal/${encodeURIComponent(name)}`, { method: "DELETE" });
    if (open === name) setOpen(null);
  }

  const alive = sessions?.filter((s) => s.alive) ?? [];
  const stale = sessions?.filter((s) => !s.alive) ?? [];

  return (
    <div>
      <h1 className="text-[26px] font-semibold tracking-tight">{t("实时")}</h1>
      <p className="mt-2 text-sm text-muted">
        {t("本机正在运行的 Claude Code 进程,以及 ccockpit 管理的 tmux 终端(每 3 秒刷新)。")}
      </p>

      <section className="mt-5">
        <h2 className="text-[15px] font-medium">{t("运行中的会话({n})", { n: alive.length })}</h2>
        {alive.length === 0 && <p className="mt-2 text-sm text-muted">{t("当前没有运行中的会话。")}</p>}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {alive.map((s) => (
            <div key={s.pid} className="rounded-2xl border border-line bg-panel p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-medium">{s.name || s.sessionId.slice(0, 8)}</div>
                  <div className="truncate font-mono text-xs text-muted">{s.cwd}</div>
                </div>
                <span className="flex items-center gap-1.5 text-xs text-ok">
                  <span className="size-1.5 rounded-full bg-ok" />
                  {s.status ?? t("运行中")}
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-muted">
                <span className="font-mono">pid {s.pid}</span>
                <Link to={`/sessions/${s.sessionId}`} className="text-accent hover:underline">
                  {t("查看会话")}
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-[15px] font-medium">{t("ccockpit 终端({n})", { n: terminals.length })}</h2>
        {!available && <p className="mt-2 text-sm text-danger">{t("未检测到 tmux,Web 终端不可用。")}</p>}
        {available && terminals.length === 0 && (
          <p className="mt-2 text-sm text-muted">{t("还没有终端。可在会话详情页「在终端中恢复」,或在项目页新建会话。")}</p>
        )}
        <div className="mt-3 space-y-2">
          {terminals.map((term) => (
            <div key={term.name} className="flex items-center gap-3 rounded-xl border border-line bg-panel px-4 py-2.5">
              <span className="font-mono text-sm">{term.name}</span>
              <span className="text-xs text-muted">
                {new Date(term.createdAt).toLocaleString("zh-CN")} · {term.attached ? "已连接" : t("空闲")}
              </span>
              <div className="ml-auto flex gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(open === term.name ? null : term.name)}
                  className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:bg-hover hover:text-ink"
                >
                  {open === term.name ? "收起" : t("打开")}
                </button>
                <button
                  type="button"
                  onClick={() => void closeTerminal(term.name)}
                  className="rounded-lg border border-line px-2.5 py-1 text-xs text-danger hover:bg-hover"
                >
                  {t("关闭")}
                </button>
              </div>
            </div>
          ))}
        </div>
        {open && (
          <div className="mt-3">
            <TerminalPane name={open} />
          </div>
        )}
      </section>

      {stale.length > 0 && (
        <section className="mt-8">
          <h2 className="text-[15px] font-medium text-muted">{t("已结束的注册项({n})", { n: stale.length })}</h2>
          <p className="mt-1 text-xs text-muted">
            {t("进程已退出但注册文件仍在(崩溃或 PID 已被复用),仅供排查。")}
          </p>
        </section>
      )}
    </div>
  );
}
