import { chmodSync, existsSync, mkdirSync, renameSync, writeFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig, resolveCcockpitHome } from "../config";

export interface CcProfileApi {
  baseUrl?: string;
  model?: string;
  smallFastModel?: string;
  authKind: "api_key" | "auth_token";
  secret: string;
}

export interface CcProfile {
  id: string;
  name: string;
  color?: string;
  kind: "subscription" | "api";
  /** null only for the default profile (uses config.claudeDir, i.e. ~/.claude). */
  configDir: string | null;
  api?: CcProfileApi;
  extraEnv?: Record<string, string>;
  lastDetected?: { email?: string; orgName?: string; at: number };
}

const DEFAULT_PROFILE: CcProfile = {
  id: "default",
  name: "默认账号",
  kind: "subscription",
  configDir: null,
};

export function profilesPath(): string {
  return join(resolveCcockpitHome(), "profiles.json");
}

/** Base directory holding per-profile CLAUDE_CONFIG_DIRs. */
export function profilesBaseDir(): string {
  return process.env.CCOCKPIT_PROFILES_BASE || join(homedir(), ".claude-profiles");
}

export function loadProfiles(): CcProfile[] {
  const path = profilesPath();
  if (!existsSync(path)) {
    saveProfiles([DEFAULT_PROFILE]);
    return [{ ...DEFAULT_PROFILE }];
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { profiles: CcProfile[] };
  const profiles = parsed.profiles ?? [];
  if (!profiles.some((p) => p.id === "default")) {
    profiles.unshift({ ...DEFAULT_PROFILE });
  }
  return profiles;
}

/** Atomic write (temp + rename), kept at 0600 — profiles may hold API secrets. */
export function saveProfiles(profiles: CcProfile[]): void {
  const path = profilesPath();
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify({ profiles }, null, 2) + "\n", { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "profile";
}

export interface CreateProfileInput {
  name: string;
  kind: "subscription" | "api";
  color?: string;
  api?: CcProfileApi;
  extraEnv?: Record<string, string>;
}

export function createProfile(input: CreateProfileInput): CcProfile {
  const profiles = loadProfiles();
  const base = slugify(input.name);
  let id = base;
  for (let n = 2; profiles.some((p) => p.id === id); n++) id = `${base}-${n}`;

  const configDir = join(profilesBaseDir(), id);
  mkdirSync(configDir, { recursive: true, mode: 0o700 });

  const profile: CcProfile = {
    id,
    name: input.name,
    kind: input.kind,
    configDir,
    ...(input.color ? { color: input.color } : {}),
    ...(input.api ? { api: input.api } : {}),
    ...(input.extraEnv ? { extraEnv: input.extraEnv } : {}),
  };
  profiles.push(profile);
  saveProfiles(profiles);
  return profile;
}

export function updateProfile(id: string, patch: Partial<Omit<CcProfile, "id">>): CcProfile {
  const profiles = loadProfiles();
  const profile = profiles.find((p) => p.id === id);
  if (!profile) throw new Error(`profile not found: ${id}`);
  Object.assign(profile, patch, { id: profile.id });
  saveProfiles(profiles);
  return profile;
}

/** Removes the registry entry; the config dir (login/session data) is kept. */
export function deleteProfile(id: string): void {
  if (id === "default") throw new Error("the default profile cannot be deleted");
  const profiles = loadProfiles();
  const index = profiles.findIndex((p) => p.id === id);
  if (index < 0) throw new Error(`profile not found: ${id}`);
  profiles.splice(index, 1);
  saveProfiles(profiles);
}

export function resolveConfigDir(profile: CcProfile): string {
  return profile.configDir ?? loadConfig().claudeDir;
}
