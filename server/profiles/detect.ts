import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveConfigDir, type CcProfile } from "./registry";

export interface ProfileDetection {
  loggedIn: boolean;
  email?: string;
  displayName?: string;
  orgName?: string;
  /** claude_pro / claude_max / … — the plan behind the subscription. */
  orgType?: string;
  orgRole?: string;
  billingType?: string;
  /** ISO timestamps, straight from the account record. */
  subscriptionCreatedAt?: string;
  accountCreatedAt?: string;
  trialEndsAt?: string | null;
  extraUsageEnabled?: boolean;
  rateLimitTier?: string;
}

/**
 * Where a profile's account file lives.
 *
 * Claude Code keeps the default profile's config *beside* the data directory
 * (~/.claude.json next to ~/.claude/), and only puts it inside when
 * CLAUDE_CONFIG_DIR points somewhere. Reading <claudeDir>/.claude.json for the
 * default profile picks up whatever stale copy happens to be there — on this
 * machine, an old login with a different address.
 */
export function accountFilePath(profile: CcProfile): string {
  if (profile.configDir) return join(profile.configDir, ".claude.json");
  const dir = resolveConfigDir(profile);
  return `${dir.replace(/\/+$/, "")}.json`;
}

/** Payload claims of a JWT, decoded locally — nothing leaves the process. */
function jwtClaims(token: string): Record<string, unknown> | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * Codex login state, from <CODEX_HOME>/auth.json: an OPENAI_API_KEY or an
 * OAuth token set whose id_token carries email and ChatGPT plan claims.
 */
export function detectCodexProfile(dir: string): ProfileDetection {
  const authPath = join(dir, "auth.json");
  if (!existsSync(authPath)) return { loggedIn: false };
  try {
    const auth = JSON.parse(readFileSync(authPath, "utf8")) as {
      OPENAI_API_KEY?: string | null;
      tokens?: { id_token?: string } | null;
    };
    const idToken = auth.tokens?.id_token;
    if (idToken) {
      const claims = jwtClaims(idToken) ?? {};
      const oai = (claims["https://api.openai.com/auth"] ?? {}) as Record<string, unknown>;
      const plan = typeof oai.chatgpt_plan_type === "string" ? oai.chatgpt_plan_type : undefined;
      return {
        loggedIn: true,
        email: typeof claims.email === "string" ? claims.email : undefined,
        displayName: typeof claims.name === "string" ? claims.name : undefined,
        orgType: plan ? `chatgpt_${plan}` : undefined,
        subscriptionCreatedAt:
          typeof oai.chatgpt_subscription_active_start === "string"
            ? oai.chatgpt_subscription_active_start
            : undefined,
        trialEndsAt: null,
      };
    }
    if (auth.OPENAI_API_KEY) return { loggedIn: true, billingType: "api_key" };
    return { loggedIn: false };
  } catch {
    return { loggedIn: false };
  }
}

/**
 * Read-only login detection. Subscription profiles are logged in when their
 * account file carries an oauthAccount; API profiles when a secret is
 * configured. Never touches the Keychain — which is also why per-period quota
 * is absent here: it is not in any local file, only behind the API.
 */
export function detectProfile(profile: CcProfile): ProfileDetection {
  if (profile.product === "codex") {
    return detectCodexProfile(profile.configDir ?? join(process.env.HOME ?? "", ".codex"));
  }
  if (profile.kind === "api") {
    return { loggedIn: Boolean(profile.api?.secret) };
  }

  const jsonPath = accountFilePath(profile);
  if (!existsSync(jsonPath)) return { loggedIn: false };
  try {
    const parsed = JSON.parse(readFileSync(jsonPath, "utf8")) as {
      oauthAccount?: {
        emailAddress?: string;
        displayName?: string;
        organizationName?: string;
        organizationType?: string;
        organizationRole?: string;
        billingType?: string;
        subscriptionCreatedAt?: string;
        accountCreatedAt?: string;
        claudeCodeTrialEndsAt?: string | null;
        hasExtraUsageEnabled?: boolean;
        organizationRateLimitTier?: string;
        userRateLimitTier?: string | null;
      };
    };
    const account = parsed.oauthAccount;
    if (!account?.emailAddress) return { loggedIn: false };
    return {
      loggedIn: true,
      email: account.emailAddress,
      displayName: account.displayName,
      orgName: account.organizationName,
      orgType: account.organizationType,
      orgRole: account.organizationRole,
      billingType: account.billingType,
      subscriptionCreatedAt: account.subscriptionCreatedAt,
      accountCreatedAt: account.accountCreatedAt,
      trialEndsAt: account.claudeCodeTrialEndsAt ?? null,
      extraUsageEnabled: account.hasExtraUsageEnabled,
      rateLimitTier: account.userRateLimitTier ?? account.organizationRateLimitTier,
    };
  } catch {
    return { loggedIn: false };
  }
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * The command a user runs in their own terminal to log this profile in. The
 * default profile must NOT carry CLAUDE_CONFIG_DIR — see configEnv in tmux.ts:
 * pointing it at ~/.claude selects a different config file entirely.
 */
export function loginCommand(profile: CcProfile): string {
  if (profile.product === "codex") {
    const env = profile.configDir ? `CODEX_HOME=${shellQuote(profile.configDir)} ` : "";
    return `${env}codex login`;
  }
  const env = profile.configDir ? `CLAUDE_CONFIG_DIR=${shellQuote(profile.configDir)} ` : "";
  return `${env}claude /login`;
}

/** Resume command for a session belonging to this profile (always its own dir). */
export function resumeCommand(profile: CcProfile, cwd: string, sessionId: string): string {
  const env = profile.configDir ? `CLAUDE_CONFIG_DIR=${shellQuote(profile.configDir)} ` : "";
  return `cd ${shellQuote(cwd)} && ${env}claude --resume ${shellQuote(sessionId)}`;
}
