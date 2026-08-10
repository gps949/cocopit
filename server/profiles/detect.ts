import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveConfigDir, type CcProfile } from "./registry";

export interface ProfileDetection {
  loggedIn: boolean;
  email?: string;
  orgName?: string;
  billingType?: string;
}

/**
 * Read-only login detection. Subscription profiles are logged in when their
 * <configDir>/.claude.json carries an oauthAccount; API profiles when a secret
 * is configured. Never touches the Keychain.
 */
export function detectProfile(profile: CcProfile): ProfileDetection {
  if (profile.kind === "api") {
    return { loggedIn: Boolean(profile.api?.secret) };
  }

  const jsonPath = join(resolveConfigDir(profile), ".claude.json");
  if (!existsSync(jsonPath)) return { loggedIn: false };
  try {
    const parsed = JSON.parse(readFileSync(jsonPath, "utf8")) as {
      oauthAccount?: { emailAddress?: string; organizationName?: string; billingType?: string };
    };
    const account = parsed.oauthAccount;
    if (!account?.emailAddress) return { loggedIn: false };
    return {
      loggedIn: true,
      email: account.emailAddress,
      orgName: account.organizationName,
      billingType: account.billingType,
    };
  } catch {
    return { loggedIn: false };
  }
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** The command a user runs in their own terminal to log this profile in. */
export function loginCommand(profile: CcProfile): string {
  return `CLAUDE_CONFIG_DIR=${shellQuote(resolveConfigDir(profile))} claude /login`;
}

/** Resume command for a session belonging to this profile (always its own dir). */
export function resumeCommand(profile: CcProfile, cwd: string, sessionId: string): string {
  const env = `CLAUDE_CONFIG_DIR=${shellQuote(resolveConfigDir(profile))}`;
  return `cd ${shellQuote(cwd)} && ${env} claude --resume ${shellQuote(sessionId)}`;
}
