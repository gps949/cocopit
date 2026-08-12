import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applySnapshot,
  captureSnapshot,
  deleteSnapshot,
  listSnapshots,
  materializeSnapshot,
  snapshotDiff,
} from "../cc/snapshots";

let home: string;
let claudeDir: string;
let prevHome: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cocopit-snap-home-"));
  claudeDir = mkdtempSync(join(tmpdir(), "cocopit-snap-claude-"));
  prevHome = process.env.COCOPIT_HOME;
  process.env.COCOPIT_HOME = home;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(claudeDir, { recursive: true, force: true });
  if (prevHome === undefined) delete process.env.COCOPIT_HOME;
  else process.env.COCOPIT_HOME = prevHome;
});

const settingsPath = () => join(claudeDir, "settings.json");
const writeSettings = (value: unknown) => writeFileSync(settingsPath(), JSON.stringify(value, null, 2) + "\n");
const readSettings = () => JSON.parse(readFileSync(settingsPath(), "utf8")) as Record<string, unknown>;

/**
 * Settings and the signed-in account both live under a config directory but are
 * not tied to each other — you can want a different permission posture without
 * a different login. A snapshot is that axis: name what settings.json says now,
 * put it back later, under whatever account.
 */
describe("captureSnapshot / listSnapshots", () => {
  test("names the current settings and lists them back", () => {
    writeSettings({ model: "opus", effortLevel: "high" });
    captureSnapshot("严格", settingsPath());

    const all = listSnapshots();
    expect(all).toHaveLength(1);
    expect(all[0]!.name).toBe("严格");
    expect(all[0]!.settings).toEqual({ model: "opus", effortLevel: "high" });
    expect(all[0]!.sourcePath).toBe(settingsPath());
  });

  test("capturing the same name twice replaces it rather than duplicating", () => {
    writeSettings({ model: "opus" });
    captureSnapshot("日常", settingsPath());
    writeSettings({ model: "haiku" });
    captureSnapshot("日常", settingsPath());

    const all = listSnapshots();
    expect(all).toHaveLength(1);
    expect(all[0]!.settings).toEqual({ model: "haiku" });
  });

  test("a name that would escape the directory is refused", () => {
    writeSettings({ model: "opus" });
    expect(() => captureSnapshot("../escape", settingsPath())).toThrow(/名称/);
    expect(() => captureSnapshot("a/b", settingsPath())).toThrow(/名称/);
    expect(() => captureSnapshot("", settingsPath())).toThrow(/名称/);
  });

  test("capturing a settings file that does not parse is refused", () => {
    writeFileSync(settingsPath(), "{ broken");
    expect(() => captureSnapshot("坏的", settingsPath())).toThrow();
    expect(listSnapshots()).toHaveLength(0);
  });
});

describe("applySnapshot", () => {
  test("writes the snapshot over the target and leaves a backup", () => {
    writeSettings({ model: "opus", effortLevel: "high" });
    captureSnapshot("严格", settingsPath());
    writeSettings({ model: "haiku" });

    const result = applySnapshot("严格", settingsPath(), claudeDir);

    expect(readSettings()).toEqual({ model: "opus", effortLevel: "high" });
    expect(result.backupId).toBeTruthy();
  });

  test("applying to a path outside the allowlist is refused", () => {
    writeSettings({ model: "opus" });
    captureSnapshot("严格", settingsPath());
    expect(() => applySnapshot("严格", join(claudeDir, "somewhere-else.json"), claudeDir)).toThrow();
  });

  test("an unknown snapshot is an error, not an empty write", () => {
    writeSettings({ model: "opus" });
    expect(() => applySnapshot("不存在", settingsPath(), claudeDir)).toThrow(/找不到/);
    expect(readSettings()).toEqual({ model: "opus" });
  });
});

describe("snapshotDiff", () => {
  test("reports what applying would change", () => {
    const diff = snapshotDiff({ model: "opus", effortLevel: "high", tui: {} }, { model: "haiku", theme: "dark" });
    expect(diff.changed).toEqual(["model"]);
    expect(diff.added.sort()).toEqual(["effortLevel", "tui"]);
    expect(diff.removed).toEqual(["theme"]);
  });

  test("identical settings produce an empty diff", () => {
    const diff = snapshotDiff({ model: "opus" }, { model: "opus" });
    expect(diff).toEqual({ changed: [], added: [], removed: [] });
  });

  test("nested values compare by content, not identity", () => {
    const diff = snapshotDiff({ env: { A: "1" } }, { env: { A: "1" } });
    expect(diff.changed).toEqual([]);
  });
});

describe("deleteSnapshot", () => {
  test("removes it", () => {
    writeSettings({ model: "opus" });
    captureSnapshot("临时", settingsPath());
    deleteSnapshot("临时");
    expect(listSnapshots()).toHaveLength(0);
  });

  test("refuses a name that would escape the directory", () => {
    mkdirSync(join(home, "snapshots"), { recursive: true });
    const victim = join(home, "important.json");
    writeFileSync(victim, "keep me");
    expect(() => deleteSnapshot("../important")).toThrow(/名称/);
    expect(existsSync(victim)).toBe(true);
  });
});

describe("materializeSnapshot", () => {
  test("writes a plain settings file the CLI can be pointed at", () => {
    // `claude --settings <file>` wants settings, not our wrapper with its name
    // and timestamps, so the payload is written out on its own
    writeSettings({ model: "opus", effortLevel: "high" });
    captureSnapshot("严格", settingsPath());

    const path = materializeSnapshot("严格");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ model: "opus", effortLevel: "high" });
  });

  test("re-materializing reflects the latest capture", () => {
    writeSettings({ model: "opus" });
    captureSnapshot("日常", settingsPath());
    writeSettings({ model: "haiku" });
    captureSnapshot("日常", settingsPath());
    expect(JSON.parse(readFileSync(materializeSnapshot("日常"), "utf8"))).toEqual({ model: "haiku" });
  });

  test("an unknown snapshot has nothing to materialize", () => {
    expect(() => materializeSnapshot("不存在")).toThrow(/找不到/);
  });
});
