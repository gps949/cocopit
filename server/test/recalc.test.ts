import { beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { DEFAULT_PRICING, mergePricing } from "../cost/engine";
import { getPricingVersion, recalculateAll, refreshCostRollups, setPricingVersion } from "../cost/recalc";
import { applyMigrations, insertMany, openDb } from "../db/db";

let db: Database;

beforeEach(() => {
  db = openDb(":memory:");
  applyMigrations(db);
  db.run("INSERT INTO projects (id, profile_id, dir_name) VALUES (1, 'default', '-p1')");
  db.run("INSERT INTO sessions (id, project_id, file_path) VALUES ('s1', 1, '/x/s1.jsonl')");
  db.run(
    "INSERT INTO subagents (session_id, agent_id, file_path) VALUES ('s1', 'a1', '/x/s1/subagents/agent-a1.jsonl')",
  );
});

function insertUsage(rows: Array<[string, string, string, string, number, number]>): void {
  // [uuid, source, agent_id, model, input, output]
  const stmt = db.prepare(
    `INSERT INTO usage_events (session_id, uuid, source, agent_id, ts, model, input_tokens, output_tokens)
     VALUES ('s1', ?, ?, ?, 0, ?, ?, ?)`,
  );
  insertMany(
    db,
    stmt,
    rows.map(([uuid, source, agentId, model, input, output]) => [uuid, source, agentId, model, input, output]),
  );
}

describe("pricing version bookkeeping", () => {
  test("defaults to 1, persists updates", () => {
    expect(getPricingVersion(db)).toBe(1);
    setPricingVersion(db, 3);
    expect(getPricingVersion(db)).toBe(3);
  });
});

describe("recalculateAll", () => {
  test("prices all events, leaves unknown models NULL, stamps the version", async () => {
    insertUsage([
      ["u1", "main", "", "claude-opus-4-8", 1_000_000, 0],
      ["u2", "main", "", "claude-fable-5", 0, 1_000_000],
      ["u3", "main", "", "deepseek-v4-flash", 500, 500],
    ]);
    const result = await recalculateAll(db, DEFAULT_PRICING, 2);
    expect(result.updated).toBe(3);
    expect(result.unpriced).toBe(1);

    const rows = db
      .prepare("SELECT uuid, cost_usd, pricing_version FROM usage_events ORDER BY uuid")
      .all() as Array<Record<string, unknown>>;
    expect(rows[0]!.cost_usd as number).toBeCloseTo(5, 10);
    expect(rows[1]!.cost_usd as number).toBeCloseTo(50, 10);
    expect(rows[2]!.cost_usd).toBeNull();
    for (const row of rows) expect(row.pricing_version).toBe(2);
    expect(getPricingVersion(db)).toBe(2);
  });

  test("re-pricing with overridden table changes costs", async () => {
    insertUsage([["u1", "main", "", "claude-opus-4-8", 1_000_000, 0]]);
    await recalculateAll(db, DEFAULT_PRICING, 2);
    const table = mergePricing(DEFAULT_PRICING, [
      {
        match: "claude-opus-4-8",
        tiers: { default: { input: 7, output: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10 } },
      },
    ]);
    await recalculateAll(db, table, 3);
    const row = db.prepare("SELECT cost_usd, pricing_version FROM usage_events").get() as Record<string, unknown>;
    expect(row.cost_usd as number).toBeCloseTo(7, 10);
    expect(row.pricing_version).toBe(3);
  });

  test("long context tier honored", async () => {
    db.run(
      `INSERT INTO usage_events (session_id, uuid, source, agent_id, ts, model, context_tier, input_tokens)
       VALUES ('s1', 'u-long', 'main', '', 0, 'claude-sonnet-4-5-20250929', 'long', 1000000)`,
    );
    await recalculateAll(db, DEFAULT_PRICING, 2);
    const row = db.prepare("SELECT cost_usd FROM usage_events").get() as { cost_usd: number };
    expect(row.cost_usd).toBeCloseTo(6, 10); // 1M-beta premium input rate
  });

  test("batches cover more rows than one batch size", async () => {
    const rows: Array<[string, string, string, string, number, number]> = [];
    for (let i = 0; i < 2500; i++) rows.push([`u${i}`, "main", "", "claude-haiku-4-5", 1000, 100]);
    insertUsage(rows);
    const result = await recalculateAll(db, DEFAULT_PRICING, 2, { batchSize: 1000 });
    expect(result.updated).toBe(2500);
    const n = db
      .prepare("SELECT COUNT(*) AS n FROM usage_events WHERE cost_usd IS NOT NULL AND pricing_version = 2")
      .get() as { n: number };
    expect(n.n).toBe(2500);
  });
});

describe("refreshCostRollups", () => {
  test("sessions and subagents roll up their usage costs", async () => {
    insertUsage([
      ["u1", "main", "", "claude-opus-4-8", 1_000_000, 0],
      ["u2", "subagent", "a1", "claude-haiku-4-5", 1_000_000, 0],
    ]);
    await recalculateAll(db, DEFAULT_PRICING, 2);
    refreshCostRollups(db);
    const session = db.prepare("SELECT cost_usd FROM sessions WHERE id = 's1'").get() as { cost_usd: number };
    expect(session.cost_usd).toBeCloseTo(6, 10); // main $5 + subagent $1
    const sub = db.prepare("SELECT cost_usd FROM subagents WHERE agent_id = 'a1'").get() as { cost_usd: number };
    expect(sub.cost_usd).toBeCloseTo(1, 10);
  });
});
