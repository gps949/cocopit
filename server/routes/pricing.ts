import type { Database } from "bun:sqlite";
import { writeFileSync } from "node:fs";
import {
  loadPricingTable,
  loadUserPricing,
  userPricingPath,
  type PricingEntry,
} from "../cost/engine";
import { getPricingVersion, recalculateAll, setPricingVersion } from "../cost/recalc";
import type { Router } from "../http/router";
import type { SseHub } from "../http/sse";
import type { IndexScheduler } from "../indexer/scheduler";

function validEntry(entry: unknown): entry is PricingEntry {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as PricingEntry;
  if (typeof e.match !== "string" || e.match.length === 0) return false;
  const tier = e.tiers?.default;
  if (!tier) return false;
  return ["input", "output", "cacheRead", "cacheWrite5m", "cacheWrite1h"].every(
    (key) => typeof (tier as unknown as Record<string, unknown>)[key] === "number",
  );
}

export function registerPricingRoutes(
  router: Router,
  db: Database,
  hub: SseHub,
  scheduler: IndexScheduler,
): void {
  router.register("GET", "/api/pricing", () => {
    return Response.json({
      version: getPricingVersion(db),
      table: loadPricingTable(),
      userEntries: loadUserPricing(),
    });
  });

  router.register("PUT", "/api/pricing", async (req) => {
    let entries: unknown;
    try {
      const body = (await req.json()) as { entries?: unknown };
      entries = body.entries;
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }
    if (!Array.isArray(entries) || !entries.every(validEntry)) {
      return Response.json(
        { error: "entries must be pricing entries with a complete default tier" },
        { status: 400 },
      );
    }

    writeFileSync(userPricingPath(), JSON.stringify({ entries }, null, 2) + "\n");
    const table = loadPricingTable();
    const version = getPricingVersion(db) + 1;
    setPricingVersion(db, version);
    scheduler.setPricing({ table, version });

    // recalculate in the background; SSE announces completion
    void recalculateAll(db, table, version).then((result) => {
      hub.broadcast("pricing.recalculated", { version, ...result });
    });

    return Response.json({ version, entries });
  });
}
