import type { Database } from "bun:sqlite";
import { priceEvent, type PricingTable } from "./engine";

export function getPricingVersion(db: Database): number {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'pricing_version'").get() as
    | { value: string }
    | null;
  return row ? Number(row.value) : 1;
}

export function setPricingVersion(db: Database, version: number): void {
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('pricing_version', $v) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run({ $v: String(version) });
}

interface UsageRow {
  session_id: string;
  uuid: string;
  source: string;
  agent_id: string;
  model: string;
  context_tier: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_w5m_tokens: number;
  cache_w1h_tokens: number;
  web_search_requests: number;
}

export interface RecalcResult {
  updated: number;
  unpriced: number;
}

export interface RecalcOptions {
  batchSize?: number;
  onProgress?: (updated: number) => void;
}

/**
 * Re-prices every usage event against the given table, in batched transactions
 * keyed on the composite PK cursor so the event loop breathes between batches.
 * Finishes by stamping the pricing version and refreshing session/subagent
 * cost rollups.
 */
export async function recalculateAll(
  db: Database,
  table: PricingTable,
  version: number,
  opts: RecalcOptions = {},
): Promise<RecalcResult> {
  const batchSize = opts.batchSize ?? 10_000;
  const selectStmt = db.prepare(
    `SELECT session_id, uuid, source, agent_id, model, context_tier,
            input_tokens, output_tokens, cache_read_tokens, cache_w5m_tokens, cache_w1h_tokens,
            web_search_requests
     FROM usage_events
     WHERE (session_id, uuid, source, agent_id) > ($sid, $uuid, $source, $agentId)
     ORDER BY session_id, uuid, source, agent_id
     LIMIT $limit`,
  );
  const updateStmt = db.prepare(
    `UPDATE usage_events SET cost_usd = $cost, pricing_version = $version
     WHERE session_id = $sid AND uuid = $uuid AND source = $source AND agent_id = $agentId`,
  );

  let cursor = { $sid: "", $uuid: "", $source: "", $agentId: "" };
  let updated = 0;
  let unpriced = 0;

  for (;;) {
    const rows = selectStmt.all({ ...cursor, $limit: batchSize }) as unknown as UsageRow[];
    if (rows.length === 0) break;

    db.transaction(() => {
      for (const row of rows) {
        const cost = priceEvent(table, {
          model: row.model,
          contextTier: row.context_tier === "long" ? "long" : "default",
          input: row.input_tokens,
          output: row.output_tokens,
          cacheRead: row.cache_read_tokens,
          cacheW5m: row.cache_w5m_tokens,
          cacheW1h: row.cache_w1h_tokens,
          webSearch: row.web_search_requests,
        });
        if (cost === null) unpriced++;
        updateStmt.run({
          $cost: cost,
          $version: version,
          $sid: row.session_id,
          $uuid: row.uuid,
          $source: row.source,
          $agentId: row.agent_id,
        });
        updated++;
      }
    })();

    const last = rows[rows.length - 1]!;
    cursor = { $sid: last.session_id, $uuid: last.uuid, $source: last.source, $agentId: last.agent_id };
    opts.onProgress?.(updated);
    // yield so the HTTP server stays responsive during a full recalc
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  setPricingVersion(db, version);
  refreshCostRollups(db);
  return { updated, unpriced };
}

/** Recomputes sessions.cost_usd (main + subagent spend) and subagents.cost_usd. */
export function refreshCostRollups(db: Database): void {
  db.transaction(() => {
    db.run(
      `UPDATE sessions SET cost_usd =
         (SELECT SUM(cost_usd) FROM usage_events WHERE usage_events.session_id = sessions.id)`,
    );
    db.run(
      `UPDATE subagents SET cost_usd =
         (SELECT SUM(cost_usd) FROM usage_events
          WHERE usage_events.session_id = subagents.session_id
            AND usage_events.source = 'subagent'
            AND usage_events.agent_id = subagents.agent_id)`,
    );
  })();
}
