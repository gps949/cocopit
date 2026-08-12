/**
 * Turns raw transcript records into renderable entries.
 *
 * A real session is dominated by machinery rather than conversation: in one
 * 3.4k-line sample, 1247 records were hook attachments and 551 tool calls, with
 * only 14 actual user messages. Rendering records one-per-row (and attributing
 * tool results to "the user", since they arrive inside user-role messages)
 * makes the transcript unreadable — hence this classification pass.
 */

import { codexUserSpeech, SYSTEM_WRAPPER_TAGS, stripSystemWrappers } from "../../../shared/userText";

export type EntryKind =
  | "user"
  | "assistant"
  | "thinking"
  | "tool"
  | "command"
  | "meta";

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  /** One-line gist of the call, e.g. the bash command or the file path. */
  summary: string;
  result?: { text: string; isError: boolean };
  /** Context the tool pulled into the conversation (skill bodies, hook output). */
  injected?: string;
}

export interface TranscriptEntry {
  key: string;
  kind: EntryKind;
  seq: number;
  uuid: string;
  ts?: number;
  model?: string;
  /** Prose for user/assistant/thinking entries. */
  text?: string;
  tool?: ToolCall;
  /** Slash command invocation. */
  command?: { name: string; args?: string; output?: string };
  /** Short label for a metadata record. */
  metaLabel?: string;
  byteLen?: number;
  truncated?: boolean;
  /** taken back by a rewind — real, but not part of how the session ended */
  superseded?: boolean;
}

export interface RawMessage {
  seq: number;
  uuid: string;
  record: any | null;
  byteLen: number;
  truncated?: boolean;
  superseded?: boolean;
}

/** Record types that carry no conversation, only bookkeeping. */
const META_TYPES = new Set([
  "attachment",
  "mode",
  "permission-mode",
  "bridge-session",
  "last-prompt",
  "ai-title",
  "file-history-snapshot",
  "file-history-delta",
  "queue-operation",
  "pr-link",
  "summary",
]);

function tagContent(text: string, tag: string): string | null {
  const match = new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i").exec(text);
  return match ? match[2]!.trim() : null;
}

const stripWrappers = stripSystemWrappers;

/** The wrapper tag a record is entirely made of, if any. */
function systemWrapperTag(text: string): string | null {
  for (const tag of SYSTEM_WRAPPER_TAGS) {
    if (new RegExp(`^\\s*<${tag}(\\s[^>]*)?>`, "i").test(text)) return tag;
  }
  return null;
}

/** Compact gist per tool, using the input key that actually identifies the call. */
export function summarizeTool(name: string, input: Record<string, unknown>): string {
  const str = (key: string) => (typeof input[key] === "string" ? (input[key] as string) : "");
  switch (name) {
    case "Bash":
      return str("command");
    case "Read":
    case "Write":
    case "Edit":
    case "NotebookEdit":
      return str("file_path");
    case "Glob":
    case "Grep":
      return [str("pattern"), str("path")].filter(Boolean).join("  ");
    case "Skill":
      return [str("skill"), str("args")].filter(Boolean).join(" ");
    case "Task":
    case "Agent":
      return str("description") || str("subagent_type");
    case "TaskCreate":
      return str("subject");
    case "TaskUpdate":
      return [str("taskId"), str("status")].filter(Boolean).join(" → ");
    case "WebFetch":
    case "ToolSearch":
      return str("url") || str("query");
    default: {
      if (name.startsWith("mcp__")) {
        const first = Object.values(input).find((v) => typeof v === "string");
        return typeof first === "string" ? first : "";
      }
      const preferred = ["command", "file_path", "query", "path", "url", "description", "prompt"];
      for (const key of preferred) if (str(key)) return str(key);
      const firstString = Object.values(input).find((v) => typeof v === "string");
      return typeof firstString === "string" ? firstString : "";
    }
  }
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block: any) => (block?.type === "text" ? block.text : `[${block?.type ?? "?"}]`))
      .join("\n");
  }
  return content == null ? "" : JSON.stringify(content);
}

/** Short label for a bookkeeping record, so it can collapse to one line. */
function metaLabel(record: any): string {
  const type = record?.type ?? "record";
  if (type === "attachment") {
    const kind = record?.attachment?.type;
    return kind ? `attachment · ${kind}` : "attachment";
  }
  if (type === "system") return record?.subtype ? `system · ${record.subtype}` : "system";
  if (type === "ai-title") return `ai-title · ${record.title ?? record.content ?? ""}`.slice(0, 80);
  return type;
}

/**
 * Flattens records into entries, pairing each tool call with the result that
 * arrives in a later user-role record.
 */
/**
 * Codex rollouts speak a different schema: records wrap a `payload`, tool
 * calls pair with their outputs via call_id, and reasoning arrives as summary
 * blocks. Normalized here into the same entries the renderer already knows.
 */
export function buildCodexTranscript(messages: RawMessage[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  const callsById = new Map<string, ToolCall>();

  const textOf = (content: unknown): string =>
    Array.isArray(content)
      ? content
          .filter((b: any) => b && typeof b.text === "string")
          .map((b: any) => String(b.text))
          .join("\n")
      : "";

  for (const message of messages) {
    const { record, seq, uuid, byteLen, truncated, superseded } = message;
    const base = {
      seq,
      uuid,
      byteLen,
      truncated,
      superseded,
      ts: record?.timestamp ? Date.parse(record.timestamp) : undefined,
    };

    if (truncated || !record) {
      entries.push({ ...base, key: `${seq}-oversized`, kind: "meta", metaLabel: "oversized" });
      continue;
    }
    if (record.type === "compacted") {
      entries.push({ ...base, key: `${seq}-compacted`, kind: "meta", metaLabel: "compacted" });
      continue;
    }
    const payload = record.payload;
    if (record.type !== "response_item" || !payload || typeof payload !== "object") {
      entries.push({ ...base, key: `${seq}-meta`, kind: "meta", metaLabel: String(record.type ?? "record") });
      continue;
    }

    switch (payload.type) {
      case "message": {
        const text = textOf(payload.content);
        if (payload.role === "assistant") {
          entries.push({ ...base, key: `${seq}-a`, kind: "assistant", text });
        } else if (payload.role === "user") {
          // injected context (environment, plugin ads) arrives as user text;
          // pasted Claude wrappers are stripped, keeping the actual speech
          const speech = codexUserSpeech(text);
          if (speech) {
            entries.push({ ...base, key: `${seq}-u`, kind: "user", text: speech });
          } else {
            const trimmed = text.trimStart();
            const tag = /^<([a-z_-]+)/i.exec(trimmed)?.[1];
            const label = tag ?? (/^## Referenced ChatGPT/i.test(trimmed) ? "referenced ChatGPT conversation" : "context");
            entries.push({ ...base, key: `${seq}-inj`, kind: "meta", metaLabel: label });
          }
        } else {
          entries.push({ ...base, key: `${seq}-dev`, kind: "meta", metaLabel: payload.role ?? "instructions" });
        }
        break;
      }
      case "function_call":
      case "custom_tool_call": {
        let input: Record<string, unknown> = {};
        try {
          if (typeof payload.arguments === "string") input = JSON.parse(payload.arguments);
          else if (typeof payload.input === "string") input = { input: payload.input };
        } catch {
          input = { arguments: String(payload.arguments ?? "") };
        }
        const name = String(payload.name ?? "tool");
        const call: ToolCall = { id: String(payload.call_id ?? seq), name, input, summary: summarizeTool(name, input) };
        if (payload.call_id) callsById.set(String(payload.call_id), call);
        entries.push({ ...base, key: `${seq}-t`, kind: "tool", tool: call });
        break;
      }
      case "function_call_output":
      case "custom_tool_call_output": {
        const owner = payload.call_id ? callsById.get(String(payload.call_id)) : undefined;
        const output =
          typeof payload.output === "string" ? payload.output : JSON.stringify(payload.output ?? "");
        if (owner) {
          owner.result = { text: output, isError: false };
        } else {
          entries.push({ ...base, key: `${seq}-to`, kind: "meta", metaLabel: "tool output" });
        }
        break;
      }
      case "web_search_call": {
        const query = String(payload.action?.query ?? "");
        const call: ToolCall = {
          id: String(payload.id ?? seq),
          name: "web_search",
          input: { query },
          summary: query,
        };
        entries.push({ ...base, key: `${seq}-ws`, kind: "tool", tool: call });
        break;
      }
      case "reasoning": {
        const text = Array.isArray(payload.summary)
          ? payload.summary
              .filter((b: any) => b && typeof b.text === "string")
              .map((b: any) => String(b.text))
              .join("\n")
          : "";
        if (text) entries.push({ ...base, key: `${seq}-r`, kind: "thinking", text });
        break;
      }
      default:
        entries.push({ ...base, key: `${seq}-x`, kind: "meta", metaLabel: String(payload.type ?? "record") });
    }
  }

  return entries;
}

export function buildTranscript(messages: RawMessage[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  const callsById = new Map<string, ToolCall>();

  for (const message of messages) {
    const { record, seq, uuid, byteLen, truncated, superseded } = message;
    const base = { seq, uuid, byteLen, truncated, superseded, ts: record?.timestamp ? Date.parse(record.timestamp) : undefined };

    if (truncated || !record) {
      entries.push({ ...base, key: `${seq}-oversized`, kind: "meta", metaLabel: "oversized" });
      continue;
    }

    const type = record.type as string | undefined;
    if (type && META_TYPES.has(type)) {
      entries.push({ ...base, key: `${seq}-meta`, kind: "meta", metaLabel: metaLabel(record) });
      continue;
    }
    if (type === "system") {
      entries.push({ ...base, key: `${seq}-sys`, kind: "meta", metaLabel: metaLabel(record) });
      continue;
    }

    const content = record.message?.content;
    const model = record.message?.model as string | undefined;

    // A user-role record flagged isMeta is context the harness injected, not
    // something the user typed; sourceToolUseID says which call pulled it in.
    if (type === "user" && record.isMeta) {
      const text = Array.isArray(content)
        ? content
            .filter((b: any) => b?.type === "text")
            .map((b: any) => String(b.text ?? ""))
            .join("\n")
        : typeof content === "string"
          ? content
          : "";
      const owner = record.sourceToolUseID ? callsById.get(String(record.sourceToolUseID)) : undefined;
      if (owner) {
        owner.injected = owner.injected ? `${owner.injected}\n\n${text}` : text;
      } else {
        entries.push({ ...base, key: `${seq}-injected`, kind: "meta", metaLabel: "injected context" });
      }
      continue;
    }

    // string content: a plain user message, possibly wrapped in command tags
    if (typeof content === "string") {
      const commandName = tagContent(content, "command-name");
      if (commandName) {
        entries.push({
          ...base,
          key: `${seq}-cmd`,
          kind: "command",
          command: {
            name: commandName,
            args: tagContent(content, "command-args") || undefined,
            output: tagContent(content, "local-command-stdout") || undefined,
          },
        });
        continue;
      }
      const stdout = tagContent(content, "local-command-stdout");
      if (stdout !== null && !stripWrappers(content)) {
        entries.push({ ...base, key: `${seq}-out`, kind: "command", command: { name: "", output: stdout } });
        continue;
      }
      const text = stripWrappers(content);
      if (!text) {
        // machine-generated, but often worth reading (a notification carries the
        // agent's result), so keep the body behind a collapsed label
        const tag = systemWrapperTag(content) ?? "system-reminder";
        const inner = tagContent(content, tag);
        entries.push({
          ...base,
          key: `${seq}-meta`,
          kind: "meta",
          metaLabel: tag,
          text: inner || undefined,
        });
        continue;
      }
      entries.push({ ...base, key: `${seq}-user`, kind: "user", text });
      continue;
    }

    if (!Array.isArray(content)) {
      entries.push({ ...base, key: `${seq}-meta`, kind: "meta", metaLabel: metaLabel(record) });
      continue;
    }

    let index = 0;
    for (const block of content) {
      index++;
      if (!block || typeof block !== "object") continue;
      const key = `${seq}-${index}`;

      if (block.type === "text") {
        const text = stripWrappers(String(block.text ?? ""));
        if (!text) continue;
        entries.push({
          ...base,
          key,
          kind: type === "assistant" ? "assistant" : "user",
          text,
          model,
        });
      } else if (block.type === "thinking") {
        const text = String(block.thinking ?? "").trim();
        if (text) entries.push({ ...base, key, kind: "thinking", text, model });
      } else if (block.type === "tool_use") {
        const call: ToolCall = {
          id: String(block.id ?? key),
          name: String(block.name ?? "tool"),
          input: (block.input ?? {}) as Record<string, unknown>,
          summary: summarizeTool(String(block.name ?? ""), (block.input ?? {}) as Record<string, unknown>),
        };
        callsById.set(call.id, call);
        entries.push({ ...base, key, kind: "tool", tool: call, model });
      } else if (block.type === "tool_result") {
        const call = callsById.get(String(block.tool_use_id));
        const text = resultText(block.content);
        if (call) {
          // attach to its call instead of emitting a row attributed to the user
          call.result = { text, isError: Boolean(block.is_error) };
        } else {
          entries.push({
            ...base,
            key,
            kind: "tool",
            tool: {
              id: String(block.tool_use_id ?? key),
              name: "",
              input: {},
              summary: "",
              result: { text, isError: Boolean(block.is_error) },
            },
          });
        }
      }
    }
  }

  return entries;
}

export interface TranscriptFilters {
  showThinking: boolean;
  showMeta: boolean;
  conversationOnly: boolean;
  /** rewound-away records are hidden unless asked for */
  showSuperseded?: boolean;
}

export function filterTranscript(
  entries: TranscriptEntry[],
  filters: TranscriptFilters,
): TranscriptEntry[] {
  return entries.filter((entry) => {
    if (entry.superseded && !filters.showSuperseded) return false;
    if (entry.kind === "meta") return filters.showMeta;
    if (entry.kind === "thinking") return filters.showThinking && !filters.conversationOnly;
    if (entry.kind === "tool") return !filters.conversationOnly;
    return true;
  });
}

/** Groups consecutive metadata entries so they collapse into one line. */
export function collapseMeta(entries: TranscriptEntry[]): Array<TranscriptEntry | TranscriptEntry[]> {
  const out: Array<TranscriptEntry | TranscriptEntry[]> = [];
  let run: TranscriptEntry[] = [];
  const flush = () => {
    if (run.length === 1) out.push(run[0]!);
    else if (run.length > 1) out.push(run);
    run = [];
  };
  for (const entry of entries) {
    if (entry.kind === "meta") run.push(entry);
    else {
      flush();
      out.push(entry);
    }
  }
  flush();
  return out;
}
