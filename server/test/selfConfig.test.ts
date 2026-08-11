import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configPath, loadConfig } from "../config";
import { updateSelfConfig } from "../selfConfig";

let home: string;
let prevHome: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ccockpit-selfcfg-"));
  prevHome = process.env.CCOCKPIT_HOME;
  process.env.CCOCKPIT_HOME = home;
  loadConfig(); // materialize defaults
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  if (prevHome === undefined) delete process.env.CCOCKPIT_HOME;
  else process.env.CCOCKPIT_HOME = prevHome;
});

describe("updateSelfConfig", () => {
  test("writes only the fields given, leaving the rest alone", () => {
    const before = loadConfig();
    updateSelfConfig({ host: "0.0.0.0" }, true);
    const after = loadConfig();
    expect(after.host).toBe("0.0.0.0");
    expect(after.port).toBe(before.port);
    expect(after.claudeDir).toBe(before.claudeDir);
  });

  test("refuses a public bind while no token exists — the same interlock as startup", () => {
    expect(() => updateSelfConfig({ host: "0.0.0.0" }, false)).toThrow(/访问令牌/);
    expect(loadConfig().host).toBe("127.0.0.1");
  });

  test("rejects unknown keys instead of silently persisting them", () => {
    expect(() => updateSelfConfig({ claudeDir: "/tmp/evil" } as never, true)).toThrow(/不可修改/);
  });

  test("validates the port range", () => {
    expect(() => updateSelfConfig({ port: 0 }, true)).toThrow(/端口/);
    expect(() => updateSelfConfig({ port: 70000 }, true)).toThrow(/端口/);
    updateSelfConfig({ port: 8080 }, true);
    expect(loadConfig().port).toBe(8080);
  });

  test("origins must be a list of absolute http(s) origins", () => {
    expect(() => updateSelfConfig({ allowedOrigins: ["not a url"] }, true)).toThrow(/来源/);
    updateSelfConfig({ allowedOrigins: ["https://cc.example.com"] }, true);
    expect(loadConfig().allowedOrigins).toEqual(["https://cc.example.com"]);
  });

  test("the file stays valid JSON a human can edit", () => {
    updateSelfConfig({ host: "0.0.0.0" }, true);
    const raw = readFileSync(configPath(), "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(JSON.parse(raw).host).toBe("0.0.0.0");
  });
});
