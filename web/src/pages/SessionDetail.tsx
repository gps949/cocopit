import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useParams } from "react-router-dom";
import {
  getLatestMessages,
  getMessage,
  getMessages,
  getMessagesBefore,
  getOutline,
  getSubagentTranscript,
  getSession,
  openTerminal,
  type MessageRow,
  type OutlineTurn,
  type SubagentTranscript,
  type SessionSummary,
  type RelatedSession,
  type SubagentInfo,
} from "../api/sessions";
import { fmtTokens, fmtUsd } from "../components/EChart";
import { Markdown } from "../components/Markdown";
import { TerminalPane } from "../components/Terminal";
import { localeOf, useI18n } from "../i18n";
import {
  buildTranscript,
  collapseMeta,
  filterTranscript,
  type TranscriptEntry,
} from "../lib/transcript";

/**
 * A subagent's own transcript, read on demand. Nearly a fifth of all spend in a
 * typical history happens inside these, and until now they were a cost figure
 * with no way to see what was actually done.
 */
function SubagentViewer({
  sessionId,
  subagent,
  onClose,
}: {
  sessionId: string;
  subagent: SubagentInfo;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [data, setData] = useState<SubagentTranscript | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    getSubagentTranscript(sessionId, subagent.agentId)
      .then((res) => !cancelled && setData(res))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [sessionId, subagent.agentId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const entries = useMemo(
    () => (data ? filterTranscript(buildTranscript(data.records), {
      showThinking: false,
      showMeta: false,
      conversationOnly: false,
    }) : []),
    [data],
  );

  // through a portal: the page wrapper's entrance animation leaves a transform
  // behind, which would make this the containing block for position:fixed and
  // anchor the overlay to the page instead of the viewport
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-t-2xl border border-line bg-panel sm:max-h-[85vh] sm:rounded-2xl"
      >
        <div className="flex min-w-0 items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="text-[15px] font-medium">{subagent.agentType ?? t("子代理")}</h3>
              {subagent.costUsd != null && <span className="text-xs text-muted">{fmtUsd(subagent.costUsd)}</span>}
              {data && <span className="text-xs text-muted">{t("{n} 条记录", { n: data.total })}</span>}
            </div>
            {subagent.description && (
              <p className="mt-1 text-sm break-words text-muted">{subagent.description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:bg-hover"
          >
            {t("关闭")}
          </button>
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto px-5 py-4">
          {error && <p className="text-sm text-danger">{error}</p>}
          {!data && !error && <p className="text-sm text-muted">{t("加载中…")}</p>}
          {data && entries.length === 0 && <p className="text-sm text-muted">{t("这个子代理没有留下可读内容。")}</p>}
          {entries.map((entry) => (
            <Entry key={entry.key} entry={entry} sessionId={sessionId} />
          ))}
          {data?.truncatedFile && (
            <p className="mt-3 text-xs text-muted">{t("记录过长,仅显示前一部分。")}</p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SubagentPanel({ subagents, sessionId }: { subagents: SubagentInfo[]; sessionId: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<SubagentInfo | null>(null);
  const sorted = useMemo(
    () => [...subagents].sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0)),
    [subagents],
  );
  const shown = open ? sorted : sorted.slice(0, 6);
  const total = sorted.reduce((sum, sub) => sum + (sub.costUsd ?? 0), 0);

  return (
    <div className="mt-4 rounded-2xl border border-line bg-panel p-5">
      <div className="flex items-baseline gap-3">
        <h2 className="text-[15px] font-medium">{t("子代理")}</h2>
        <span className="text-xs text-muted">
          {subagents.length} · {fmtUsd(total)}
        </span>
        {sorted.length > 6 && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="ml-auto text-xs text-accent hover:underline"
          >
            {open ? t("收起") : t("展开全部")}
          </button>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        {shown.map((sub) => (
          <button
            key={sub.agentId}
            type="button"
            onClick={() => setViewing(sub)}
            title={sub.description ?? undefined}
            className="max-w-full rounded-lg border border-line px-2.5 py-1.5 text-left transition-colors hover:border-accent hover:bg-hover"
          >
            <div className="truncate text-xs text-muted">{sub.agentType ?? "agent"}</div>
            <div className="mt-0.5 truncate font-mono text-[11px]">{sub.agentId.slice(0, 10)}</div>
            {sub.costUsd != null && <div className="text-[11px]">{fmtUsd(sub.costUsd)}</div>}
          </button>
        ))}
      </div>
      {viewing && (
        <SubagentViewer sessionId={sessionId} subagent={viewing} onClose={() => setViewing(null)} />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-panel p-3 sm:p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Toggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
        active ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:bg-hover"
      }`}
    >
      {children}
    </button>
  );
}

/** Session prose is markdown — headings, emphasis and lists, not just fences. */
function Prose({ text }: { text: string }) {
  return <Markdown text={text} />;
}

function ToolEntry({ entry }: { entry: TranscriptEntry }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const tool = entry.tool!;
  const result = tool.result;
  const resultLines = result ? result.text.split("\n") : [];
  const preview = resultLines[0]?.slice(0, 160) ?? "";

  return (
    <div className="my-1.5 rounded-lg border border-line/70 bg-bg/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full min-w-0 items-baseline gap-2 overflow-hidden px-3 py-1.5 text-left"
      >
        <span
          className={`max-w-[45%] shrink-0 truncate text-xs sm:max-w-none ${
            result?.isError ? "text-danger" : "text-accent"
          }`}
          title={tool.name}
        >
          {tool.name || t("结果")}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted">{tool.summary || preview}</span>
        {tool.injected && <span className="shrink-0 text-xs text-muted">{t("注入上下文")}</span>}
        {result && (
          <span className="shrink-0 text-xs text-muted">
            {result.isError ? t("出错") : t("{n} 行", { n: resultLines.length })}
          </span>
        )}
        <span className="shrink-0 text-xs text-muted">{open ? "−" : "+"}</span>
      </button>

      {open && (
        <div className="border-t border-line/70 px-3 py-2">
          {Object.keys(tool.input).length > 0 && (
            <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted">
              {JSON.stringify(tool.input, null, 2)}
            </pre>
          )}
          {result && (
            <pre
              className={`mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed ${
                result.isError ? "text-danger" : ""
              }`}
            >
              {result.text.slice(0, 20000)}
              {result.text.length > 20000 ? "\n…" : ""}
            </pre>
          )}
          {tool.injected && (
            <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words border-t border-line/70 pt-2 font-mono text-[11px] leading-relaxed text-muted">
              {tool.injected.slice(0, 20000)}
              {tool.injected.length > 20000 ? "\n…" : ""}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function MetaGroup({ entries }: { entries: TranscriptEntry[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className="my-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-muted hover:text-ink"
      >
        {t("{n} 条元数据记录", { n: entries.length })} {open ? "−" : "+"}
      </button>
      {open && (
        <div className="mt-1 space-y-1.5 border-l border-line pl-3">
          {entries.map((entry) => (
            <div key={entry.key} className="min-w-0">
              <div className="truncate font-mono text-[11px] text-muted">
                #{entry.seq} {entry.metaLabel}
              </div>
              {/* notifications carry the agent's actual result — worth reading */}
              {entry.text && (
                <div className="mt-1 max-h-64 overflow-auto rounded-lg border border-line/70 bg-bg px-3 py-2 text-muted">
                  <Markdown text={entry.text} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Entry({ entry, sessionId }: { entry: TranscriptEntry; sessionId: string }) {
  const { t, lang } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState<MessageRow | null>(null);

  if (entry.kind === "tool") return <ToolEntry entry={entry} />;

  if (entry.kind === "command") {
    return (
      <div className="my-1.5 flex min-w-0 items-baseline gap-2 overflow-hidden text-xs">
        <span className="shrink-0 truncate rounded bg-hover px-1.5 py-0.5 font-mono text-muted">
          {entry.command!.name
            ? t("斜杠命令 {name}", { name: entry.command!.name })
            : t("命令输出")}
        </span>
        {entry.command!.output && (
          <span className="min-w-0 flex-1 truncate font-mono text-muted">{entry.command!.output}</span>
        )}
      </div>
    );
  }

  if (entry.kind === "meta") {
    if (entry.truncated) {
      return (
        <div className="my-1.5 text-xs text-muted">
          {t("内容过大({size}),已跳过。", { size: `${((entry.byteLen ?? 0) / 1048576).toFixed(1)} MB` })}
          <button
            type="button"
            onClick={() => void getMessage(sessionId, entry.uuid).then(setLoaded)}
            className="ml-2 text-accent hover:underline"
          >
            {t("仍要加载")}
          </button>
          {loaded?.record && (
            <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap font-mono text-[11px]">
              {JSON.stringify(loaded.record, null, 2).slice(0, 40000)}
            </pre>
          )}
        </div>
      );
    }
    return <MetaGroup entries={[entry]} />;
  }

  const isUser = entry.kind === "user";
  const isThinking = entry.kind === "thinking";
  const text = entry.text ?? "";
  const long = text.length > 1500;
  const shown = expanded || !long ? text : text.slice(0, 1500);

  return (
    <div
      id={`entry-${entry.seq}`}
      className={`my-2 rounded-xl px-4 py-3 ${
        isUser
          ? "border border-line bg-bg"
          : isThinking
            ? "border border-dashed border-line/70 bg-transparent"
            : "bg-hover/25"
      } ${entry.superseded ? "border-l-2 border-l-danger/60 opacity-60" : ""}`}
    >
      <div className="mb-1 flex items-baseline gap-2 text-xs">
        <span className={isUser ? "font-medium" : isThinking ? "text-muted" : "font-medium text-accent"}>
          {isUser ? t("你") : isThinking ? t("思考") : t("Claude")}
        </span>
        {entry.ts && (
          <span className="text-muted">
            {new Date(entry.ts).toLocaleTimeString(localeOf(lang), { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
        {entry.model && <span className="text-muted">{entry.model.replace(/^claude-/, "")}</span>}
        {entry.superseded && (
          <span className="rounded bg-danger/10 px-1.5 py-0.5 text-[11px] text-danger">{t("已回退")}</span>
        )}
        <span className="ml-auto font-mono text-muted">#{entry.seq}</span>
      </div>
      <div className={`overflow-hidden text-sm leading-relaxed break-words ${isThinking ? "text-muted" : ""}`}>
        <Prose text={shown} />
        {long && !expanded && (
          <button type="button" onClick={() => setExpanded(true)} className="text-xs text-accent hover:underline">
            {t("展开全部")}
          </button>
        )}
      </div>
    </div>
  );
}

export function SessionDetail() {
  const { t, lang } = useI18n();
  const { id = "" } = useParams();
  const [session, setSession] = useState<SessionSummary | null>(null);
  const [subagents, setSubagents] = useState<SubagentInfo[]>([]);
  const [related, setRelated] = useState<RelatedSession[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [nextSeq, setNextSeq] = useState<number | null>(null);
  const [prevSeq, setPrevSeq] = useState<number | null>(null);
  const [outline, setOutline] = useState<OutlineTurn[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const streamRef = useRef<HTMLDivElement>(null);
  const [terminal, setTerminal] = useState<string | null>(null);
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [showThinking, setShowThinking] = useState(false);
  const [showMeta, setShowMeta] = useState(false);
  const [showSuperseded, setShowSuperseded] = useState(false);
  const [conversationOnly, setConversationOnly] = useState(false);

  useEffect(() => {
    void getSession(id).then((res) => {
      setSession(res.session);
      setSubagents(res.subagents);
      setRelated(res.related ?? []);
    });
    // land on the newest window, the way a chat client does: order stays
    // chronological, only the starting position changes
    void getLatestMessages(id, 80).then((res) => {
      setMessages(res.messages);
      setNextSeq(res.nextFromSeq);
      setPrevSeq(res.prevBeforeSeq);
    });
    void getOutline(id).then((res) => setOutline(res.turns));
  }, [id]);

  const supersededCount = useMemo(() => messages.filter((m) => m.superseded).length, [messages]);

  const rendered = useMemo(() => {
    const entries = buildTranscript(messages);
    return collapseMeta(filterTranscript(entries, { showThinking, showMeta, conversationOnly, showSuperseded }));
  }, [messages, showThinking, showMeta, conversationOnly, showSuperseded]);

  async function loadOlder() {
    if (prevSeq === null || loadingOlder) return;
    setLoadingOlder(true);
    const anchor = streamRef.current;
    const heightBefore = anchor?.scrollHeight ?? 0;
    try {
      const res = await getMessagesBefore(id, prevSeq, 80);
      setMessages((prev) => [...res.messages, ...prev]);
      setPrevSeq(res.prevBeforeSeq);
      // keep the reader's viewport anchored on what they were reading
      requestAnimationFrame(() => {
        if (anchor) window.scrollBy(0, anchor.scrollHeight - heightBefore);
      });
    } finally {
      setLoadingOlder(false);
    }
  }

  async function loadNewer() {
    if (nextSeq === null) return;
    const res = await getMessages(id, nextSeq, 80);
    setMessages((prev) => [...prev, ...res.messages]);
    setNextSeq(res.nextFromSeq);
  }

  /** Jump to a turn: load the window around it and scroll it into view. */
  async function jumpTo(seq: number) {
    const res = await getMessages(id, seq, 80);
    setMessages(res.messages);
    setNextSeq(res.nextFromSeq);
    setPrevSeq(res.prevBeforeSeq);
    requestAnimationFrame(() => {
      document.getElementById(`entry-${seq}`)?.scrollIntoView({ block: "start" });
    });
  }

  async function jumpToLatest() {
    const res = await getLatestMessages(id, 80);
    setMessages(res.messages);
    setNextSeq(res.nextFromSeq);
    setPrevSeq(res.prevBeforeSeq);
    requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight }));
  }

  async function startTerminal() {
    setTerminalError(null);
    try {
      const term = await openTerminal({ sessionId: id });
      setTerminal(term.name);
    } catch (err) {
      setTerminalError((err as Error).message);
    }
  }

  if (!session) return <div className="text-sm text-muted">{t("加载中…")}</div>;

  return (
    <div>
      <Link to="/sessions" className="text-sm text-muted hover:text-ink">
        {t("← 会话列表")}
      </Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-[22px] font-semibold tracking-tight">{session.title || session.id}</h1>
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted">
            <span className="font-mono">{session.cwd}</span>
            {session.gitBranch && <span className="font-mono">{session.gitBranch}</span>}
            {session.ccVersion && <span>CC {session.ccVersion}</span>}
            <span>{session.profileId}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void startTerminal()}
          className="shrink-0 rounded-lg bg-accent px-3.5 py-1.5 text-sm text-white hover:bg-accent-strong dark:text-ink"
        >
          {t("在终端中恢复")}
        </button>
      </div>

      {terminalError && <p className="mt-3 text-sm text-danger">{terminalError}</p>}
      {terminal && (
        <div className="mt-4">
          <TerminalPane name={terminal} />
          <p className="mt-2 text-xs text-muted">
            {t("会话运行在 tmux 中,关闭页面不会中断;重新打开即可继续。终端内 exit 退出后会话结束。")}
          </p>
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat label={t("费用")} value={session.costUsd ? fmtUsd(session.costUsd) : "—"} />
        <Stat label={t("消息")} value={String(session.userMsgCount + session.assistantMsgCount)} />
        <Stat
          label="tokens"
          value={fmtTokens(
            session.tokens.input + session.tokens.output + session.tokens.cacheRead + session.tokens.cacheCreation,
          )}
        />
        <Stat label={t("子代理")} value={String(session.subagentCount)} />
      </div>

      {related.length > 0 && (
        /* two files holding the same records: a branch of this conversation
           continued separately. No direction is claimed — both sides carry the
           same start time, so neither can be called the original. */
        <div className="mt-4 rounded-2xl border border-line bg-panel p-5">
          <h2 className="text-[15px] font-medium">{t("相关会话")}</h2>
          <p className="mt-1 text-sm text-muted">{t("这些会话与本会话包含相同的对话记录,应是同一段对话的不同分支。")}</p>
          <div className="mt-3 space-y-1.5">
            {related.map((r) => (
              <Link
                key={r.id}
                to={`/sessions/${r.id}`}
                className="flex min-w-0 items-baseline gap-3 rounded-lg border border-line px-3 py-2 text-sm transition-colors hover:border-accent hover:bg-hover"
              >
                <span className="min-w-0 flex-1 truncate">{r.title ?? r.id.slice(0, 8)}</span>
                <span className="shrink-0 text-xs text-muted">
                  {t("共享 {n} 条", { n: r.sharedRecords })} · {t("{n} 行", { n: r.lineCount })}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {subagents.length > 0 && <SubagentPanel subagents={subagents} sessionId={id} />}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Toggle active={conversationOnly} onClick={() => setConversationOnly((v) => !v)}>
          {t("只看对话")}
        </Toggle>
        <Toggle active={showThinking} onClick={() => setShowThinking((v) => !v)}>
          {t("显示思考")}
        </Toggle>
        <Toggle active={showMeta} onClick={() => setShowMeta((v) => !v)}>
          {t("显示元数据")}
        </Toggle>
        {/* only offered when there is something to show — most sessions were never rewound */}
        {supersededCount > 0 && (
          <Toggle active={showSuperseded} onClick={() => setShowSuperseded((v) => !v)}>
            {t("显示已回退({n})", { n: supersededCount })}
          </Toggle>
        )}
        <button
          type="button"
          onClick={() => void jumpToLatest()}
          className="ml-auto rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:bg-hover hover:text-ink"
        >
          {t("跳到最新")}
        </button>
      </div>

      <div className="mt-2 flex flex-col gap-4 lg:flex-row">
        {outline.length > 0 && (
          <aside className="hidden w-56 shrink-0 lg:block">
            <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-auto rounded-2xl border border-line bg-panel p-3">
              <div className="px-1 pb-2 text-xs text-muted">
                {t("对话大纲({n})", { n: outline.length })}
              </div>
              {outline.map((turn) => (
                <button
                  key={turn.seq}
                  type="button"
                  onClick={() => void jumpTo(turn.seq)}
                  className="block w-full truncate rounded px-1.5 py-1 text-left text-xs text-muted hover:bg-hover hover:text-ink"
                  title={turn.snippet}
                >
                  {turn.snippet.replace(/\s+/g, " ").slice(0, 48)}
                </button>
              ))}
            </div>
          </aside>
        )}

        <div ref={streamRef} className="min-w-0 flex-1 overflow-hidden rounded-2xl border border-line bg-panel px-3 py-3 sm:px-5">
          {prevSeq !== null && (
            <button
              type="button"
              disabled={loadingOlder}
              onClick={() => void loadOlder()}
              className="mb-3 w-full rounded-lg border border-line py-2 text-sm text-muted hover:bg-hover disabled:opacity-50"
            >
              {loadingOlder ? t("加载中…") : t("加载更早的消息")}
            </button>
          )}

          {rendered.map((item, index) =>
            Array.isArray(item) ? (
              <MetaGroup key={`group-${index}`} entries={item} />
            ) : (
              <Entry key={item.key} entry={item} sessionId={id} />
            ),
          )}

          {nextSeq !== null && (
            <button
              type="button"
              onClick={() => void loadNewer()}
              className="my-3 w-full rounded-lg border border-line py-2 text-sm text-muted hover:bg-hover"
            >
              {t("加载更多消息")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
