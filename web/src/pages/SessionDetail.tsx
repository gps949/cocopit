import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  getMessage,
  getMessages,
  getSession,
  openTerminal,
  recordText,
  roleOf,
  type MessageRow,
  type SessionSummary,
  type SubagentInfo,
} from "../api/sessions";
import { fmtTokens, fmtUsd } from "../components/EChart";
import { TerminalPane } from "../components/Terminal";

const ROLE_LABEL: Record<string, string> = {
  user: "你",
  assistant: "Claude",
  system: "系统",
  other: "记录",
};

function MessageCard({ row, sessionId }: { row: MessageRow; sessionId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [full, setFull] = useState<MessageRow | null>(null);

  const record = full?.record ?? row.record;
  const role = roleOf(record);
  const text = record ? recordText(record) : "";
  const long = text.length > 1200;
  const shown = expanded || !long ? text : text.slice(0, 1200);

  async function loadFull() {
    const fetched = await getMessage(sessionId, row.uuid);
    setFull(fetched);
    setExpanded(true);
  }

  return (
    <div className="border-b border-line/60 py-3 last:border-0">
      <div className="flex items-baseline gap-2 text-xs text-muted">
        <span className={role === "assistant" ? "text-accent" : role === "user" ? "text-ink" : ""}>
          {ROLE_LABEL[role]}
        </span>
        {record?.timestamp && <span>{new Date(record.timestamp).toLocaleTimeString("zh-CN")}</span>}
        {record?.message?.model && <span>{String(record.message.model).replace(/^claude-/, "")}</span>}
        <span className="ml-auto font-mono">#{row.seq}</span>
      </div>

      {row.truncated && !full ? (
        <div className="mt-1.5 text-sm text-muted">
          内容过大({(row.byteLen / 1048576).toFixed(1)} MB),已跳过。
          <button type="button" onClick={() => void loadFull()} className="ml-2 text-accent hover:underline">
            仍要加载
          </button>
        </div>
      ) : text ? (
        <div className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed">
          {shown}
          {long && !expanded && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="ml-2 text-xs text-accent hover:underline"
            >
              展开全部
            </button>
          )}
        </div>
      ) : (
        <div className="mt-1.5 text-sm text-muted">[{record?.type ?? "无内容"}]</div>
      )}
    </div>
  );
}

export function SessionDetail() {
  const { id = "" } = useParams();
  const [session, setSession] = useState<SessionSummary | null>(null);
  const [subagents, setSubagents] = useState<SubagentInfo[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [nextSeq, setNextSeq] = useState<number | null>(0);
  const [terminal, setTerminal] = useState<string | null>(null);
  const [terminalError, setTerminalError] = useState<string | null>(null);

  useEffect(() => {
    void getSession(id).then((res) => {
      setSession(res.session);
      setSubagents(res.subagents);
    });
    void getMessages(id, 0, 60).then((res) => {
      setMessages(res.messages);
      setNextSeq(res.nextFromSeq);
    });
  }, [id]);

  async function loadMore() {
    if (nextSeq === null) return;
    const res = await getMessages(id, nextSeq, 60);
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

  if (!session) return <div className="text-sm text-muted">加载中…</div>;

  return (
    <div>
      <Link to="/sessions" className="text-sm text-muted hover:text-ink">
        ← 会话列表
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
          在终端中恢复
        </button>
      </div>

      {terminalError && <p className="mt-3 text-sm text-danger">{terminalError}</p>}
      {terminal && (
        <div className="mt-4">
          <TerminalPane name={terminal} />
          <p className="mt-2 text-xs text-muted">
            会话运行在 tmux 中,关闭页面不会中断;重新打开即可继续。终端内 <span className="font-mono">exit</span>{" "}
            退出后会话结束。
          </p>
        </div>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-4">
        <Stat label="费用" value={session.costUsd ? fmtUsd(session.costUsd) : "—"} />
        <Stat label="消息" value={String(session.userMsgCount + session.assistantMsgCount)} />
        <Stat
          label="tokens"
          value={fmtTokens(
            session.tokens.input + session.tokens.output + session.tokens.cacheRead + session.tokens.cacheCreation,
          )}
        />
        <Stat label="子代理" value={String(session.subagentCount)} />
      </div>

      {subagents.length > 0 && (
        <div className="mt-4 rounded-2xl border border-line bg-panel p-5">
          <h2 className="text-[15px] font-medium">子代理</h2>
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

      <div className="mt-4 rounded-2xl border border-line bg-panel px-5 py-2">
        {messages.map((row) => (
          <MessageCard key={`${row.seq}-${row.uuid}`} row={row} sessionId={id} />
        ))}
        {nextSeq !== null && (
          <button
            type="button"
            onClick={() => void loadMore()}
            className="my-3 w-full rounded-lg border border-line py-2 text-sm text-muted hover:bg-hover"
          >
            加载更多消息
          </button>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-panel p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
