import { describe, expect, test } from "bun:test";
import { DEFAULT_PRICING, mergePricing } from "../cost/engine";
import { diffAgainstLiteLLM, toPricingTier, type LiteLLMEntry } from "../cost/litellm";

const OPUS: LiteLLMEntry = {
  input_cost_per_token: 5e-6,
  output_cost_per_token: 2.5e-5,
  cache_read_input_token_cost: 5e-7,
  cache_creation_input_token_cost: 6.25e-6,
  cache_creation_input_token_cost_above_1hr: 1e-5,
};

describe("toPricingTier", () => {
  test("per-token costs become per-million-token rates", () => {
    expect(toPricingTier(OPUS)).toEqual({
      input: 5,
      output: 25,
      cacheRead: 0.5,
      cacheWrite5m: 6.25,
      cacheWrite1h: 10,
    });
  });

  test("a missing 1h rate falls back to twice the base input, matching the published multiplier", () => {
    const tier = toPricingTier({ ...OPUS, cache_creation_input_token_cost_above_1hr: undefined });
    expect(tier!.cacheWrite1h).toBe(10);
  });

  test("an entry without token costs is unusable", () => {
    expect(toPricingTier({ output_cost_per_token: 1e-5 })).toBeNull();
    expect(toPricingTier({})).toBeNull();
  });
});

describe("diffAgainstLiteLLM", () => {
  test("identical rates are reported as matching", () => {
    const rows = diffAgainstLiteLLM(DEFAULT_PRICING, { "claude-opus-4-8": OPUS });
    const row = rows.find((r) => r.model === "claude-opus-4-8")!;
    expect(row.differs).toBe(false);
    expect(row.theirs!.input).toBe(5);
    expect(row.ours!.input).toBe(5);
  });

  test("a differing rate is flagged with the changed fields", () => {
    const rows = diffAgainstLiteLLM(DEFAULT_PRICING, {
      "claude-opus-4-8": { ...OPUS, input_cost_per_token: 7e-6 },
    });
    const row = rows.find((r) => r.model === "claude-opus-4-8")!;
    expect(row.differs).toBe(true);
    expect(row.changed).toContain("input");
    expect(row.changed).not.toContain("output");
  });

  test("a model you actually used but do not price is surfaced as new", () => {
    // the local data has deepseek and Kimi usage with no price attached
    const rows = diffAgainstLiteLLM(DEFAULT_PRICING, { "deepseek-v4-flash": OPUS }, ["deepseek-v4-flash"]);
    const row = rows.find((r) => r.model === "deepseek-v4-flash")!;
    expect(row.ours).toBeNull();
    expect(row.differs).toBe(true);
  });

  test("the other ~3000 catalog entries are noise and stay out", () => {
    const rows = diffAgainstLiteLLM(DEFAULT_PRICING, { "gpt-4o": OPUS, "claude-opus-4-8": OPUS }, []);
    expect(rows.some((r) => r.model === "gpt-4o")).toBe(false);
    expect(rows.some((r) => r.model === "claude-opus-4-8")).toBe(true);
  });

  test("user overrides are what gets compared, not the shipped defaults", () => {
    const overridden = mergePricing(DEFAULT_PRICING, [
      {
        match: "claude-opus-4-8",
        tiers: { default: { input: 7, output: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10 } },
      },
    ]);
    const rows = diffAgainstLiteLLM(overridden, { "claude-opus-4-8": OPUS });
    const row = rows.find((r) => r.model === "claude-opus-4-8")!;
    expect(row.ours!.input).toBe(7);
    expect(row.differs).toBe(true);
  });

  test("rows are ordered with differences first so they are hard to miss", () => {
    const rows = diffAgainstLiteLLM(DEFAULT_PRICING, {
      "claude-opus-4-8": OPUS,
      "claude-haiku-4-5": { ...OPUS, input_cost_per_token: 9e-6 },
    });
    expect(rows[0]!.differs).toBe(true);
  });
});
