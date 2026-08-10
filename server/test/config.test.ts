import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config";

let home: string;
let prevHome: string | undefined;

beforeEach(() => {
  prevHome = process.env.CCOCKPIT_HOME;
  home = mkdtempSync(join(tmpdir(), "ccockpit-config-"));
  process.env.CCOCKPIT_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) {
    delete process.env.CCOCKPIT_HOME;
  } else {
    process.env.CCOCKPIT_HOME = prevHome;
  }
  rmSync(home, { recursive: true, force: true });
});

describe("loadConfig", () => {
  test("creates config.json with defaults when absent", () => {
    const config = loadConfig();
    expect(config.port).toBe(7433);
    expect(config.claudeDir.endsWith(".claude")).toBe(true);

    const onDisk = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
    expect(onDisk.port).toBe(7433);
    expect(onDisk.claudeDir).toBe(config.claudeDir);
  });

  test("preserves unknown fields and fills missing defaults", () => {
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({ port: 8000, custom: { a: 1 } }),
    );

    const config = loadConfig();
    expect(config.port).toBe(8000);
    expect(config.claudeDir.length).toBeGreaterThan(0);

    const onDisk = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
    expect(onDisk.custom).toEqual({ a: 1 });
    expect(onDisk.claudeDir).toBe(config.claudeDir);
  });

  test("throws with the file path on malformed JSON", () => {
    writeFileSync(join(home, "config.json"), "{oops");
    expect(() => loadConfig()).toThrow(/config\.json/);
  });
});
