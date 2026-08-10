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
    const text = textOf(message.content);
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
