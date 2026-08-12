import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setPluginEnabled } from "../cc/pluginToggle";

let claudeDir: string;

beforeEach(() => {
  claudeDir = mkdtempSync(join(tmpdir(), "ccockpit-plugin-"));
  mkdirSync(claudeDir, { recursive: true });
});
afterEach(() => rmSync(claudeDir, { recursive: true, force: true }));

const settingsPath = () => join(claudeDir, "settings.json");
const read = () => JSON.parse(readFileSync(settingsPath(), "utf8")) as Record<string, unknown>;

/**
 * Enabling a plugin is a settings.json edit, and settings.json is already on
 * the write allowlist with backup, compare-and-swap and an atomic replace. I had
 * refused this along with MCP edits, which do need ~/.claude.json — lumping
 * together two things with quite different risk.
 */
describe("setPluginEnabled", () => {
  test("disabling removes the entry, which is how Claude Code records it", () => {
    // the real settings.json holds 36 entries, every one of them true and none
    // false — the tool drops the key rather than writing false, and matching
    // that keeps the file looking like the CLI wrote it
    writeFileSync(
      settingsPath(),
      JSON.stringify({ model: "opus", enabledPlugins: { "a@m": true, "b@m": true } }, null, 2),
    );
    setPluginEnabled(claudeDir, "a@m", false);
    expect(read()).toEqual({ model: "opus", enabledPlugins: { "b@m": true } });
  });

  test("disabling something that was never enabled changes nothing", () => {
    writeFileSync(settingsPath(), JSON.stringify({ enabledPlugins: { "b@m": true } }));
    setPluginEnabled(claudeDir, "never@m", false);
    expect(read()).toEqual({ enabledPlugins: { "b@m": true } });
  });

  test("turns one on", () => {
    writeFileSync(settingsPath(), JSON.stringify({ enabledPlugins: {} }));
    setPluginEnabled(claudeDir, "a@m", true);
    expect((read().enabledPlugins as Record<string, boolean>)["a@m"]).toBe(true);
  });

  test("a plugin absent from settings can still be enabled", () => {
    writeFileSync(settingsPath(), JSON.stringify({ model: "opus" }));
    setPluginEnabled(claudeDir, "new@m", true);
    expect(read()).toEqual({ model: "opus", enabledPlugins: { "new@m": true } });
  });

  test("a missing settings file is created rather than failing", () => {
    setPluginEnabled(claudeDir, "a@m", true);
    expect(read()).toEqual({ enabledPlugins: { "a@m": true } });
  });

  test("it leaves a backup, like every other settings write", () => {
    writeFileSync(settingsPath(), JSON.stringify({ enabledPlugins: { "a@m": true } }));
    const result = setPluginEnabled(claudeDir, "a@m", false);
    expect(result.backupId).toBeTruthy();
  });

  test("a malformed settings file is refused instead of being overwritten", () => {
    writeFileSync(settingsPath(), "{ not json");
    expect(() => setPluginEnabled(claudeDir, "a@m", true)).toThrow();
    expect(readFileSync(settingsPath(), "utf8")).toBe("{ not json");
  });
});
