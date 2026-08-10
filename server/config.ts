import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CcockpitConfig } from "../shared/types";

const DEFAULTS: CcockpitConfig = {
  port: 7433,
  claudeDir: join(homedir(), ".claude"),
};

export function resolveCcockpitHome(): string {
  const home = process.env.CCOCKPIT_HOME || join(homedir(), ".ccockpit");
  mkdirSync(home, { recursive: true, mode: 0o700 });
  return home;
}

export function configPath(): string {
  return join(resolveCcockpitHome(), "config.json");
}

export function dbPath(): string {
  return join(resolveCcockpitHome(), "index.db");
}

/**
 * Loads ~/.ccockpit/config.json, creating it with defaults when absent.
 * Unknown fields are preserved; missing known fields are filled from
 * defaults and written back. A malformed file throws instead of being
 * silently overwritten.
 */
export function loadConfig(): CcockpitConfig {
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

  const merged = { ...DEFAULTS, ...parsed } as CcockpitConfig & Record<string, unknown>;
  const missingKey = Object.keys(DEFAULTS).some((key) => !(key in parsed));
  if (missingKey) {
    writeFileSync(path, JSON.stringify(merged, null, 2) + "\n");
  }
  return merged;
}
