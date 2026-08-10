import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveCcockpitHome } from "../config";
import defaultTable from "./pricing.default.json";

export interface PricingTier {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}

export interface PricingEntry {
  match: string;
  note?: string;
  tiers: { default: PricingTier; long?: PricingTier };
}

export interface PricingTable {
  note?: string;
  serverTools: { webSearchPer1k: number };
  entries: PricingEntry[];
}

export interface PriceableEvent {
  model: string;
  contextTier: "default" | "long";
  input: number;
  output: number;
  cacheRead: number;
  cacheW5m: number;
  cacheW1h: number;
  webSearch: number;
}

export const DEFAULT_PRICING: PricingTable = defaultTable as PricingTable;

/** Longest matching prefix wins; null when no entry covers the model. */
export function resolveEntry(table: PricingTable, model: string): PricingEntry | null {
  let best: PricingEntry | null = null;
  for (const entry of table.entries) {
    if (model.startsWith(entry.match) && (!best || entry.match.length > best.match.length)) {
      best = entry;
    }
  }
  return best;
}

/**
 * USD cost of one usage event, or null when the model is unpriced.
 * The long tier falls back to default when absent — Claude 4.6+ includes the
 * 1M window at standard rates.
 */
export function priceEvent(table: PricingTable, ev: PriceableEvent): number | null {
  const entry = resolveEntry(table, ev.model);
  if (!entry) return null;
  const tier = (ev.contextTier === "long" ? entry.tiers.long : undefined) ?? entry.tiers.default;
  const tokensUsd =
    (ev.input * tier.input +
      ev.output * tier.output +
      ev.cacheRead * tier.cacheRead +
      ev.cacheW5m * tier.cacheWrite5m +
      ev.cacheW1h * tier.cacheWrite1h) /
    1_000_000;
  const toolsUsd = ev.webSearch * (table.serverTools.webSearchPer1k / 1000);
  return tokensUsd + toolsUsd;
}

/** User entries replace default entries wholesale by match key; new keys append. */
export function mergePricing(base: PricingTable, overrides: PricingEntry[]): PricingTable {
  const entries = new Map(base.entries.map((entry) => [entry.match, entry]));
  for (const override of overrides) entries.set(override.match, override);
  return { ...base, entries: [...entries.values()] };
}

export function userPricingPath(): string {
  return join(resolveCcockpitHome(), "pricing.user.json");
}

/** Reads pricing.user.json (an array of entries, or {entries: [...]}) if present. */
export function loadUserPricing(): PricingEntry[] {
  const path = userPricingPath();
  if (!existsSync(path)) return [];
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (Array.isArray(parsed)) return parsed as PricingEntry[];
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as { entries?: unknown }).entries)) {
    return (parsed as { entries: PricingEntry[] }).entries;
  }
  throw new Error(`invalid pricing overrides in ${path}: expected an array or {entries: []}`);
}

export function loadPricingTable(): PricingTable {
  return mergePricing(DEFAULT_PRICING, loadUserPricing());
}
