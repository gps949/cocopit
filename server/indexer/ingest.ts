import type { Database, Statement } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { priceEvent, type PricingTable } from "../cost/engine";
import { recomputeSuperseded } from "./liveChain";
import type { ParsedLine } from "./parser";
import type { WorkItem } from "./scanner";

export interface IngestPricing {
  table: PricingTable;
  version: number;
}

interface SessionAgg {
  firstTs: number | null;
  lastTs: number | null;
  lineCount: number;
  userCount: number;
  assistantCount: number;
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
  models: Set<string>;
  aiTitle: string | null;
  existingTitle: string | null;
  firstUserText: string | null;
  slug: string | null;
  gitBranch: string | null;
  version: string | null;
  cwd: string | null;
}

function emptyAgg(): SessionAgg {
  return {
    firstTs: null,
    lastTs: null,
    lineCount: 0,
    userCount: 0,
    assistantCount: 0,
    input: 0,
    output: 0,
    cacheCreation: 0,
    cacheRead: 0,
    models: new Set(),
    aiTitle: null,
    existingTitle: null,
    firstUserText: null,
    slug: null,
    gitBranch: null,
    version: null,
    cwd: null,
  };
}

const TITLE_MAX = 120;

/** Slash-command echoes and harness caveats make useless session titles. */
const TITLE_NOISE = /^(<command-name>|<local-command-stdout>|<system-reminder>|Caveat:)/;

/**
 * Single-writer sink for parsed lines. Subagent transcripts contribute only
 * usage_events (attributed to the parent session) and parse_errors; message
 * bodies of subagents are read live from their files when needed.
 */
export class Ingestor {
  #db: Database;
  #pricing: IngestPricing | null;
  #agg = new Map<string, SessionAgg>();
  #insMsg: Statement;
  #insUsage: Statement;
  #insTool: Statement;
  #insFts: Statement;
  #insErr: Statement;

  constructor(db: Database, pricing: IngestPricing | null = null) {
    this.#db = db;
    this.#pricing = pricing;
    this.#insMsg = db.prepare(
      `INSERT OR REPLACE INTO messages
         (session_id, uuid, parent_uuid, seq, byte_offset, byte_len, ts, type, subtype, model, is_sidechain, snippet)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.#insUsage = db.prepare(
      `INSERT OR REPLACE INTO usage_events
         (session_id, uuid, source, agent_id, ts, model, context_tier, service_tier,
          input_tokens, output_tokens, cache_read_tokens, cache_w5m_tokens, cache_w1h_tokens,
          web_search_requests, web_fetch_requests, cost_usd, pricing_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.#insTool = db.prepare(
      `INSERT INTO tool_calls (session_id, uuid, ts, tool_name, is_error, duration_ms)
       VALUES (?, ?, ?, ?, 0, NULL)`,
    );
    this.#insFts = db.prepare(
      `INSERT INTO fts_messages (content, session_id, uuid) VALUES (?, ?, ?)`,
    );
    this.#insErr = db.prepare(
      `INSERT INTO parse_errors (file_path, byte_offset, line_no, error, ts) VALUES (?, ?, ?, ?, ?)`,
    );
  }

  beginFile(item: WorkItem): void {
    const { task } = item;
    if (item.mode === "reparse") {
      if (task.kind === "session") {
        this.#db.prepare("DELETE FROM messages WHERE session_id = ?").run(task.sessionId);
        this.#db
          .prepare("DELETE FROM usage_events WHERE session_id = ? AND source = 'main'")
          .run(task.sessionId);
        this.#db.prepare("DELETE FROM tool_calls WHERE session_id = ?").run(task.sessionId);
        this.#db.prepare("DELETE FROM fts_messages WHERE session_id = ?").run(task.sessionId);
      } else {
        this.#db
          .prepare("DELETE FROM usage_events WHERE session_id = ? AND source = 'subagent' AND agent_id = ?")
          .run(task.sessionId, task.agentId ?? "");
      }
      this.#db.prepare("DELETE FROM parse_errors WHERE file_path = ?").run(task.path);
    }

    if (task.kind !== "session") return;

    const agg = emptyAgg();
    if (item.mode === "append") {
      const row = this.#db.prepare("SELECT * FROM sessions WHERE id = ?").get(task.sessionId) as
        | Record<string, unknown>
        | null;
      if (row) {
        agg.firstTs = row.first_ts as number | null;
        agg.lastTs = row.last_ts as number | null;
        agg.lineCount = (row.line_count as number) ?? 0;
        agg.userCount = (row.user_msg_count as number) ?? 0;
        agg.assistantCount = (row.assistant_msg_count as number) ?? 0;
        agg.input = (row.input_tokens as number) ?? 0;
        agg.output = (row.output_tokens as number) ?? 0;
        agg.cacheCreation = (row.cache_creation_tokens as number) ?? 0;
        agg.cacheRead = (row.cache_read_tokens as number) ?? 0;
        agg.models = new Set(row.models ? (JSON.parse(row.models as string) as string[]) : []);
        agg.existingTitle = row.title as string | null;
        agg.slug = row.slug as string | null;
        agg.gitBranch = row.git_branch as string | null;
        agg.version = row.cc_version as string | null;
      }
    }
    this.#agg.set(task.path, agg);
  }

  applyBatch(item: WorkItem, lines: ParsedLine[]): void {
    const { task } = item;
    const agg = this.#agg.get(task.path);
    this.#db.transaction(() => {
      for (const line of lines) {
        if (agg) agg.lineCount++;

        if (!line.ok) {
          this.#insErr.run(task.path, line.byteOffset, line.seq, line.error ?? "parse error", Date.now());
          continue;
        }

        if (line.usage) {
          const cost = this.#pricing
            ? priceEvent(this.#pricing.table, {
                model: line.usage.model,
                contextTier: line.usage.contextTier,
                input: line.usage.input,
                output: line.usage.output,
                cacheRead: line.usage.cacheRead,
                cacheW5m: line.usage.cacheW5m,
                cacheW1h: line.usage.cacheW1h,
                webSearch: line.usage.webSearch,
              })
            : null;
          this.#insUsage.run(
            task.sessionId,
            line.uuid ?? `no-uuid-${line.seq}`,
            task.kind === "subagent" ? "subagent" : "main",
            task.kind === "subagent" ? (task.agentId ?? "") : "",
            line.ts ?? 0,
            line.usage.model,
            line.usage.contextTier,
            line.usage.serviceTier ?? null,
            line.usage.input,
            line.usage.output,
            line.usage.cacheRead,
            line.usage.cacheW5m,
            line.usage.cacheW1h,
            line.usage.webSearch,
            line.usage.webFetch,
            cost,
            cost === null && !this.#pricing ? null : (this.#pricing?.version ?? null),
          );
        }

        if (task.kind === "subagent") continue;

        if (line.uuid) {
          this.#insMsg.run(
            task.sessionId,
            line.uuid,
            line.parentUuid ?? null,
            line.seq,
            line.byteOffset,
            line.byteLen,
            line.ts ?? null,
            line.type ?? "unknown",
            line.subtype ?? null,
            line.model ?? null,
            line.isSidechain ? 1 : 0,
            line.snippet ?? null,
          );
          for (const name of line.toolNames ?? []) {
            this.#insTool.run(task.sessionId, line.uuid, line.ts ?? null, name);
          }
          const ftsText = line.firstUserText ?? line.assistantText;
          if (ftsText) this.#insFts.run(ftsText, task.sessionId, line.uuid);
        }

        if (agg) {
          if (line.ts != null) {
            if (agg.firstTs == null || line.ts < agg.firstTs) agg.firstTs = line.ts;
            if (agg.lastTs == null || line.ts > agg.lastTs) agg.lastTs = line.ts;
          }
          if (line.firstUserText) {
            agg.userCount++;
            if (!agg.firstUserText && !TITLE_NOISE.test(line.firstUserText)) {
              agg.firstUserText = line.firstUserText;
            }
          }
          if (line.type === "assistant") agg.assistantCount++;
          if (line.usage) {
            agg.input += line.usage.input;
            agg.output += line.usage.output;
            agg.cacheRead += line.usage.cacheRead;
            agg.cacheCreation += line.usage.cacheW5m + line.usage.cacheW1h;
            agg.models.add(line.usage.model);
          }
          if (line.aiTitle) agg.aiTitle = line.aiTitle;
          if (!agg.slug && line.slug) agg.slug = line.slug;
          if (!agg.gitBranch && line.gitBranch) agg.gitBranch = line.gitBranch;
          if (!agg.version && line.version) agg.version = line.version;
          if (!agg.cwd && line.cwd) agg.cwd = line.cwd;
        }
      }
    })();
  }

  finishFile(item: WorkItem, consumedBytes: number): void {
    const { task } = item;
    this.#db.transaction(() => {
      if (task.kind === "session") {
        const agg = this.#agg.get(task.path) ?? emptyAgg();
        this.#db
          .prepare(
            // cwd here is only a seed for a brand-new project row; the
            // authoritative value is recomputed from the sessions below, since
            // any single session may have cd'd somewhere unrepresentative
            `INSERT INTO projects (profile_id, dir_name, cwd, first_ts, last_ts)
             VALUES ($profileId, $dir, $cwd, $first, $last)
             ON CONFLICT(profile_id, dir_name) DO UPDATE SET
               cwd = COALESCE(projects.cwd, excluded.cwd),
               first_ts = COALESCE(MIN(projects.first_ts, excluded.first_ts), projects.first_ts, excluded.first_ts),
               last_ts = COALESCE(MAX(projects.last_ts, excluded.last_ts), projects.last_ts, excluded.last_ts)`,
          )
          .run({ $profileId: task.profileId, $dir: task.projectDirName, $cwd: agg.cwd, $first: agg.firstTs, $last: agg.lastTs });
        const projectId = (
          this.#db
            .prepare("SELECT id FROM projects WHERE profile_id = $profileId AND dir_name = $dir")
            .get({ $profileId: task.profileId, $dir: task.projectDirName }) as { id: number }
        ).id;

        const title =
          agg.aiTitle ?? agg.existingTitle ?? (agg.firstUserText ? agg.firstUserText.slice(0, TITLE_MAX) : null);

        this.#db
          .prepare(
            `INSERT INTO sessions (id, project_id, file_path, file_size, file_mtime_ms, parsed_bytes,
               first_ts, last_ts, title, slug, git_branch, cc_version,
               line_count, user_msg_count, assistant_msg_count, models,
               input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, subagent_count, cost_usd, cwd)
             VALUES ($id, $pid, $path, $size, $mtime, $parsed, $first, $last, $title, $slug, $branch, $ver,
               $lines, $users, $assts, $models, $in, $out, $cw, $cr,
               (SELECT COUNT(*) FROM subagents WHERE session_id = $id),
               (SELECT SUM(cost_usd) FROM usage_events WHERE session_id = $id), $cwd)
             ON CONFLICT(id) DO UPDATE SET
               project_id = excluded.project_id, file_path = excluded.file_path,
               file_size = excluded.file_size, file_mtime_ms = excluded.file_mtime_ms,
               parsed_bytes = excluded.parsed_bytes,
               first_ts = excluded.first_ts, last_ts = excluded.last_ts,
               title = excluded.title, slug = excluded.slug,
               git_branch = excluded.git_branch, cc_version = excluded.cc_version,
               line_count = excluded.line_count, user_msg_count = excluded.user_msg_count,
               assistant_msg_count = excluded.assistant_msg_count, models = excluded.models,
               input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens,
               cache_creation_tokens = excluded.cache_creation_tokens,
               cache_read_tokens = excluded.cache_read_tokens,
               subagent_count = excluded.subagent_count,
               cost_usd = excluded.cost_usd, cwd = excluded.cwd`,
          )
          .run({
            $id: task.sessionId,
            $pid: projectId,
            $path: task.path,
            $size: task.size,
            $mtime: task.mtimeMs,
            $parsed: consumedBytes,
            $first: agg.firstTs,
            $last: agg.lastTs,
            $title: title,
            $slug: agg.slug,
            $branch: agg.gitBranch,
            $ver: agg.version,
            $lines: agg.lineCount,
            $users: agg.userCount,
            $assts: agg.assistantCount,
            $models: JSON.stringify([...agg.models].sort()),
            $in: agg.input,
            $out: agg.output,
            $cw: agg.cacheCreation,
            $cr: agg.cacheRead,
            $cwd: agg.cwd,
          });

        // depends on the whole file, so it can only be settled once every line
        // of this session has been written
        recomputeSuperseded(this.#db, task.sessionId);
      } else {
        let meta: Record<string, unknown> = {};
        try {
          meta = JSON.parse(readFileSync(task.path.replace(/\.jsonl$/, ".meta.json"), "utf8"));
        } catch {
          // meta.json missing or malformed — index the transcript anyway
        }
        this.#db
          .prepare(
            `INSERT INTO subagents (session_id, agent_id, agent_type, description, tool_use_id, spawn_depth,
               file_path, file_size, file_mtime_ms, parsed_bytes, cost_usd)
             VALUES ($sid, $aid, $type, $desc, $tuid, $depth, $path, $size, $mtime, $parsed,
               (SELECT SUM(cost_usd) FROM usage_events
                WHERE session_id = $sid AND source = 'subagent' AND agent_id = $aid))
             ON CONFLICT(session_id, agent_id) DO UPDATE SET
               agent_type = excluded.agent_type, description = excluded.description,
               tool_use_id = excluded.tool_use_id, spawn_depth = excluded.spawn_depth,
               file_path = excluded.file_path, file_size = excluded.file_size,
               file_mtime_ms = excluded.file_mtime_ms, parsed_bytes = excluded.parsed_bytes,
               cost_usd = excluded.cost_usd`,
          )
          .run({
            $sid: task.sessionId,
            $aid: task.agentId ?? "",
            $type: typeof meta.agentType === "string" ? meta.agentType : null,
            $desc: typeof meta.description === "string" ? meta.description : null,
            $tuid: typeof meta.toolUseId === "string" ? meta.toolUseId : null,
            $depth: typeof meta.spawnDepth === "number" ? meta.spawnDepth : null,
            $path: task.path,
            $size: task.size,
            $mtime: task.mtimeMs,
            $parsed: consumedBytes,
          });
        // the parent session may have finished before this subagent's usage
        // landed — refresh its rollups either way
        this.#db
          .prepare(
            `UPDATE sessions SET
               subagent_count = (SELECT COUNT(*) FROM subagents WHERE session_id = $sid),
               cost_usd = (SELECT SUM(cost_usd) FROM usage_events WHERE session_id = $sid)
             WHERE id = $sid`,
          )
          .run({ $sid: task.sessionId });
      }
    })();
    this.#agg.delete(task.path);
  }
}
