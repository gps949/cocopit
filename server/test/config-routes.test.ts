import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations, openDb } from "../db/db";
import { SseHub } from "../http/sse";
import { createServer } from "../index";
import { IndexScheduler } from "../indexer/scheduler";

let dir: string;
let home: string;
let projectDir: string;
let prevHome: string | undefined;
let db: Database;
let server: ReturnType<typeof createServer>;
let base: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ccockpit-cfg-"));
  home = mkdtempSync(join(tmpdir(), "ccockpit-cfg-home-"));
  projectDir = mkdtempSync(join(tmpdir(), "ccockpit-cfg-proj-"));
  prevHome = process.env.CCOCKPIT_HOME;
  process.env.CCOCKPIT_HOME = home;

  writeFileSync(
    join(dir, "settings.json"),
    JSON.stringify({ model: "opus", env: { FOO: "1" }, permissions: { allow: ["Bash(ls:*)"] } }, null, 2),
  );
  mkdirSync(join(projectDir, ".claude"), { recursive: true });
  writeFileSync(
    join(projectDir, ".claude", "settings.local.json"),
    JSON.stringify({ permissions: { allow: ["Bash(git status:*)"] } }, null, 2),
  );

  // a project row so scope=project can resolve a cwd
  const projects = join(dir, "projects", "-proj");
  mkdirSync(projects, { recursive: true });
  writeFileSync(
    join(projects, "cfg-sess.jsonl"),
    JSON.stringify({
      uuid: "u1",
      sessionId: "cfg-sess",
      timestamp: "2026-08-01T10:00:00.000Z",
      cwd: projectDir,
      type: "user",
      message: { role: "user", content: "config fixture" },
    }) + "\n",
  );

  db = openDb(":memory:");
  applyMigrations(db);
  const scheduler = new IndexScheduler(db, { workers: 1 });
  await scheduler.runScan([{ profileId: "default", dir }]);

  server = createServer(0, {
    db,
    scheduler,
    hub: new SseHub(),
    claudeDir: dir,
    claudeJsonPath: join(dir, "claude.json"),
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop(true);
  for (const d of [dir, home, projectDir]) rmSync(d, { recursive: true, force: true });
  if (prevHome === undefined) delete process.env.CCOCKPIT_HOME;
  else process.env.CCOCKPIT_HOME = prevHome;
});

async function getJson(path: string): Promise<any> {
  const res = await fetch(`${base}${path}`);
  expect(res.status).toBe(200);
  return res.json();
}

describe("settings read/write", () => {
  test("GET user settings returns content plus a CAS stamp and live-instance warning", async () => {
    const body = await getJson("/api/config/settings?scope=user");
    expect(body.path).toBe(join(dir, "settings.json"));
    expect(body.content.model).toBe("opus");
    expect(body.stamp.exists).toBe(true);
    expect(typeof body.stamp.sha256).toBe("string");
    expect(Array.isArray(body.activeSessions)).toBe(true);
  });

  test("PUT writes atomically, backs up, and returns the new stamp", async () => {
    const before = await getJson("/api/config/settings?scope=user");
    const res = await fetch(`${base}/api/config/settings?scope=user`, {
      method: "PUT",
      body: JSON.stringify({ content: { ...before.content, model: "sonnet" }, stamp: before.stamp }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.backupId).toBeTruthy();
    expect(body.stamp.sha256).not.toBe(before.stamp.sha256);

    const onDisk = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
    expect(onDisk.model).toBe("sonnet");
    expect(onDisk.env.FOO).toBe("1"); // untouched keys survive
  });

  test("a stale stamp gets 409 rather than clobbering", async () => {
    const snapshot = await getJson("/api/config/settings?scope=user");
    writeFileSync(join(dir, "settings.json"), JSON.stringify({ model: "written-by-claude" }, null, 2));

    const res = await fetch(`${base}/api/config/settings?scope=user`, {
      method: "PUT",
      body: JSON.stringify({ content: { model: "mine" }, stamp: snapshot.stamp }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.current.sha256).toBeTruthy();
    expect(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")).model).toBe("written-by-claude");
  });

  test("project scope reads and writes .claude/settings.local.json", async () => {
    const project = db.prepare("SELECT id FROM projects LIMIT 1").get() as { id: number };
    const body = await getJson(`/api/config/settings?scope=project&project=${project.id}`);
    expect(body.path).toBe(join(projectDir, ".claude", "settings.local.json"));
    expect(body.content.permissions.allow).toContain("Bash(git status:*)");

    const res = await fetch(`${base}/api/config/settings?scope=project&project=${project.id}`, {
      method: "PUT",
      body: JSON.stringify({
        content: { permissions: { allow: ["Bash(git status:*)", "Read(*)"] } },
        stamp: body.stamp,
      }),
    });
    expect(res.status).toBe(200);
    const onDisk = JSON.parse(readFileSync(join(projectDir, ".claude", "settings.local.json"), "utf8"));
    expect(onDisk.permissions.allow).toHaveLength(2);
  });

  test("invalid payloads are refused before touching disk", async () => {
    const snapshot = await getJson("/api/config/settings?scope=user");
    const badShape = await fetch(`${base}/api/config/settings?scope=user`, {
      method: "PUT",
      body: JSON.stringify({ content: "not an object", stamp: snapshot.stamp }),
    });
    expect(badShape.status).toBe(400);

    const badPermissions = await fetch(`${base}/api/config/settings?scope=user`, {
      method: "PUT",
      body: JSON.stringify({ content: { permissions: { allow: "should-be-array" } }, stamp: snapshot.stamp }),
    });
    expect(badPermissions.status).toBe(400);
  });
});

describe("permissions endpoint", () => {
  test("GET merges user and project rules with their source", async () => {
    const project = db.prepare("SELECT id FROM projects LIMIT 1").get() as { id: number };
    const body = await getJson(`/api/config/permissions?project=${project.id}`);
    expect(body.user.allow.length).toBeGreaterThanOrEqual(0);
    expect(body.project.allow).toContain("Read(*)");
  });
});

describe("backups", () => {
  test("GET lists backups; restore rolls the file back", async () => {
    const list = await getJson("/api/backups");
    expect(list.backups.length).toBeGreaterThan(0);
    const settingsBackup = list.backups.find((b: any) => b.originPath === join(dir, "settings.json"));
    expect(settingsBackup).toBeTruthy();

    const res = await fetch(`${base}/api/backups/${settingsBackup.id}/restore`, { method: "POST" });
    expect(res.status).toBe(200);
    const restored = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
    expect(restored.model).toBeTruthy();
    // the pre-restore state is itself backed up
    const after = await getJson("/api/backups");
    expect(after.backups.length).toBeGreaterThan(list.backups.length);
  });

  test("restoring an unknown backup is a 404", async () => {
    const res = await fetch(`${base}/api/backups/nope/restore`, { method: "POST" });
    expect(res.status).toBe(404);
  });
});
