import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupPlan, executeCleanup, scanDisk } from "../system/disk";

let dir: string;
const DAY = 86_400_000;

function ageFile(path: string, days: number): void {
  const when = (Date.now() - days * DAY) / 1000;
  utimesSync(path, when, when);
}

function write(path: string, bytes: number, ageDays?: number): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, "x".repeat(bytes));
  if (ageDays !== undefined) ageFile(path, ageDays);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cocopit-disk-"));

  write(join(dir, "debug", "old.log"), 1000, 200);
  write(join(dir, "debug", "recent.log"), 500, 2);

  // file-history is keyed by session id
  write(join(dir, "file-history", "sess-old", "a@v1"), 2000, 200);
  write(join(dir, "file-history", "sess-recent", "b@v1"), 300, 1);
  write(join(dir, "file-history", "sess-live", "c@v1"), 400, 200);

  write(join(dir, "plugins", "cache", "temp_git_123_abc", "junk"), 700, 60);
  write(join(dir, "shell-snapshots", "snap-old.sh"), 100, 200);
  // an empty env dir left behind by a finished session (a fresh one may belong
  // to a running session, so age is what makes it collectable)
  mkdirSync(join(dir, "session-env", "empty-one"), { recursive: true });
  ageFile(join(dir, "session-env", "empty-one"), 200);

  // transcripts must never be touched
  write(join(dir, "projects", "-p1", "s1.jsonl"), 5000, 400);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("scanDisk", () => {
  test("reports per-category size and file counts", () => {
    const report = scanDisk(dir);
    const byId = Object.fromEntries(report.categories.map((c) => [c.id, c]));
    expect(byId.debug!.sizeBytes).toBe(1500);
    expect(byId.debug!.fileCount).toBe(2);
    expect(byId["file-history"]!.sizeBytes).toBe(2700);
    expect(byId["plugin-temp"]!.fileCount).toBe(1);
    expect(report.totalBytes).toBeGreaterThan(4000);
  });

  test("transcripts are reported as protected, never as a cleanup category", () => {
    const report = scanDisk(dir);
    expect(report.categories.some((c) => (c.id as string) === "projects")).toBe(false);
    expect(report.protected.some((p) => p.id === "projects" && p.sizeBytes === 5000)).toBe(true);
  });
});

describe("cleanupPlan", () => {
  test("only items older than the retention window are eligible", () => {
    const plan = cleanupPlan(dir, { categories: ["debug"], retentionDays: 30, activeSessionIds: [] });
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]!.path).toContain("old.log");
    expect(plan.totalBytes).toBe(1000);
  });

  test("file-history of a live session is never listed", () => {
    const plan = cleanupPlan(dir, {
      categories: ["file-history"],
      retentionDays: 30,
      activeSessionIds: ["sess-live"],
    });
    const paths = plan.items.map((i) => i.path);
    expect(paths.some((p) => p.includes("sess-old"))).toBe(true);
    expect(paths.some((p) => p.includes("sess-live"))).toBe(false);
    expect(paths.some((p) => p.includes("sess-recent"))).toBe(false); // too new
  });

  test("plugin temp dirs and empty session-env dirs are collected", () => {
    const plan = cleanupPlan(dir, {
      categories: ["plugin-temp", "session-env"],
      retentionDays: 30,
      activeSessionIds: [],
    });
    expect(plan.items.some((i) => i.path.includes("temp_git_123_abc"))).toBe(true);
    expect(plan.items.some((i) => i.path.includes("empty-one"))).toBe(true);
  });

  test("transcripts can never be selected, even if asked for", () => {
    const plan = cleanupPlan(dir, {
      categories: ["projects" as never, "debug"],
      retentionDays: 30,
      activeSessionIds: [],
    });
    expect(plan.items.every((i) => !i.path.includes("/projects/"))).toBe(true);
  });
});

describe("executeCleanup", () => {
  test("dry run deletes nothing and matches the real run exactly", () => {
    const options = { categories: ["debug", "file-history"] as const, retentionDays: 30, activeSessionIds: [] };
    const dry = executeCleanup(dir, { ...options, categories: [...options.categories], dryRun: true });
    expect(existsSync(join(dir, "debug", "old.log"))).toBe(true);
    expect(dry.deleted).toBe(0);

    const real = executeCleanup(dir, { ...options, categories: [...options.categories], dryRun: false });
    expect(real.plan.items.map((i) => i.path).sort()).toEqual(dry.plan.items.map((i) => i.path).sort());
    expect(real.deleted).toBe(real.plan.items.length);
    expect(real.freedBytes).toBe(dry.plan.totalBytes);

    expect(existsSync(join(dir, "debug", "old.log"))).toBe(false);
    expect(existsSync(join(dir, "debug", "recent.log"))).toBe(true);
    expect(existsSync(join(dir, "file-history", "sess-old"))).toBe(false);
    expect(existsSync(join(dir, "file-history", "sess-recent"))).toBe(true);
    // transcripts survive untouched
    expect(existsSync(join(dir, "projects", "-p1", "s1.jsonl"))).toBe(true);
  });
});
