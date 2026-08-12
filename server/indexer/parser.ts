import { codexUserSpeech, humanUserText } from "../../shared/userText";
import type { RawLine } from "./scanner-lines";

export interface NormalizedUsage {
  model: string;
  contextTier: "default" | "long";
  serviceTier?: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheW5m: number;
  cacheW1h: number;
  webSearch: number;
  webFetch: number;
}

export interface ParsedLine {
  seq: number;
  byteOffset: number;
  byteLen: number;
  ok: boolean;
  error?: string;
  uuid?: string;
  parentUuid?: string;
  ts?: number;
  type?: string;
  subtype?: string;
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  slug?: string;
  isSidechain?: boolean;
  model?: string;
  usage?: NormalizedUsage;
  aiTitle?: string;
  firstUserText?: string;
  assistantText?: string;
  snippet?: string;
  toolNames?: string[];
  /** Codex: rate-limit snapshot riding on a token_count event. */
  codexRateLimits?: CodexRateLimits;
  /** Codex multi-agent: the thread this rollout was spawned from. */
  parentSessionId?: string;
  /** Codex multi-agent: the agent's nickname (e.g. "Epicurus"). */
  agentLabel?: string;
  /** Codex: the logical thread id — resumes open new files under the same thread. */
  threadId?: string;
  /** Codex: the rollout this one was forked from. */
  forkedFrom?: string;
}

const SNIPPET_MAX = 300;

export function normalizeModel(model: string): {
  base: string;
  contextTier: "default" | "long";
  synthetic: boolean;
} {
  if (model === "<synthetic>") {
    return { base: model, contextTier: "default", synthetic: true };
  }
  if (model.endsWith("[1m]")) {
    return { base: model.slice(0, -"[1m]".length), contextTier: "long", synthetic: false };
  }
  return { base: model, contextTier: "default", synthetic: false };
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function makeSnippet(text: string): string {
  return text.replace(/\n/g, " ").slice(0, SNIPPET_MAX);
}

/** Joined text blocks of a content array; string content passes through. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b && typeof b === "object" && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n");
}

function extractUsage(record: Record<string, unknown>): NormalizedUsage | undefined {
  if (record.type !== "assistant") return undefined;
  const message = record.message as Record<string, unknown> | undefined;
  const model = str(message?.model);
  if (!message || !model) return undefined;
  const norm = normalizeModel(model);
  if (norm.synthetic) return undefined;
  const u = message.usage as Record<string, unknown> | undefined;
  if (!u || typeof u !== "object") return undefined;

  const breakdown = u.cache_creation as Record<string, unknown> | undefined;
  const hasBreakdown = breakdown != null && typeof breakdown === "object";
  const usage: NormalizedUsage = {
    model: norm.base,
    contextTier: norm.contextTier,
    input: num(u.input_tokens),
    output: num(u.output_tokens),
    cacheRead: num(u.cache_read_input_tokens),
    cacheW5m: hasBreakdown
      ? num(breakdown.ephemeral_5m_input_tokens)
      : num(u.cache_creation_input_tokens),
    cacheW1h: hasBreakdown ? num(breakdown.ephemeral_1h_input_tokens) : 0,
    webSearch: num((u.server_tool_use as Record<string, unknown> | undefined)?.web_search_requests),
    webFetch: num((u.server_tool_use as Record<string, unknown> | undefined)?.web_fetch_requests),
  };
  const serviceTier = str(u.service_tier);
  if (serviceTier) usage.serviceTier = serviceTier;
  return usage;
}

/** Codex rate-limit snapshot embedded in token_count events. */
export interface CodexRateLimits {
  primary?: { used_percent?: number; window_minutes?: number; resets_at?: number };
  secondary?: { used_percent?: number; window_minutes?: number; resets_at?: number };
}

/**
 * Per-file parse state for Codex rollouts: token_count events carry no model,
 * so the model comes from the turn_context that preceded them.
 */
export interface CodexContext {
  sessionId: string;
  model?: string;
}


function codexTextOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (b) =>
        b &&
        typeof b === "object" &&
        (b.type === "input_text" || b.type === "output_text" || b.type === "text") &&
        typeof b.text === "string",
    )
    .map((b) => b.text as string)
    .join("\n");
}

/**
 * Normalizes one Codex rollout record into the same ParsedLine the ingester
 * already understands. Message uuids are synthesized as cx-<session>-<seq>:
 * stable across reparses (seq is deterministic) and globally unique, so the
 * cross-session link rebuild cannot mistake two rollouts for a shared history.
 */
export function parseCodexLine(raw: RawLine, seq: number, ctx: CodexContext): ParsedLine {
  const out: ParsedLine = { seq, byteOffset: raw.byteOffset, byteLen: raw.byteLen, ok: true };

  let record: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw.text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ...out, ok: false, error: "line is not a JSON object" };
    }
    record = parsed as Record<string, unknown>;
  } catch (err) {
    return { ...out, ok: false, error: (err as Error).message };
  }

  const ts = str(record.timestamp);
  if (ts) {
    const parsed = Date.parse(ts);
    if (!Number.isNaN(parsed)) out.ts = parsed;
  }
  const kind = str(record.type);
  const payload = record.payload as Record<string, unknown> | undefined;
  if (!payload || typeof payload !== "object") return out;

  const uuid = () => `cx-${ctx.sessionId}-${seq}`;

  switch (kind) {
    case "session_meta": {
      out.type = "session_meta";
      out.cwd = str(payload.cwd);
      out.version = str(payload.cli_version);
      // multi-agent rollouts: a subagent's file names its parent thread
      out.parentSessionId = str(payload.parent_thread_id);
      out.agentLabel = str(payload.agent_nickname);
      // lineage: session_id is the logical thread, id is this file; a resume
      // opens a new file under the same thread, a fork names its source
      const threadId = str(payload.session_id);
      const fileId = str(payload.id);
      if (threadId && threadId !== fileId) out.threadId = threadId;
      out.forkedFrom = str(payload.forked_from_id);
      break;
    }
    case "turn_context": {
      const model = str(payload.model);
      if (model) {
        ctx.model = model;
        // surfaced so the ingester can backfill: newer rollouts put the only
        // turn_context at the END of the file, after every token_count
        out.model = model;
      }
      out.type = "turn_context";
      // cwd can change mid-session (codex --cd); the mode over sessions decides
      out.cwd = str(payload.cwd);
      break;
    }
    case "event_msg": {
      if (payload.type !== "token_count") break;
      const info = payload.info as Record<string, unknown> | null | undefined;
      const last = info?.last_token_usage as Record<string, unknown> | undefined;
      if (last && typeof last === "object") {
        const input = num(last.input_tokens);
        const cached = num(last.cached_input_tokens);
        out.usage = {
          // cached tokens are a subset of input_tokens in OpenAI's accounting;
          // our schema prices them separately, so split them out
          model: ctx.model ?? "codex-unknown",
          contextTier: "default",
          input: Math.max(0, input - cached),
          output: num(last.output_tokens),
          cacheRead: cached,
          cacheW5m: 0,
          cacheW1h: 0,
          webSearch: 0,
          webFetch: 0,
        };
      }
      const limits = payload.rate_limits as CodexRateLimits | undefined;
      if (limits && typeof limits === "object") out.codexRateLimits = limits;
      break;
    }
    case "response_item": {
      const ptype = str(payload.type);
      if (ptype === "message") {
        const role = str(payload.role);
        const text = codexTextOf(payload.content);
        if (role === "assistant") {
          out.type = "assistant";
          out.uuid = uuid();
          out.model = ctx.model;
          if (text) {
            out.assistantText = text;
            out.snippet = makeSnippet(text);
          }
        } else if (role === "user") {
          out.type = "user";
          out.uuid = uuid();
          const speech = text ? codexUserSpeech(text) : null;
          if (speech) {
            out.firstUserText = speech;
            out.snippet = makeSnippet(speech);
          }
        } else {
          // developer/system instructions: bookkeeping, not conversation
          out.type = "meta";
          out.uuid = uuid();
        }
      } else if (ptype === "function_call" || ptype === "custom_tool_call" || ptype === "web_search_call") {
        out.type = "tool";
        out.subtype = ptype;
        out.uuid = uuid();
        const name = str(payload.name) ?? (ptype === "web_search_call" ? "web_search" : undefined);
        if (name) out.toolNames = [name];
      } else if (ptype === "function_call_output" || ptype === "custom_tool_call_output") {
        out.type = "tool_result";
        out.subtype = ptype;
        out.uuid = uuid();
      } else if (ptype === "reasoning") {
        out.type = "thinking";
        out.subtype = "reasoning";
        out.uuid = uuid();
      }
      break;
    }
    case "compacted": {
      out.type = "compacted";
      out.uuid = uuid();
      break;
    }
  }

  return out;
}

export function parseLine(raw: RawLine, seq: number): ParsedLine {
  const out: ParsedLine = {
    seq,
    byteOffset: raw.byteOffset,
    byteLen: raw.byteLen,
    ok: true,
  };

  let record: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw.text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ...out, ok: false, error: "line is not a JSON object" };
    }
    record = parsed as Record<string, unknown>;
  } catch (err) {
    return { ...out, ok: false, error: (err as Error).message };
  }

  out.uuid = str(record.uuid);
  out.parentUuid = str(record.parentUuid);
  out.sessionId = str(record.sessionId);
  out.cwd = str(record.cwd);
  out.gitBranch = str(record.gitBranch);
  out.version = str(record.version);
  out.slug = str(record.slug);
  out.type = str(record.type);
  out.subtype = str(record.subtype);
  if (typeof record.isSidechain === "boolean") out.isSidechain = record.isSidechain;
  const timestamp = str(record.timestamp);
  if (timestamp) {
    const ts = Date.parse(timestamp);
    if (!Number.isNaN(ts)) out.ts = ts;
  }

  const message = record.message as Record<string, unknown> | undefined;

  if (out.type === "assistant" && message && typeof message === "object") {
    out.model = str(message.model);
    if (out.subtype !== "api_error") out.usage = extractUsage(record);
    const text = textOf(message.content);
    if (text) {
      out.assistantText = text;
      out.snippet = makeSnippet(text);
    }
    if (Array.isArray(message.content)) {
      const names = message.content
        .filter((b) => b && typeof b === "object" && b.type === "tool_use" && typeof b.name === "string")
        .map((b) => b.name as string);
      if (names.length > 0) out.toolNames = names;
    }
  } else if (out.type === "user" && !record.isMeta && message && typeof message === "object") {
    // only real speech gets a snippet — the outline and search are built on
    // this, and hook/notification text drowns out the handful of actual turns
    const text = humanUserText(message.content);
    if (text) {
      out.firstUserText = text;
      out.snippet = makeSnippet(text);
    }
  } else if (out.type === "ai-title") {
    for (const key of ["title", "content"] as const) {
      const title = str(record[key]);
      if (title && title.trim()) {
        out.aiTitle = title;
        break;
      }
    }
  }

  return out;
}
