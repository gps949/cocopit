import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeProjectDir, handOffSession } from "../cc/handoff";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cocopit-handoff-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("encodeProjectDir", () => {
  test("matches the names Claude Code actually uses", () => {
    // taken from this machine's ~/.claude/projects
    expect(encodeProjectDir("/Users/chenyanggao/WorkSpace/cocopit")).toBe(
      "-Users-chenyanggao-WorkSpace-cocopit",
    );
    expect(encodeProjectDir("/Users/chenyanggao/WorkSpace/net-check")).toBe(
      "-Users-chenyanggao-WorkSpace-net-check",
    );
    // a dot becomes a dash too, so a hidden directory yields a double dash
    expect(encodeProjectDir("/Users/chenyanggao/WorkSpace/Paymenter/.remember/tmp/carpet6")).toBe(
      "-Users-chenyanggao-WorkSpace-Paymenter--remember-tmp-carpet6",
    );
  });
});

function writeSession(path: string, id: string, lines: number): void {
  mkdirSync(join(path, "projects", "-w-proj"), { recursive: true });
  const file = join(path, "projects", "-w-proj", `${id}.jsonl`);
  const body = Array.from({ length: lines }, (_, i) =>
    JSON.stringify({
      uuid: `u${i}`,
      sessionId: id,
      type: i % 2 ? "assistant" : "user",
      cwd: "/w/proj",
      message: { role: i % 2 ? "assistant" : "user", content: `第 ${i} 条,提到 ${id} 这个字符串` },
    }),
  ).join("\n");
  writeFileSync(file, body + "\n");
}

describe("handOffSession", () => {
  test("writes the conversation into the target profile under a fresh id", async () => {
    const source = join(dir, "a");
    const target = join(dir, "b");
    writeSession(source, "old-session-id", 4);

    const result = await handOffSession({
      sourceFile: join(source, "projects", "-w-proj", "old-session-id.jsonl"),
      targetConfigDir: target,
      cwd: "/w/proj",
      newSessionId: "new-session-id",
    });

    expect(result.path).toBe(join(target, "projects", "-w-proj", "new-session-id.jsonl"));
    expect(existsSync(result.path)).toBe(true);
    expect(result.records).toBe(4);
  });

  test("rewrites the sessionId field on every record", async () => {
    const source = join(dir, "a");
    writeSession(source, "old-session-id", 3);
    const result = await handOffSession({
      sourceFile: join(source, "projects", "-w-proj", "old-session-id.jsonl"),
      targetConfigDir: join(dir, "b"),
      cwd: "/w/proj",
      newSessionId: "new-session-id",
    });

    const written = readFileSync(result.path, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(written.every((r) => r.sessionId === "new-session-id")).toBe(true);
  });

  test("leaves the old id alone where it appears inside message text", async () => {
    // a blind string replace would corrupt the conversation itself
    const source = join(dir, "a");
    writeSession(source, "old-session-id", 2);
    const result = await handOffSession({
      sourceFile: join(source, "projects", "-w-proj", "old-session-id.jsonl"),
      targetConfigDir: join(dir, "b"),
      cwd: "/w/proj",
      newSessionId: "new-session-id",
    });

    const first = JSON.parse(readFileSync(result.path, "utf8").split("\n")[0]!);
    expect(first.message.content).toContain("old-session-id");
    expect(first.sessionId).toBe("new-session-id");
  });

  test("message uuids are preserved, which is what links the two sessions", async () => {
    const source = join(dir, "a");
    writeSession(source, "old-session-id", 3);
    const result = await handOffSession({
      sourceFile: join(source, "projects", "-w-proj", "old-session-id.jsonl"),
      targetConfigDir: join(dir, "b"),
      cwd: "/w/proj",
      newSessionId: "new-session-id",
    });
    const written = readFileSync(result.path, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(written.map((r) => r.uuid)).toEqual(["u0", "u1", "u2"]);
  });

  test("refuses to overwrite an existing session file", async () => {
    const source = join(dir, "a");
    const target = join(dir, "b");
    writeSession(source, "old-session-id", 2);
    mkdirSync(join(target, "projects", "-w-proj"), { recursive: true });
    writeFileSync(join(target, "projects", "-w-proj", "taken.jsonl"), "existing\n");

    await expect(
      handOffSession({
        sourceFile: join(source, "projects", "-w-proj", "old-session-id.jsonl"),
        targetConfigDir: target,
        cwd: "/w/proj",
        newSessionId: "taken",
      }),
    ).rejects.toThrow(/已存在/);
    expect(readFileSync(join(target, "projects", "-w-proj", "taken.jsonl"), "utf8")).toBe("existing\n");
  });

  test("a multi-byte character split across read chunks survives", async () => {
    const source = join(dir, "a");
    mkdirSync(join(source, "projects", "-w-proj"), { recursive: true });
    const text = "子".repeat(500) + "代理";
    writeFileSync(
      join(source, "projects", "-w-proj", "s.jsonl"),
      JSON.stringify({ uuid: "u1", sessionId: "s", message: { content: text } }) + "\n",
    );
    const result = await handOffSession({
      sourceFile: join(source, "projects", "-w-proj", "s.jsonl"),
      targetConfigDir: join(dir, "b"),
      cwd: "/w/proj",
      newSessionId: "n",
      chunkBytes: 64,
    });
    const written = JSON.parse(readFileSync(result.path, "utf8").split("\n")[0]!);
    expect(written.message.content).toBe(text);
  });
});
