import { getJson } from "./usage";

export interface SessionSummary {
  id: string;
  projectId: number;
  cwd: string | null;
  dirName: string;
  profileId: string;
  title: string | null;
  slug: string | null;
  gitBranch: string | null;
  ccVersion: string | null;
  firstTs: number | null;
  lastTs: number | null;
  lineCount: number;
  userMsgCount: number;
  assistantMsgCount: number;
  models: string[];
  tokens: { input: number; output: number; cacheCreation: number; cacheRead: number };
  costUsd: number | null;
  subagentCount: number;
}

export interface SessionListResponse {
  sessions: SessionSummary[];
  nextCursor: string | null;
  note?: string;
}

export interface SubagentInfo {
  agentId: string;
  agentType: string | null;
  description: string | null;
  spawnDepth: number | null;
  costUsd: number | null;
}

export interface MessageRow {
  seq: number;
  uuid: string;
  record: any | null;
  byteLen: number;
  truncated?: boolean;
  error?: string;
}

export interface ProjectRow {
  id: number;
  profileId: string;
  dirName: string;
  cwd: string | null;
  sessionCount: number;
  costUsd: number;
  lastSessionTs: number | null;
}

export interface LiveSessionRow {
  pid: number;
  sessionId: string;
  cwd: string;
  name?: string;
  status?: string;
  version?: string;
  updatedAt?: number;
  alive: boolean;
}

export const listSessions = (query: string) => getJson<SessionListResponse>(`/api/sessions${query}`);
export const getSession = (id: string) =>
  getJson<{ session: SessionSummary; subagents: SubagentInfo[] }>(`/api/sessions/${id}`);
export interface MessageWindow {
  messages: MessageRow[];
  nextFromSeq: number | null;
  prevBeforeSeq: number | null;
}

export const getMessages = (id: string, fromSeq: number, limit = 100) =>
  getJson<MessageWindow>(`/api/sessions/${id}/messages?fromSeq=${fromSeq}&limit=${limit}`);

/** Newest window — the default landing spot, like a chat app. */
export const getLatestMessages = (id: string, limit = 80) =>
  getJson<MessageWindow>(`/api/sessions/${id}/messages?tail=${limit}`);

/** The window immediately above `seq`, for scrolling back through history. */
export const getMessagesBefore = (id: string, before: number, limit = 80) =>
  getJson<MessageWindow>(`/api/sessions/${id}/messages?before=${before}&limit=${limit}`);

export interface OutlineTurn {
  seq: number;
  uuid: string;
  ts: number | null;
  snippet: string;
}

export const getOutline = (id: string) =>
  getJson<{ turns: OutlineTurn[]; total: number }>(`/api/sessions/${id}/outline`);

export interface SubagentTranscript {
  agentType: string | null;
  description: string | null;
  costUsd: number | null;
  records: MessageRow[];
  total: number;
  truncatedFile: boolean;
}

export const getSubagentTranscript = (id: string, agentId: string, offset = 0, limit = 200) =>
  getJson<SubagentTranscript>(
    `/api/sessions/${id}/subagents/${encodeURIComponent(agentId)}?offset=${offset}&limit=${limit}`,
  );
export const getMessage = (id: string, uuid: string) =>
  getJson<MessageRow>(`/api/sessions/${id}/messages/${uuid}`);
export const listProjects = () => getJson<{ projects: ProjectRow[] }>("/api/projects");
export const listLive = () => getJson<{ sessions: LiveSessionRow[] }>("/api/live");

export async function openTerminal(body: { sessionId?: string; projectId?: number }) {
  const res = await fetch("/api/terminal", { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`);
  return (await res.json()) as { name: string; title: string; cwd: string; kind: "resume" | "new" };
}

/** Human-readable text for one transcript record, whatever its shape. */
export function recordText(record: any): string {
  const content = record?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block: any) => {
        if (block?.type === "text") return block.text;
        if (block?.type === "thinking") return block.thinking ? `[思考] ${block.thinking}` : "[思考]";
        if (block?.type === "tool_use") return `[工具 ${block.name}] ${JSON.stringify(block.input).slice(0, 400)}`;
        if (block?.type === "tool_result") {
          const inner = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
          return `[结果] ${String(inner).slice(0, 600)}`;
        }
        return `[${block?.type ?? "?"}]`;
      })
      .filter(Boolean)
      .join("\n\n");
  }
  if (record?.type === "ai-title") return `[标题] ${record.title ?? record.content ?? ""}`;
  return "";
}

export function roleOf(record: any): "user" | "assistant" | "system" | "other" {
  const type = record?.type;
  if (type === "user" || type === "assistant" || type === "system") return type;
  return "other";
}
