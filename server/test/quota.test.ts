import { afterEach, describe, expect, test } from "bun:test";
import {
  clearQuotaCache,
  fetchProfileQuota,
  keychainService,
  normalizeUsage,
  parseCredentialPayload,
  USAGE_URL,
  type OAuthCredentials,
} from "../profiles/quota";
import type { CcProfile } from "../profiles/registry";

afterEach(() => clearQuotaCache());

const SUB: CcProfile = { id: "p1", name: "P1", kind: "subscription", configDir: "/tmp/p1" };

const REAL_SHAPE = {
  five_hour: { utilization: 100.0, resets_at: "2026-08-12T09:40:00.018047+00:00", limit_dollars: null },
  seven_day: { utilization: 70.0, resets_at: "2026-08-13T06:00:01.018072+00:00" },
  seven_day_opus: null,
  seven_day_sonnet: { utilization: 1.0, resets_at: "2026-08-16T03:00:00+00:00" },
  extra_usage: { is_enabled: false, monthly_limit: null, used_credits: null, utilization: null },
  limits: [{ kind: "session", percent: 100 }],
};

describe("keychainService", () => {
  test("default profile uses the unsuffixed entry", () => {
    expect(keychainService(null)).toBe("Claude Code-credentials");
  });

  test("suffix is the first 8 hex chars of sha256(configDir)", () => {
    // verified against a real Keychain: ~/.claude → 2a0c7bff
    expect(keychainService("/Users/chenyanggao/.claude")).toBe("Claude Code-credentials-2a0c7bff");
  });
});

describe("parseCredentialPayload", () => {
  test("extracts token and expiry", () => {
    const creds = parseCredentialPayload(
      JSON.stringify({ claudeAiOauth: { accessToken: "sk-ant-oat-x", expiresAt: 123 } }),
    );
    expect(creds).toEqual({ accessToken: "sk-ant-oat-x", expiresAt: 123 });
  });

  test("rejects malformed or tokenless payloads", () => {
    expect(parseCredentialPayload("not json")).toBeNull();
    expect(parseCredentialPayload(JSON.stringify({ claudeAiOauth: {} }))).toBeNull();
  });
});

describe("normalizeUsage", () => {
  test("keeps the four windows and extra usage from the real response shape", () => {
    const quota = normalizeUsage(REAL_SHAPE);
    expect(quota.fiveHour).toEqual({ utilization: 100, resetsAt: "2026-08-12T09:40:00.018047+00:00" });
    expect(quota.sevenDay?.utilization).toBe(70);
    expect(quota.sevenDayOpus).toBeNull();
    expect(quota.sevenDaySonnet?.utilization).toBe(1);
    expect(quota.extraUsage).toEqual({ enabled: false, utilization: null });
  });

  test("tolerates an empty object", () => {
    const quota = normalizeUsage({});
    expect(quota.fiveHour).toBeNull();
    expect(quota.extraUsage).toBeNull();
  });
});

describe("fetchProfileQuota", () => {
  const creds = (): OAuthCredentials => ({ accessToken: "sk-ant-oat-x", expiresAt: 0 });

  test("api profiles are unsupported", async () => {
    const result = await fetchProfileQuota({ ...SUB, kind: "api" });
    expect(result.status).toBe("unsupported");
  });

  test("missing credentials reported as such, no fetch attempted", async () => {
    const result = await fetchProfileQuota(SUB, {
      credentials: () => null,
      fetchImpl: () => {
        throw new Error("must not fetch");
      },
    });
    expect(result.status).toBe("no_credentials");
  });

  test("expired token short-circuits — refreshing is Claude Code's job", async () => {
    const result = await fetchProfileQuota(SUB, {
      credentials: () => ({ accessToken: "x", expiresAt: 1 }),
      now: () => 1000,
      fetchImpl: () => {
        throw new Error("must not fetch");
      },
    });
    expect(result.status).toBe("token_expired");
  });

  test("sends the three required headers and returns normalized quota", async () => {
    let seen: Record<string, string> = {};
    const result = await fetchProfileQuota(SUB, {
      credentials: creds,
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe(USAGE_URL);
        seen = Object.fromEntries(Object.entries(init?.headers ?? {}));
        return new Response(JSON.stringify(REAL_SHAPE), { status: 200 });
      }),
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.quota.fiveHour?.utilization).toBe(100);
    expect(seen.authorization).toBe("Bearer sk-ant-oat-x");
    expect(seen["anthropic-beta"]).toBe("oauth-2025-04-20");
    expect(seen["user-agent"]).toMatch(/^claude-code\/\d+\.\d+\.\d+$/);
  });

  test("second call within the TTL is served from cache", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return new Response(JSON.stringify(REAL_SHAPE), { status: 200 });
    };
    await fetchProfileQuota(SUB, { credentials: creds, fetchImpl });
    await fetchProfileQuota(SUB, { credentials: creds, fetchImpl });
    expect(calls).toBe(1);
  });

  test("429 serves the stale snapshot when one exists", async () => {
    let now = 0;
    const deps = {
      credentials: creds,
      now: () => now,
      fetchImpl: (async () =>
        now === 0
          ? new Response(JSON.stringify(REAL_SHAPE), { status: 200 })
          : new Response("{}", { status: 429 })),
    };
    await fetchProfileQuota(SUB, deps);
    now = 10 * 60_000; // past the TTL, upstream now rate-limits
    const result = await fetchProfileQuota(SUB, deps);
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.stale).toBe(true);
  });

  test("429 with no cache is reported as rate_limited", async () => {
    const result = await fetchProfileQuota(SUB, {
      credentials: creds,
      fetchImpl: (async () => new Response("{}", { status: 429 })),
    });
    expect(result.status).toBe("rate_limited");
  });

  test("token never leaks into the result", async () => {
    const result = await fetchProfileQuota(SUB, {
      credentials: creds,
      fetchImpl: (async () => new Response(JSON.stringify(REAL_SHAPE), { status: 200 })),
    });
    expect(JSON.stringify(result)).not.toContain("sk-ant-oat");
  });
});
