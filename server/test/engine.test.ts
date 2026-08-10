import { describe, expect, test } from "bun:test";
import {
  DEFAULT_PRICING,
  mergePricing,
  priceEvent,
  resolveEntry,
  type PriceableEvent,
  type PricingTable,
} from "../cost/engine";

function ev(overrides: Partial<PriceableEvent>): PriceableEvent {
  return {
    model: "claude-opus-4-8",
    contextTier: "default",
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheW5m: 0,
    cacheW1h: 0,
    webSearch: 0,
    ...overrides,
  };
}

describe("resolveEntry", () => {
  test("longest prefix wins", () => {
    // claude-opus-4-8 must match its own entry, not a shorter opus prefix
    expect(resolveEntry(DEFAULT_PRICING, "claude-opus-4-8")?.match).toBe("claude-opus-4-8");
    // dated haiku ID resolves through the alias prefix
    expect(resolveEntry(DEFAULT_PRICING, "claude-haiku-4-5-20251001")?.match).toBe("claude-haiku-4-5");
    expect(resolveEntry(DEFAULT_PRICING, "claude-sonnet-4-5-20250929")?.match).toBe("claude-sonnet-4-5");
  });

  test("unknown / third-party models resolve to null", () => {
    expect(resolveEntry(DEFAULT_PRICING, "hf:moonshotai/Kimi-K2.5")).toBeNull();
    expect(resolveEntry(DEFAULT_PRICING, "deepseek-v4-flash")).toBeNull();
    expect(resolveEntry(DEFAULT_PRICING, "")).toBeNull();
  });

  test("default table covers every locally observed Anthropic model", () => {
    for (const model of [
      "claude-fable-5",
      "claude-opus-5",
      "claude-opus-4-8",
      "claude-opus-4-7",
      "claude-opus-4-6",
      "claude-sonnet-5",
      "claude-sonnet-4-6",
      "claude-sonnet-4-5-20250929",
      "claude-haiku-4-5-20251001",
    ]) {
      expect(resolveEntry(DEFAULT_PRICING, model)).not.toBeNull();
    }
  });
});

describe("priceEvent", () => {
  test("five-way weighted sum at official opus rates", () => {
    // opus 4.8: in $5, out $25, read $0.50, w5m $6.25, w1h $10 per MTok
    const cost = priceEvent(
      DEFAULT_PRICING,
      ev({ input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheW5m: 1_000_000, cacheW1h: 1_000_000 }),
    );
    expect(cost).toBeCloseTo(5 + 25 + 0.5 + 6.25 + 10, 10);
  });

  test("fable 5 rates", () => {
    const cost = priceEvent(DEFAULT_PRICING, ev({ model: "claude-fable-5", input: 2_000_000, output: 100_000 }));
    expect(cost).toBeCloseTo(2 * 10 + 0.1 * 50, 10);
  });

  test("web search billed per request", () => {
    const cost = priceEvent(DEFAULT_PRICING, ev({ webSearch: 3 }));
    expect(cost).toBeCloseTo(3 * (10 / 1000), 10); // $10 per 1k searches
  });

  test("long tier falls back to default when absent (4.6+ has no long-context premium)", () => {
    const base = priceEvent(DEFAULT_PRICING, ev({ input: 1_000_000 }));
    const long = priceEvent(DEFAULT_PRICING, ev({ input: 1_000_000, contextTier: "long" }));
    expect(long).toBe(base);
  });

  test("sonnet 4.5 long-context tier charges the 1M-beta premium", () => {
    const short = priceEvent(DEFAULT_PRICING, ev({ model: "claude-sonnet-4-5-20250929", input: 1_000_000 }));
    const long = priceEvent(
      DEFAULT_PRICING,
      ev({ model: "claude-sonnet-4-5-20250929", input: 1_000_000, contextTier: "long" }),
    );
    expect(short).toBeCloseTo(3, 10);
    expect(long).toBeCloseTo(6, 10);
  });

  test("unpriced model returns null", () => {
    expect(priceEvent(DEFAULT_PRICING, ev({ model: "deepseek-v4-flash", input: 500 }))).toBeNull();
  });

  test("zero usage prices to zero, not null", () => {
    expect(priceEvent(DEFAULT_PRICING, ev({}))).toBe(0);
  });
});

describe("mergePricing", () => {
  test("user override replaces a whole entry by match key and adds new entries", () => {
    const overrides = [
      {
        match: "claude-opus-4-8",
        tiers: { default: { input: 1, output: 2, cacheRead: 0.1, cacheWrite5m: 1.25, cacheWrite1h: 2 } },
      },
      {
        match: "deepseek-v4-flash",
        tiers: { default: { input: 0.28, output: 0.42, cacheRead: 0.028, cacheWrite5m: 0.35, cacheWrite1h: 0.56 } },
      },
    ];
    const merged: PricingTable = mergePricing(DEFAULT_PRICING, overrides);

    const opus = priceEvent(merged, ev({ input: 1_000_000 }));
    expect(opus).toBeCloseTo(1, 10);

    const ds = priceEvent(merged, ev({ model: "deepseek-v4-flash", output: 1_000_000 }));
    expect(ds).toBeCloseTo(0.42, 10);

    // untouched entries survive
    expect(priceEvent(merged, ev({ model: "claude-haiku-4-5", input: 1_000_000 }))).toBeCloseTo(1, 10);
    // base table is not mutated
    expect(priceEvent(DEFAULT_PRICING, ev({ input: 1_000_000 }))).toBeCloseTo(5, 10);
  });
});
