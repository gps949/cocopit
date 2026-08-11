import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSubagentTranscript } from "../cc/subagentReader";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ccockpit-sub-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, lines: unknown[]): string {
  const path = join(dir, name);
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return path;
}

describe("readSubagentTranscript", () => {
  test("returns every record in file order, shaped like the session transcript", async () => {
    const path = write("a.jsonl", [
      { type: "user", uuid: "u1", message: { role: "user", content: "do the thing" } },
      { type: "assistant", uuid: "a1", message: { role: "assistant", content: [{ type: "text", text: "done" }] } },
    ]);
    const result = await readSubagentTranscript(path);
    expect(result.total).toBe(2);
    expect(result.records).toHaveLength(2);
    expect(result.records[0]!.seq).toBe(0);
    expect((result.records[0]!.record as { uuid: string }).uuid).toBe("u1");
    expect(result.truncatedFile).toBe(false);
  });

  test("pages, so a 6MB transcript does not arrive in one response", async () => {
    const path = write(
      "big.jsonl",
      Array.from({ length: 10 }, (_, i) => ({ type: "user", uuid: `u${i}`, message: { role: "user", content: "x" } })),
    );
    const page = await readSubagentTranscript(path, { offset: 4, limit: 3 });
    expect(page.total).toBe(10);
    expect(page.records.map((r) => r.seq)).toEqual([4, 5, 6]);
  });

  test("an oversized single line is reported, not materialized", async () => {
    const path = write("huge.jsonl", [
      { type: "user", uuid: "u1", message: { role: "user", content: "x".repeat(2000) } },
    ]);
    const result = await readSubagentTranscript(path, { maxBodyBytes: 100 });
    expect(result.records[0]!.record).toBeNull();
    expect(result.records[0]!.truncated).toBe(true);
    expect(result.records[0]!.byteLen).toBeGreaterThan(2000);
  });

  test("a malformed line does not sink the whole transcript", async () => {
    const path = join(dir, "bad.jsonl");
    writeFileSync(path, '{"type":"user","uuid":"u1"}\nnot json at all\n{"type":"user","uuid":"u2"}\n');
    const result = await readSubagentTranscript(path);
    expect(result.total).toBe(3);
    expect(result.records[1]!.record).toBeNull();
    expect(result.records[1]!.error).toBeTruthy();
    expect((result.records[2]!.record as { uuid: string }).uuid).toBe("u2");
  });

  test("a multi-byte character split across read chunks still decodes", async () => {
    // 「代」 is 3 bytes; with a small read buffer it straddles the boundary, and a
    // naive per-chunk toString() turns it into replacement characters
    const text = "子".repeat(400) + "代理完成";
    const path = write("cjk.jsonl", [{ type: "user", uuid: "u1", message: { role: "user", content: text } }]);
    const result = await readSubagentTranscript(path, { chunkBytes: 64 });
    const record = result.records[0]!.record as { message: { content: string } };
    expect(record.message.content).toBe(text);
    expect(JSON.stringify(record)).not.toContain("�");
  });

  test("a missing file is an empty transcript, not a crash — records get cleaned up", async () => {
    await expect(readSubagentTranscript(join(dir, "gone.jsonl"))).rejects.toThrow(/ENOENT|no such file/i);
  });
});
