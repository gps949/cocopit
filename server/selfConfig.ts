import { writeFileSync } from "node:fs";
import type { CcockpitConfig } from "../shared/types";
import { resolveBindHost } from "./bindHost";
import { configPath, loadConfig } from "./config";

/** The subset of ccockpit's own config the UI may change. */
export type SelfConfigPatch = Partial<Pick<CcockpitConfig, "port" | "host" | "allowedOrigins">>;

const EDITABLE = new Set<keyof CcockpitConfig>(["port", "host", "allowedOrigins"]);

function validateOrigins(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new Error("允许来源必须是字符串列表");
  }
  return value.map((raw) => {
    const origin = raw.trim();
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`不是合法的来源：${origin}（形如 https://cc.example.com）`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`来源必须是 http 或 https：${origin}`);
    }
    return parsed.origin; // normalized: no path, no trailing slash
  });
}

/**
 * Updates ~/.ccockpit/config.json. Unlike Claude Code's own files this one is
 * ours, so it needs no backup or CAS — but it does carry the bind-address
 * interlock, which must hold here too: refusing a public bind only at startup
 * would let the UI write a config that then fails to boot.
 */
export function updateSelfConfig(patch: SelfConfigPatch, tokenConfigured: boolean): CcockpitConfig {
  for (const key of Object.keys(patch)) {
    if (!EDITABLE.has(key as keyof CcockpitConfig)) {
      throw new Error(`${key} 不可修改（仅支持 port、host、allowedOrigins）`);
    }
  }

  const current = loadConfig();
  const next: CcockpitConfig = { ...current };

  if (patch.port !== undefined) {
    if (!Number.isInteger(patch.port) || patch.port < 1 || patch.port > 65535) {
      throw new Error(`端口必须是 1–65535 的整数：${patch.port}`);
    }
    next.port = patch.port;
  }

  if (patch.host !== undefined) {
    next.host = resolveBindHost(patch.host, tokenConfigured);
  }

  if (patch.allowedOrigins !== undefined) {
    next.allowedOrigins = validateOrigins(patch.allowedOrigins);
  }

  writeFileSync(configPath(), JSON.stringify(next, null, 2) + "\n");
  return next;
}
