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

  const skillsDir = join(configDir, "skills");
  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (existsSync(join(skillsDir, entry.name, "SKILL.md"))) report.skills.push({ name: entry.name });
    }
  }

  return report;
}
