import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  getMessage,
  getMessages,
  getSession,
  openTerminal,
  type MessageRow,
  type SessionSummary,
  type SubagentInfo,
} from "../api/sessions";
import { fmtTokens, fmtUsd } from "../components/EChart";
import { TerminalPane } from "../components/Terminal";
import { localeOf, useI18n } from "../i18n";
import {
  buildTranscript,
  collapseMeta,
  filterTranscript,
  type TranscriptEntry,
} from "../lib/transcript";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-panel p-4">
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

/** Renders prose with fenced code blocks lifted out into <pre>. */
function Prose({ text }: { text: string }) {
  const parts = useMemo(() => {
    const out: Array<{ code: boolean; lang?: string; body: string }> = [];
    const pattern = /```(\w*)\n([\s\S]*?)```/g;
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      if (match.index > last) out.push({ code: false, body: text.slice(last, match.index) });
      out.push({ code: true, lang: match[1] || undefined, body: match[2]! });
      last = pattern.lastIndex;
    }
    if (last < text.length) out.push({ code: false, body: text.slice(last) });
    return out;
  }, [text]);

  return (
    <>
      {parts.map((part, index) =>
        part.code ? (
          <pre
            key={index}
            className="my-2 overflow-x-auto rounded-lg border border-line bg-bg p-3 font-mono text-xs leading-relaxed"
          >
            {part.body.replace(/\n$/, "")}
          </pre>
        ) : (
          <p key={index} className="whitespace-pre-wrap break-words">
            {part.body.trim()}
          </p>
        ),
      )}
    </>
  );
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
        className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left"
      >
        <span className={`shrink-0 text-xs ${result?.isError ? "text-danger" : "text-accent"}`}>
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
        <div className="mt-1 space-y-0.5 border-l border-line pl-3">
          {entries.map((entry) => (
            <div key={entry.key} className="font-mono text-[11px] text-muted">
              #{entry.seq} {entry.metaLabel}
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
      <div className="my-1.5 flex items-baseline gap-2 text-xs">
        <span className="rounded bg-hover px-1.5 py-0.5 font-mono text-muted">
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
      className={`my-2 rounded-xl px-4 py-3 ${
        isUser
          ? "border border-line bg-bg"
          : isThinking
            ? "border border-dashed border-line/70 bg-transparent"
            : "bg-hover/25"
      }`}
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
        <span className="ml-auto font-mono text-muted">#{entry.seq}</span>
      </div>
      <div className={`text-sm leading-relaxed ${isThinking ? "text-muted" : ""}`}>
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
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [nextSeq, setNextSeq] = useState<number | null>(0);
  const [terminal, setTerminal] = useState<string | null>(null);
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [showThinking, setShowThinking] = useState(false);
  const [showMeta, setShowMeta] = useState(false);
  const [conversationOnly, setConversationOnly] = useState(false);

  useEffect(() => {
    void getSession(id).then((res) => {
      setSession(res.session);
      setSubagents(res.subagents);
    });
    void getMessages(id, 0, 120).then((res) => {
      setMessages(res.messages);
      setNextSeq(res.nextFromSeq);
    });
  }, [id]);

  const rendered = useMemo(() => {
    const entries = buildTranscript(messages);
    return collapseMeta(filterTranscript(entries, { showThinking, showMeta, conversationOnly }));
  }, [messages, showThinking, showMeta, conversationOnly]);

  async function loadMore() {
    if (nextSeq === null) return;
    const res = await getMessages(id, nextSeq, 120);
    setMessages((prev) => [...prev, ...res.messages]);
    setNextSeq(res.nextFromSeq);
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

      <div className="mt-5 grid gap-4 sm:grid-cols-4">
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

      {subagents.length > 0 && (
        <div className="mt-4 rounded-2xl border border-line bg-panel p-5">
          <h2 className="text-[15px] font-medium">{t("子代理")}</h2>
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            {subagents.map((sub) => (
              <div key={sub.agentId} className="rounded-lg border border-line px-3 py-2">
                <div className="text-xs text-muted">{sub.agentType ?? "agent"}</div>
                <div className="mt-0.5 font-mono text-xs">{sub.agentId.slice(0, 12)}</div>
                {sub.costUsd != null && <div className="mt-0.5 text-xs">{fmtUsd(sub.costUsd)}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

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
        <span className="ml-auto text-xs text-muted">
          {new Date(session.firstTs ?? 0).toLocaleDateString(localeOf(lang))}
        </span>
      </div>

      <div className="mt-2 rounded-2xl border border-line bg-panel px-5 py-3">
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
            onClick={() => void loadMore()}
            className="my-3 w-full rounded-lg border border-line py-2 text-sm text-muted hover:bg-hover"
          >
            {t("加载更多消息")}
          </button>
        )}
      </div>
    </div>
  );
}
