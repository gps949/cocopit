import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listClaudeFiles } from "../cc/paths";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ccockpit-paths-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function addSession(project: string, sessionId: string, content = "{}\n"): string {
  const projectDir = join(dir, "projects", project);
  mkdirSync(projectDir, { recursive: true });
  const path = join(projectDir, `${sessionId}.jsonl`);
  writeFileSync(path, content);
  return path;
}

function addSubagent(project: string, sessionId: string, agentId: string): string {
  const subDir = join(dir, "projects", project, sessionId, "subagents");
  mkdirSync(subDir, { recursive: true });
  const path = join(subDir, `agent-${agentId}.jsonl`);
  writeFileSync(path, '{"type":"assistant"}\n');
  writeFileSync(join(subDir, `agent-${agentId}.meta.json`), '{"agentType":"explore"}');
  return path;
}

describe("listClaudeFiles", () => {
  test("missing claudeDir → empty list, no throw", async () => {
    expect(await listClaudeFiles(join(dir, "does-not-exist"))).toEqual([]);
  });

  test("claudeDir without projects dir → empty list", async () => {
    expect(await listClaudeFiles(dir)).toEqual([]);
  });

  test("enumerates main sessions with size and mtime", async () => {
    const p = addSession("-Users-x-proj-a", "sess-1", '{"a":1}\n{"b":2}\n');
    const tasks = await listClaudeFiles(dir);
    expect(tasks).toHaveLength(1);
    const t = tasks[0]!;
    expect(t.kind).toBe("session");
    expect(t.path).toBe(p);
    expect(t.projectDirName).toBe("-Users-x-proj-a");
    expect(t.sessionId).toBe("sess-1");
    expect(t.agentId).toBeUndefined();
    expect(t.size).toBe(Buffer.byteLength('{"a":1}\n{"b":2}\n'));
    expect(t.mtimeMs).toBeGreaterThan(0);
  });

  test("enumerates subagents under session dirs, skipping meta.json", async () => {
    addSession("-p1", "sess-1");
    const sub = addSubagent("-p1", "sess-1", "abc123");
    const tasks = await listClaudeFiles(dir);
    expect(tasks).toHaveLength(2);
    const sa = tasks.find((t) => t.kind === "subagent")!;
    expect(sa.path).toBe(sub);
    expect(sa.projectDirName).toBe("-p1");
    expect(sa.sessionId).toBe("sess-1");
    expect(sa.agentId).toBe("abc123");
  });

  test("multiple projects, non-jsonl files ignored", async () => {
    addSession("-p1", "s1");
    addSession("-p2", "s2");
    addSession("-p2", "s3");
    writeFileSync(join(dir, "projects", "-p2", "notes.txt"), "ignore me");
    const tasks = await listClaudeFiles(dir);
    expect(tasks.filter((t) => t.kind === "session")).toHaveLength(3);
    expect(new Set(tasks.map((t) => t.projectDirName))).toEqual(new Set(["-p1", "-p2"]));
  });

  test("session dir without subagents subdir tolerated", async () => {
    addSession("-p1", "s1");
    mkdirSync(join(dir, "projects", "-p1", "s1"), { recursive: true });
    const tasks = await listClaudeFiles(dir);
    expect(tasks).toHaveLength(1);
  });
});
