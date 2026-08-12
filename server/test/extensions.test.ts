import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readExtensions } from "../cc/extensions";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cocopit-ext-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(relative: string, value: unknown): void {
  const path = join(dir, relative);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
}

describe("readExtensions", () => {
  test("MCP servers are listed per project, which is where they are configured", () => {
    write("claude.json", {
      projects: {
        "/w/a": { mcpServers: { notion: { type: "http", url: "https://mcp.notion.com/mcp" } } },
        "/w/b": {},
      },
    });
    const result = readExtensions(join(dir, "claude"), join(dir, "claude.json"));
    expect(result.mcpServers).toEqual([
      { name: "notion", scope: "/w/a", transport: "http", detail: "https://mcp.notion.com/mcp" },
    ]);
  });

  test("a stdio server shows its command rather than a url", () => {
    write("claude.json", {
      projects: { "/w/a": { mcpServers: { local: { command: "node", args: ["server.js"] } } } },
    });
    const result = readExtensions(join(dir, "claude"), join(dir, "claude.json"));
    expect(result.mcpServers[0]).toMatchObject({ transport: "stdio", detail: "node server.js" });
  });

  test("plugins report whether they are actually enabled", () => {
    write("claude/plugins/installed_plugins.json", {
      version: 2,
      plugins: {
        "a@market": [{ scope: "user", version: "1.0.0" }],
        "b@market": [{ scope: "user", version: "2.0.0" }],
      },
    });
    write("claude/settings.json", { enabledPlugins: { "a@market": true } });
    const result = readExtensions(join(dir, "claude"), join(dir, "claude.json"));
    expect(result.plugins).toEqual([
      { name: "a@market", version: "1.0.0", enabled: true },
      { name: "b@market", version: "2.0.0", enabled: false },
    ]);
  });

  test("skills are the directories that carry a SKILL.md", () => {
    mkdirSync(join(dir, "claude", "skills", "wrangler"), { recursive: true });
    writeFileSync(join(dir, "claude", "skills", "wrangler", "SKILL.md"), "---\nname: wrangler\n---\n");
    mkdirSync(join(dir, "claude", "skills", "not-a-skill"), { recursive: true });
    const result = readExtensions(join(dir, "claude"), join(dir, "claude.json"));
    expect(result.skills).toEqual([{ name: "wrangler" }]);
  });

  test("missing files are an empty report, not a failure", () => {
    const result = readExtensions(join(dir, "nowhere"), join(dir, "nothing.json"));
    expect(result).toEqual({ mcpServers: [], plugins: [], skills: [] });
  });

  test("malformed json is skipped rather than taking the page down", () => {
    write("claude.json", "{not json");
    write("claude/settings.json", "{also not json");
    const result = readExtensions(join(dir, "claude"), join(dir, "claude.json"));
    expect(result.mcpServers).toEqual([]);
  });
});
