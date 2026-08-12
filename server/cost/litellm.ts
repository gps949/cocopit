import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveCocopitHome } from "../config";
import { resolveEntry, type PricingTable, type PricingTier } from "./engine";

/**
 * Second opinion on prices: LiteLLM maintains a community price table for
 * essentially every model. Comparing against it catches a stale local table,
 * and prices models we don't ship (third-party endpoints). It is a suggestion —
 * applying a row writes a normal user override, nothing happens automatically.
 */

export const LITELLM_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

export interface LiteLLMEntry {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_read_input_token_cost?: number;
  cache_creation_input_token_cost?: number;
  cache_creation_input_token_cost_above_1hr?: number;
}

const PER_MILLION = 1_000_000;

/** LiteLLM quotes per-token costs; our table is per million tokens. */
export function toPricingTier(entry: LiteLLMEntry): PricingTier | null {
  const input = entry.input_cost_per_token;
  const output = entry.output_cost_per_token;
  if (typeof input !== "number" || typeof output !== "number") return null;

  const cacheWrite5m = (entry.cache_creation_input_token_cost ?? input * 1.25) * PER_MILLION;
  // the published multiplier for the 1h cache write is 2× base input
  const cacheWrite1h = (entry.cache_creation_input_token_cost_above_1hr ?? input * 2) * PER_MILLION;
  return {
    input: input * PER_MILLION,
    output: output * PER_MILLION,
    cacheRead: (entry.cache_read_input_token_cost ?? input * 0.1) * PER_MILLION,
    cacheWrite5m,
    cacheWrite1h,
  };
}

export interface PriceDiffRow {
  model: string;
  ours: PricingTier | null;
  theirs: PricingTier | null;
  differs: boolean;
  /** Field names whose value disagrees. */
  changed: Array<keyof PricingTier>;
}

const FIELDS: Array<keyof PricingTier> = ["input", "output", "cacheRead", "cacheWrite5m", "cacheWrite1h"];
const TOLERANCE = 1e-9;

/**
 * `usedModels` are the models actually seen in the local usage data. The
 * catalog has ~3000 entries, so relevance is what filters it: a row appears
 * when we already price the model (staleness check) or when it shows up in
 * your own sessions but has no price yet.
 */
export function diffAgainstLiteLLM(
  table: PricingTable,
  catalog: Record<string, LiteLLMEntry>,
  usedModels: string[] = [],
): PriceDiffRow[] {
  const rows: PriceDiffRow[] = [];
  const used = new Set(usedModels);

  for (const [model, entry] of Object.entries(catalog)) {
    const ourEntry = resolveEntry(table, model);
    if (!ourEntry && !used.has(model)) continue;

    const theirs = toPricingTier(entry);
    if (!theirs) continue;
    const ours = ourEntry?.tiers.default ?? null;

    const changed = ours
      ? FIELDS.filter((field) => Math.abs(ours[field] - theirs[field]) > TOLERANCE)
      : [...FIELDS];
    rows.push({ model, ours, theirs, differs: !ours || changed.length > 0, changed });
  }

  // differences first — the whole point is to notice them
  rows.sort((a, b) => Number(b.differs) - Number(a.differs) || a.model.localeCompare(b.model));
  return rows;
}

function cachePath(): string {
  return join(resolveCocopitHome(), "litellm-prices.json");
}

export interface LiteLLMSnapshot {
  fetchedAt: number;
  catalog: Record<string, LiteLLMEntry>;
}

export function readCachedCatalog(): LiteLLMSnapshot | null {
  const path = cachePath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as LiteLLMSnapshot;
  } catch {
    return null;
  }
}

/** Downloads the catalog and caches it; callers decide when to refresh. */
export async function fetchCatalog(
  fetcher: typeof fetch = fetch,
): Promise<LiteLLMSnapshot> {
  const res = await fetcher(LITELLM_URL);
  if (!res.ok) throw new Error(`LiteLLM 价格库获取失败:HTTP ${res.status}`);
  const catalog = (await res.json()) as Record<string, LiteLLMEntry>;
  const snapshot: LiteLLMSnapshot = { fetchedAt: Date.now(), catalog };
  writeFileSync(cachePath(), JSON.stringify(snapshot), { mode: 0o600 });
  return snapshot;
}
