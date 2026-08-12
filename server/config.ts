import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CocopitConfig } from "../shared/types";
import { migrateLegacyHome } from "./homeMigration";

const DEFAULTS: CocopitConfig = {
  port: 7433,
  host: "127.0.0.1",
  claudeDir: join(homedir(), ".claude"),
  codexDir: join(homedir(), ".codex"),
  allowedOrigins: [],
};

export function resolveCocopitHome(): string {
  const home = process.env.COCOPIT_HOME || join(homedir(), ".cocopit");
  // the tool was called ccockpit until the rename; carry that directory across
  // rather than presenting as a fresh install beside the old data
  if (!process.env.COCOPIT_HOME) migrateLegacyHome(join(homedir(), ".ccockpit"), home);
  mkdirSync(home, { recursive: true, mode: 0o700 });
  return home;
}

export function configPath(): string {
  return join(resolveCocopitHome(), "config.json");
}

export function dbPath(): string {
  return join(resolveCocopitHome(), "index.db");
}

/**
 * Loads ~/.cocopit/config.json, creating it with defaults when absent.
 * Unknown fields are preserved; missing known fields are filled from
 * defaults and written back. A malformed file throws instead of being
 * silently overwritten.
 */
export function loadConfig(): CocopitConfig {
  const path = configPath();
  if (!existsSync(path)) {
    writeFileSync(path, JSON.stringify(DEFAULTS, null, 2) + "\n");
    return { ...DEFAULTS };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`invalid JSON in ${path}: ${(err as Error).message}`);
  }

  const merged = { ...DEFAULTS, ...parsed } as CocopitConfig & Record<string, unknown>;
  const missingKey = Object.keys(DEFAULTS).some((key) => !(key in parsed));
  if (missingKey) {
    writeFileSync(path, JSON.stringify(merged, null, 2) + "\n");
  }
  return merged;
}
