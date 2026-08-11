import { beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { applyMigrations, openDb } from "../db/db";
import { reconcileProjectCwd } from "../indexer/projectCwd";

let db: Database;

function addProject(id: number, dirName: string, cwd: string | null) {
  db.prepare(
    "INSERT INTO projects (id, profile_id, dir_name, cwd) VALUES ($id, 'default', $dir, $cwd)",
  ).run({ $id: id, $dir: dirName, $cwd: cwd });
}

function addSession(id: string, projectId: number, cwd: string | null) {
  db.prepare(
    "INSERT INTO sessions (id, project_id, file_path, cwd) VALUES ($id, $pid, $path, $cwd)",
  ).run({ $id: id, $pid: projectId, $path: `/tmp/${id}.jsonl`, $cwd: cwd });
}

beforeEach(() => {
  db = openDb(":memory:");
  applyMigrations(db);
});

describe("reconcileProjectCwd", () => {
  test("the directory most sessions used wins, not the last one scanned", () => {
    // the real case: 403 sessions in /Paymenter, one that had cd'd into /agent,
    // and the project ended up displaying /agent
    addProject(1, "-Users-me-Paymenter", "/Users/me/Paymenter/agent");
    for (let i = 0; i < 5; i++) addSession(`s${i}`, 1, "/Users/me/Paymenter");
    addSession("odd", 1, "/Users/me/Paymenter/agent");

    reconcileProjectCwd(db);

    const row = db.prepare("SELECT cwd FROM projects WHERE id = 1").get() as { cwd: string };
    expect(row.cwd).toBe("/Users/me/Paymenter");
  });

  test("two storage directories with genuinely different paths stay separate", () => {
    addProject(1, "-Users-me-Paymenter", null);
    addSession("a", 1, "/Users/me/Paymenter");
    addProject(2, "-Users-me-Paymenter-agent", null);
    addSession("b", 2, "/Users/me/Paymenter/agent");

    reconcileProjectCwd(db);

    const rows = db.prepare("SELECT id, cwd FROM projects ORDER BY id").all() as Array<{ cwd: string }>;
    expect(rows[0]!.cwd).toBe("/Users/me/Paymenter");
    expect(rows[1]!.cwd).toBe("/Users/me/Paymenter/agent");
  });

  test("a project whose sessions record no cwd keeps what it had", () => {
    addProject(1, "-Users-me-thing", "/Users/me/thing");
    addSession("a", 1, null);

    reconcileProjectCwd(db);

    expect((db.prepare("SELECT cwd FROM projects WHERE id = 1").get() as { cwd: string }).cwd).toBe(
      "/Users/me/thing",
    );
  });

  test("ties resolve deterministically rather than flapping between scans", () => {
    addProject(1, "-Users-me-x", null);
    addSession("a", 1, "/Users/me/b");
    addSession("b", 1, "/Users/me/a");

    reconcileProjectCwd(db);
    const first = (db.prepare("SELECT cwd FROM projects WHERE id = 1").get() as { cwd: string }).cwd;
    reconcileProjectCwd(db);
    const second = (db.prepare("SELECT cwd FROM projects WHERE id = 1").get() as { cwd: string }).cwd;
    expect(first).toBe(second);
  });
});
