import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface McpServerInfo {
  name: string;
  /** the project path it is configured under */
  scope: string;
  transport: string;
  detail: string;
}

export interface PluginInfo {
  name: string;
  version: string | null;
  enabled: boolean;
}

export interface ExtensionsReport {
  mcpServers: McpServerInfo[];
  plugins: PluginInfo[];
  skills: Array<{ name: string }>;
}

function readJson(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    // a broken file is one missing section, not a broken page
    return null;
  }
}

/**
 * What is extending Claude Code, read-only.
 *
 * The three live in different places, and the difference matters when you are
 * looking for why something is or is not available:
 *   - MCP servers are configured *per project*, inside ~/.claude.json
 *   - plugins are installed under the config dir but enabled in settings.json
 *   - skills are directories under the config dir carrying a SKILL.md
 *
 * Everything is per config directory, so a profile with its own directory has
 * its own set of all three.
 */
export function readExtensions(configDir: string, claudeJsonPath: string): ExtensionsReport {
  const report: ExtensionsReport = { mcpServers: [], plugins: [], skills: [] };

  const claudeJson = readJson(claudeJsonPath);
  const projects = (claudeJson?.projects ?? {}) as Record<string, { mcpServers?: Record<string, unknown> }>;
  const scopes: Array<[string, Record<string, unknown>]> = [];
  if (claudeJson?.mcpServers) scopes.push(["(全局)", claudeJson.mcpServers as Record<string, unknown>]);
  for (const [path, config] of Object.entries(projects)) {
    if (config?.mcpServers && Object.keys(config.mcpServers).length > 0) scopes.push([path, config.mcpServers]);
  }
  for (const [scope, servers] of scopes) {
    for (const [name, raw] of Object.entries(servers)) {
      const server = (raw ?? {}) as { type?: string; url?: string; command?: string; args?: string[] };
      const transport = server.type ?? (server.command ? "stdio" : "unknown");
      const detail = server.url ?? [server.command, ...(server.args ?? [])].filter(Boolean).join(" ");
      report.mcpServers.push({ name, scope, transport, detail });
    }
  }

  const installed = readJson(join(configDir, "plugins", "installed_plugins.json"));
  const settings = readJson(join(configDir, "settings.json"));
  const enabled = (settings?.enabledPlugins ?? {}) as Record<string, boolean>;
  const plugins = (installed?.plugins ?? {}) as Record<string, Array<{ version?: string }>>;
  for (const [name, entries] of Object.entries(plugins)) {
    report.plugins.push({
      name,
      version: entries?.[0]?.version ?? null,
      enabled: enabled[name] === true,
    });
  }

  collectSkills(join(configDir, "skills"), report);
  return report;
}

function collectSkills(skillsDir: string, report: ExtensionsReport): void {
  if (!existsSync(skillsDir)) return;
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    if (existsSync(join(skillsDir, entry.name, "SKILL.md"))) report.skills.push({ name: entry.name });
  }
}

/**
 * What is extending Codex, read-only, from a CODEX_HOME. Same three families,
 * different homes: MCP servers and plugin enablement live in config.toml
 * (machine-wide, not per project like Claude's), skills are SKILL.md
 * directories just like Claude's. MCP env tables are deliberately not
 * surfaced — they carry API keys.
 */
export function readCodexExtensions(codexHome: string): ExtensionsReport {
  const report: ExtensionsReport = { mcpServers: [], plugins: [], skills: [] };

  const configPath = join(codexHome, "config.toml");
  if (existsSync(configPath)) {
    let config: Record<string, unknown> = {};
    try {
      config = Bun.TOML.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    } catch {
      // a broken file is one missing section, not a broken page
    }
    const servers = (config.mcp_servers ?? {}) as Record<
      string,
      { type?: string; url?: string; command?: string; args?: string[] }
    >;
    for (const [name, server] of Object.entries(servers)) {
      if (!server || typeof server !== "object") continue;
      const transport = server.type ?? (server.command ? "stdio" : "unknown");
      const detail = server.url ?? [server.command, ...(server.args ?? [])].filter(Boolean).join(" ");
      report.mcpServers.push({ name, scope: "config.toml", transport, detail });
    }
    const plugins = (config.plugins ?? {}) as Record<string, { enabled?: boolean }>;
    for (const [name, plugin] of Object.entries(plugins)) {
      report.plugins.push({ name, version: null, enabled: plugin?.enabled === true });
    }
  }

  collectSkills(join(codexHome, "skills"), report);
  return report;
}
