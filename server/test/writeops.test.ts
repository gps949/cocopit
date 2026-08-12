import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  backupsRoot,
  createBackup,
  listBackups,
  restoreBackup,
  pruneBackups,
} from "../writeops/backup";
import { assertWritable, fileStamp, safeWriteJson, WriteConflictError } from "../writeops/safeWrite";

let home: string;
let claudeDir: string;
let prevHome: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cocopit-wo-home-"));
  claudeDir = mkdtempSync(join(tmpdir(), "cocopit-wo-claude-"));
  prevHome = process.env.COCOPIT_HOME;
  process.env.COCOPIT_HOME = home;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(claudeDir, { recursive: true, force: true });
  if (prevHome === undefined) delete process.env.COCOPIT_HOME;
  else process.env.COCOPIT_HOME = prevHome;
});

function settingsPath(): string {
  const path = join(claudeDir, "settings.json");
  writeFileSync(path, JSON.stringify({ model: "opus", env: { A: "1" } }, null, 2));
  return path;
}

describe("write allowlist", () => {
  test("claude settings and project-local settings are writable", () => {
    expect(() => assertWritable(join(claudeDir, "settings.json"), claudeDir)).not.toThrow();
    expect(() => assertWritable("/some/project/.claude/settings.local.json", claudeDir)).not.toThrow();
    expect(() => assertWritable("/some/project/.mcp.json", claudeDir)).not.toThrow();
  });

  test("~/.claude.json is never writable — Claude Code rewrites it constantly", () => {
    expect(() => assertWritable(join(claudeDir, ".claude.json"), claudeDir)).toThrow(/只读|read-only/i);
    expect(() => assertWritable(`${claudeDir}.json`, claudeDir)).toThrow();
  });

  test("arbitrary paths are refused", () => {
    expect(() => assertWritable("/etc/passwd", claudeDir)).toThrow();
    expect(() => assertWritable(join(claudeDir, "projects/x/session.jsonl"), claudeDir)).toThrow();
    // traversal dressed up as an allowed name
    expect(() => assertWritable(join(claudeDir, "../../etc/settings.json"), claudeDir)).toThrow();
  });
});

describe("safeWriteJson", () => {
  test("writes atomically, keeps mode, and backs the old content up first", () => {
    const path = settingsPath();
    chmodSync(path, 0o600);
    const before = fileStamp(path);

    const result = safeWriteJson({
      path,
      claudeDir,
      value: { model: "sonnet", env: { A: "1" } },
      expected: before,
      slug: "settings",
    });

    expect(JSON.parse(readFileSync(path, "utf8")).model).toBe("sonnet");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(result.backup).toBeTruthy();
    const backups = listBackups();
    expect(backups).toHaveLength(1);
    expect(JSON.parse(readFileSync(backups[0]!.storedPath, "utf8")).model).toBe("opus");
  });

  test("a concurrent external edit is rejected instead of clobbered", () => {
    const path = settingsPath();
    const stale = fileStamp(path);
    // Claude Code writes the file behind our back
    writeFileSync(path, JSON.stringify({ model: "haiku", env: { A: "2" } }, null, 2));

    expect(() =>
      safeWriteJson({ path, claudeDir, value: { model: "sonnet" }, expected: stale, slug: "settings" }),
    ).toThrow(WriteConflictError);
    // the external content survives untouched
    expect(JSON.parse(readFileSync(path, "utf8")).model).toBe("haiku");
  });

  test("creating a new file requires an absent expectation", () => {
    const path = join(claudeDir, "settings.json");
    const created = safeWriteJson({
      path,
      claudeDir,
      value: { model: "opus" },
      expected: { exists: false },
      slug: "settings",
    });
    expect(created.backup).toBeNull(); // nothing to back up
    expect(JSON.parse(readFileSync(path, "utf8")).model).toBe("opus");

    // second create with the same expectation now conflicts
    expect(() =>
      safeWriteJson({ path, claudeDir, value: { model: "x" }, expected: { exists: false }, slug: "settings" }),
    ).toThrow(WriteConflictError);
  });

  test("a rejected path never writes", () => {
    const path = join(claudeDir, "projects", "nope.jsonl");
    mkdirSync(join(claudeDir, "projects"), { recursive: true });
    expect(() =>
      safeWriteJson({ path, claudeDir, value: { a: 1 }, expected: { exists: false }, slug: "x" }),
    ).toThrow();
    expect(() => readFileSync(path)).toThrow();
  });
});

describe("backups", () => {
  test("manifest records origin and time; restore puts content back", () => {
    const path = settingsPath();
    const backup = createBackup(path, "settings")!;
    writeFileSync(path, JSON.stringify({ model: "wrecked" }));

    const entries = listBackups();
    expect(entries[0]!.id).toBe(backup.id);
    expect(entries[0]!.originPath).toBe(path);
    expect(entries[0]!.createdAt).toBeGreaterThan(0);

    const restored = restoreBackup(backup.id, claudeDir);
    expect(JSON.parse(readFileSync(path, "utf8")).model).toBe("opus");
    // restoring is itself backed up, so the wrecked version is recoverable
    expect(restored.backupOfCurrent).toBeTruthy();
    expect(listBackups().length).toBe(2);
  });

  test("backing up a missing file is a no-op", () => {
    expect(createBackup(join(claudeDir, "absent.json"), "settings")).toBeNull();
  });

  test("pruning keeps the newest N", () => {
    const path = settingsPath();
    for (let i = 0; i < 5; i++) {
      writeFileSync(path, JSON.stringify({ i }));
      createBackup(path, "settings");
    }
    expect(listBackups()).toHaveLength(5);
    pruneBackups(2);
    const kept = listBackups();
    expect(kept).toHaveLength(2);
    // newest survive
    expect(JSON.parse(readFileSync(kept[0]!.storedPath, "utf8")).i).toBe(4);
  });

  test("backups live under the cocopit home", () => {
    expect(backupsRoot().startsWith(home)).toBe(true);
  });
});
