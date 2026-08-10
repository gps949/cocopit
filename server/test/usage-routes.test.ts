import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations, openDb } from "../db/db";
import { SseHub } from "../http/sse";
import { createServer } from "../index";
import { IndexScheduler } from "../indexer/scheduler";

let dir: string;
let home: string;
let prevHome: string | undefined;
let db: Database;
let server: ReturnType<typeof createServer>;
let base: string;

// two events on day 2026-08-01 (10:00, 11:00 UTC), one on 2026-08-02
const T1 = Date.parse("2026-08-01T10:00:00Z");
const T2 = Date.parse("2026-08-01T11:00:00Z");
const T3 = Date.parse("2026-08-02T09:00:00Z");

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ccockpit-usage-"));
  prevHome = process.env.CCOCKPIT_HOME;
  home = mkdtempSync(join(tmpdir(), "ccockpit-usage-home-"));
  process.env.CCOCKPIT_HOME = home;

  db = openDb(":memory:");
  applyMigrations(db);
  db.run("INSERT INTO projects (id, profile_id, dir_name, cwd) VALUES (1, 'default', '-p1', '/tmp/p1')");
  db.run("INSERT INTO projects (id, profile_id, dir_name, cwd) VALUES (2, 'default', '-p2', '/tmp/p2')");
  db.run("INSERT INTO sessions (id, project_id, file_path, last_ts) VALUES ('s1', 1, '/x/s1.jsonl', 1)");
  db.run("INSERT INTO sessions (id, project_id, file_path, last_ts) VALUES ('s2', 2, '/x/s2.jsonl', 2)");
  const ins = db.prepare(
    `INSERT INTO usage_events (session_id, uuid, source, agent_id, ts, model,
       input_tokens, output_tokens, cache_read_tokens, cache_w5m_tokens, cache_w1h_tokens, cost_usd, pricing_version)
     VALUES (?, ?, 'main', '', ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
  );
  // s1: opus event day1, fable event day1; s2: haiku day2; unpriced kimi day2
  ins.run("s1", "u1", T1, "claude-opus-4-8", 1000, 100, 5000, 200, 300, 0.05);
  ins.run("s1", "u2", T2, "claude-fable-5", 2000, 200, 0, 0, 0, 0.03);
  ins.run("s2", "u3", T3, "claude-haiku-4-5", 500, 50, 0, 0, 0, 0.001);
  ins.run("s2", "u4", T3, "hf:moonshotai/Kimi-K2.5", 900, 90, 0, 0, 0, null);

  // calibration source: fake ~/.claude.json with lastModelUsage for /tmp/p1
  const claudeJson = join(dir, "claude.json");
  writeFileSync(
    claudeJson,
    JSON.stringify({
      projects: {
        "/tmp/p1": {
          lastModelUsage: {
            // consistent with our table: 1000×$5 + 100×$25 + 10000 cacheRead×$0.50
            // + 4000 cacheCreation somewhere between all-5m ($6.25) and all-1h ($10)
            "claude-opus-4-8": {
              costUSD: (1000 * 5 + 100 * 25 + 10000 * 0.5 + 4000 * 8) / 1e6,
              inputTokens: 1000,
              outputTokens: 100,
              cacheReadInputTokens: 10000,
              cacheCreationInputTokens: 4000,
            },
            // way off our table → must flag as mismatch
            "claude-haiku-4-5": { costUSD: 0.5, inputTokens: 1000, outputTokens: 100 },
          },
        },
      },
    }),
  );

  const scheduler = new IndexScheduler(db, { workers: 1 });
  server = createServer(0, {
    db,
    scheduler,
    hub: new SseHub(),
    claudeDir: dir,
    claudeJsonPath: claudeJson,
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
  if (prevHome === undefined) delete process.env.CCOCKPIT_HOME;
  else process.env.CCOCKPIT_HOME = prevHome;
});

async function get(path: string): Promise<any> {
  const res = await fetch(`${base}${path}`);
  expect(res.status).toBe(200);
  return res.json();
}

describe("usage aggregation routes", () => {
  test("summary totals and unpriced count", async () => {
    const s = await get("/api/usage/summary");
    expect(s.events).toBe(4);
    expect(s.costUsd).toBeCloseTo(0.081, 10);
    expect(s.inputTokens).toBe(4400);
    expect(s.outputTokens).toBe(440);
    expect(s.cacheReadTokens).toBe(5000);
    expect(s.cacheWriteTokens).toBe(500);
    expect(s.unpricedEvents).toBe(1);
  });

  test("summary honors from/to and project filters", async () => {
    const day1 = await get(`/api/usage/summary?from=${T1}&to=${T2 + 1}`);
    expect(day1.events).toBe(2);
    expect(day1.costUsd).toBeCloseTo(0.08, 10);

    const p2 = await get("/api/usage/summary?project=2");
    expect(p2.events).toBe(2);
    expect(p2.costUsd).toBeCloseTo(0.001, 10);
  });

  test("daily buckets by local date", async () => {
    const d = await get("/api/usage/daily");
    expect(d.days.length).toBeGreaterThanOrEqual(2);
    const total = d.days.reduce((n: number, day: any) => n + day.costUsd, 0);
    expect(total).toBeCloseTo(0.081, 10);
  });

  test("by-model groups with unpriced flag", async () => {
    const m = await get("/api/usage/by-model");
    const kimi = m.models.find((x: any) => x.model.startsWith("hf:"));
    expect(kimi.unpriced).toBe(true);
    expect(kimi.events).toBe(1);
    const opus = m.models.find((x: any) => x.model === "claude-opus-4-8");
    expect(opus.costUsd).toBeCloseTo(0.05, 10);
  });

  test("by-project joins through sessions", async () => {
    const p = await get("/api/usage/by-project");
    const p1 = p.projects.find((x: any) => x.cwd === "/tmp/p1");
    expect(p1.costUsd).toBeCloseTo(0.08, 10);
    expect(p1.events).toBe(2);
  });

  test("heatmap has weekday × hour cells", async () => {
    const h = await get("/api/usage/heatmap");
    expect(h.cells.length).toBeGreaterThanOrEqual(2);
    for (const cell of h.cells) {
      expect(cell.weekday).toBeGreaterThanOrEqual(0);
      expect(cell.weekday).toBeLessThanOrEqual(6);
      expect(cell.hour).toBeGreaterThanOrEqual(0);
      expect(cell.hour).toBeLessThanOrEqual(23);
    }
  });

  test("cache-efficiency reports read/write and savings", async () => {
    const c = await get("/api/usage/cache-efficiency");
    expect(c.cacheReadTokens).toBe(5000);
    expect(c.cacheWrite5mTokens).toBe(200);
    expect(c.cacheWrite1hTokens).toBe(300);
    // opus: reads at $0.50 instead of $5 input → saved 5000×4.5/1e6
    expect(c.savedUsd).toBeCloseTo((5000 * (5 - 0.5)) / 1e6, 10);
    expect(c.hitRate).toBeCloseTo(5000 / (5000 + 4400), 10);
  });

  test("unpriced lists third-party models", async () => {
    const u = await get("/api/usage/unpriced");
    expect(u.models).toHaveLength(1);
    expect(u.models[0].model).toBe("hf:moonshotai/Kimi-K2.5");
    expect(u.models[0].totalTokens).toBe(990);
  });

  test("calibration checks official costUSD against our [all-5m, all-1h] band", async () => {
    const c = await get("/api/usage/calibration");
    const opus = c.rows.find((x: any) => x.cwd === "/tmp/p1" && x.model === "claude-opus-4-8");
    // cache split is unknown in lastModelUsage, so ours is a band
    expect(opus.oursLowUsd).toBeCloseTo((1000 * 5 + 100 * 25 + 10000 * 0.5 + 4000 * 6.25) / 1e6, 10);
    expect(opus.oursHighUsd).toBeCloseTo((1000 * 5 + 100 * 25 + 10000 * 0.5 + 4000 * 10) / 1e6, 10);
    expect(opus.status).toBe("ok"); // official falls inside the band

    const haiku = c.rows.find((x: any) => x.model === "claude-haiku-4-5");
    expect(haiku.status).toBe("mismatch");
    expect(haiku.deviation).toBeGreaterThan(0.05);
  });
});

describe("pricing routes", () => {
  test("GET /api/pricing returns merged table and version", async () => {
    const p = await get("/api/pricing");
    expect(p.version).toBe(1);
    expect(p.table.entries.length).toBeGreaterThan(10);
    expect(p.userEntries).toEqual([]);
  });

  test("PUT /api/pricing writes overrides, bumps version, recalculates, broadcasts", async () => {
    const abort = new AbortController();
    const events = await fetch(`${base}/api/events`, { signal: abort.signal });
    const reader = events.body!.getReader();

    const res = await fetch(`${base}/api/pricing`, {
      method: "PUT",
      body: JSON.stringify({
        entries: [
          {
            match: "claude-opus-4-8",
            tiers: { default: { input: 10, output: 50, cacheRead: 1, cacheWrite5m: 12.5, cacheWrite1h: 20 } },
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe(2);

    // recalc completion is broadcast over SSE
    const dec = new TextDecoder();
    let buf = "";
    const deadline = Date.now() + 5000;
    while (!buf.includes("event: pricing.recalculated") && Date.now() < deadline) {
      const r = await Promise.race([
        reader.read(),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("sse timeout")), 5000)),
      ]);
      if (r.done) break;
      buf += dec.decode(r.value, { stream: true });
    }
    abort.abort();
    expect(buf).toContain("event: pricing.recalculated");

    // event re-priced at the overridden rate: 1000×10 + 100×50 + 5000×1 + 200×12.5 + 300×20 per MTok
    const row = db.prepare("SELECT cost_usd, pricing_version FROM usage_events WHERE uuid = 'u1'").get() as {
      cost_usd: number;
      pricing_version: number;
    };
    expect(row.cost_usd).toBeCloseTo((1000 * 10 + 100 * 50 + 5000 * 1 + 200 * 12.5 + 300 * 20) / 1e6, 10);
    expect(row.pricing_version).toBe(2);
  });
});
