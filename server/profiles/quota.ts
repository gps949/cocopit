import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveConfigDir, type CcProfile } from "./registry";

/**
 * Subscription quota (the numbers behind Claude Code's /usage panel), read
 * from api.anthropic.com/api/oauth/usage with the profile's own OAuth token.
 *
 * Security shape, deliberately narrow: the token lives in process memory for
 * the duration of one HTTPS call, is never logged, never persisted, and never
 * appears in a response — the route built on this returns percentages and
 * reset times only. This is the trade the user approved for seeing quota
 * without opening a terminal.
 */

export interface QuotaWindow {
  /** 0–100, already a percentage. */
  utilization: number;
  /** ISO 8601, null when the window has no active reset scheduled. */
  resetsAt: string | null;
}

export interface QuotaSnapshot {
  fiveHour: QuotaWindow | null;
  sevenDay: QuotaWindow | null;
  sevenDayOpus: QuotaWindow | null;
  sevenDaySonnet: QuotaWindow | null;
  extraUsage: { enabled: boolean; utilization: number | null } | null;
}

export type QuotaResult =
  | { status: "ok"; quota: QuotaSnapshot; fetchedAt: number; stale?: boolean }
  | {
      status: "unsupported" | "no_credentials" | "token_expired" | "rate_limited" | "error";
      message?: string;
    };

/**
 * Claude Code's Keychain entry: "Claude Code-credentials" when
 * CLAUDE_CONFIG_DIR is unset, otherwise suffixed with the first 8 hex chars of
 * sha256(configDir) — verified against this machine's entries (~/.claude →
 * 2a0c7bff).
 */
export function keychainService(configDir: string | null): string {
  if (!configDir) return "Claude Code-credentials";
  const suffix = createHash("sha256").update(configDir).digest("hex").slice(0, 8);
  return `Claude Code-credentials-${suffix}`;
}

export interface OAuthCredentials {
  accessToken: string;
  /** epoch ms; 0 when the payload carries none. */
  expiresAt: number;
}

/** Pure part of credential reading, shared by Keychain and file sources. */
export function parseCredentialPayload(payload: string): OAuthCredentials | null {
  try {
    const parsed = JSON.parse(payload) as {
      claudeAiOauth?: { accessToken?: string; expiresAt?: number };
    };
    const oauth = parsed.claudeAiOauth;
    if (!oauth?.accessToken) return null;
    return { accessToken: oauth.accessToken, expiresAt: oauth.expiresAt ?? 0 };
  } catch {
    return null;
  }
}

/**
 * macOS: the login Keychain. Elsewhere Claude Code writes
 * <configDir>/.credentials.json, which is also the fallback here.
 */
export function readCredentials(profile: CcProfile): OAuthCredentials | null {
  if (process.platform === "darwin") {
    const result = spawnSync(
      "security",
      ["find-generic-password", "-s", keychainService(profile.configDir), "-w"],
      { encoding: "utf8" },
    );
    if (result.status === 0 && result.stdout) {
      const creds = parseCredentialPayload(result.stdout.trim());
      if (creds) return creds;
    }
  }
  const filePath = join(resolveConfigDir(profile), ".credentials.json");
  if (!existsSync(filePath)) return null;
  try {
    return parseCredentialPayload(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

interface RawWindow {
  utilization?: number | null;
  resets_at?: string | null;
}

function window(raw: RawWindow | null | undefined): QuotaWindow | null {
  if (!raw || typeof raw.utilization !== "number") return null;
  return { utilization: raw.utilization, resetsAt: raw.resets_at ?? null };
}

/** Normalizes the upstream response down to what the UI shows. */
export function normalizeUsage(raw: unknown): QuotaSnapshot {
  const data = (raw ?? {}) as {
    five_hour?: RawWindow | null;
    seven_day?: RawWindow | null;
    seven_day_opus?: RawWindow | null;
    seven_day_sonnet?: RawWindow | null;
    extra_usage?: { is_enabled?: boolean; utilization?: number | null } | null;
  };
  return {
    fiveHour: window(data.five_hour),
    sevenDay: window(data.seven_day),
    sevenDayOpus: window(data.seven_day_opus),
    sevenDaySonnet: window(data.seven_day_sonnet),
    extraUsage: data.extra_usage
      ? {
          enabled: data.extra_usage.is_enabled === true,
          utilization: data.extra_usage.utilization ?? null,
        }
      : null,
  };
}

/**
 * The endpoint rejects unrecognized User-Agents with persistent 429s, so the
 * installed CLI's version string is the correct thing to present. Resolved
 * once per process; the fallback matches a version known to be accepted.
 */
let cachedUserAgent: string | null = null;
export function usageUserAgent(): string {
  if (cachedUserAgent) return cachedUserAgent;
  const result = spawnSync("claude", ["--version"], { encoding: "utf8" });
  const version = /(\d+\.\d+\.\d+)/.exec(result.stdout ?? "")?.[1];
  cachedUserAgent = `claude-code/${version ?? "2.1.228"}`;
  return cachedUserAgent;
}

export const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

/** Rate limiting is per token and unforgiving — cache, and serve stale on 429. */
const CACHE_TTL_MS = 120_000;
const cache = new Map<string, { at: number; result: QuotaResult }>();

export interface QuotaDeps {
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  credentials?: (profile: CcProfile) => OAuthCredentials | null;
  now?: () => number;
}

export async function fetchProfileQuota(profile: CcProfile, deps: QuotaDeps = {}): Promise<QuotaResult> {
  // Codex quota comes from its transcripts (see /api/codex/quota), not from
  // Anthropic's endpoint — falling through would read the wrong credentials
  if (profile.kind !== "subscription" || profile.product === "codex") return { status: "unsupported" };

  const now = deps.now ?? Date.now;
  const cached = cache.get(profile.id);
  if (cached && now() - cached.at < CACHE_TTL_MS) return cached.result;

  const creds = (deps.credentials ?? readCredentials)(profile);
  if (!creds) return { status: "no_credentials" };
  if (creds.expiresAt > 0 && creds.expiresAt < now()) {
    // Refreshing ourselves would consume the one-time refresh token behind
    // Claude Code's back; running any claude command refreshes it properly.
    return { status: "token_expired" };
  }

  let response: Response;
  try {
    response = await (deps.fetchImpl ?? fetch)(USAGE_URL, {
      headers: {
        authorization: `Bearer ${creds.accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
        "user-agent": usageUserAgent(),
      },
    });
  } catch (err) {
    if (cached) return { ...cached.result, stale: true } as QuotaResult;
    return { status: "error", message: (err as Error).message };
  }

  if (response.status === 429) {
    if (cached?.result.status === "ok") return { ...cached.result, stale: true };
    return { status: "rate_limited" };
  }
  if (!response.ok) {
    return { status: "error", message: `upstream ${response.status}` };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { status: "error", message: "invalid upstream response" };
  }
  const result: QuotaResult = { status: "ok", quota: normalizeUsage(body), fetchedAt: now() };
  cache.set(profile.id, { at: now(), result });
  return result;
}

/** Test hook: quota results are per-process state. */
export function clearQuotaCache(): void {
  cache.clear();
}
