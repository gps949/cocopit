import { describe, expect, test } from "bun:test";
import { LineSplitter } from "../indexer/scanner-lines";

const enc = new TextEncoder();

describe("LineSplitter", () => {
  test("splits multiple lines in a single chunk", () => {
    const s = new LineSplitter(0);
    const lines = s.push(enc.encode("abc\ndef\n"));
    expect(lines).toEqual([
      { text: "abc", byteOffset: 0, byteLen: 4 },
      { text: "def", byteOffset: 4, byteLen: 4 },
    ]);
    expect(s.consumedBytes).toBe(8);
  });

  test("joins a line spanning two chunks", () => {
    const s = new LineSplitter(0);
    expect(s.push(enc.encode("hel"))).toEqual([]);
    const lines = s.push(enc.encode("lo\nx\n"));
    expect(lines).toEqual([
      { text: "hello", byteOffset: 0, byteLen: 6 },
      { text: "x", byteOffset: 6, byteLen: 2 },
    ]);
    expect(s.consumedBytes).toBe(8);
  });

  test("reassembles a multi-byte Chinese character split across chunks", () => {
    const s = new LineSplitter(0);
    const bytes = enc.encode("你好\n"); // 3 + 3 + 1 = 7 bytes
    expect(s.push(bytes.slice(0, 4))).toEqual([]); // cuts 好 mid-character
    const lines = s.push(bytes.slice(4));
    expect(lines).toEqual([{ text: "你好", byteOffset: 0, byteLen: 7 }]);
    expect(s.consumedBytes).toBe(7);
  });

  test("never emits a trailing line without newline; consumedBytes excludes it", () => {
    const s = new LineSplitter(0);
    const lines = s.push(enc.encode("done\npartial"));
    expect(lines).toEqual([{ text: "done", byteOffset: 0, byteLen: 5 }]);
    expect(s.consumedBytes).toBe(5);
  });

  test("completing a previously truncated line resumes cleanly", () => {
    const s = new LineSplitter(0);
    s.push(enc.encode("trunc"));
    expect(s.consumedBytes).toBe(0);
    const lines = s.push(enc.encode("ated\n"));
    expect(lines).toEqual([{ text: "truncated", byteOffset: 0, byteLen: 10 }]);
    expect(s.consumedBytes).toBe(10);
  });

  test("honors a non-zero startOffset for resumed reads", () => {
    const s = new LineSplitter(100);
    const lines = s.push(enc.encode("abc\n"));
    expect(lines).toEqual([{ text: "abc", byteOffset: 100, byteLen: 4 }]);
    expect(s.consumedBytes).toBe(104);
  });

  test("empty chunks produce nothing and preserve state", () => {
    const s = new LineSplitter(0);
    expect(s.push(new Uint8Array(0))).toEqual([]);
    expect(s.consumedBytes).toBe(0);
    s.push(enc.encode("a"));
    expect(s.push(new Uint8Array(0))).toEqual([]);
    const lines = s.push(enc.encode("\n"));
    expect(lines).toEqual([{ text: "a", byteOffset: 0, byteLen: 2 }]);
    expect(s.consumedBytes).toBe(2);
  });

  test("a caller that reuses one read buffer still gets intact lines", () => {
    // Buffer.prototype.slice returns a VIEW, not a copy — so carrying the
    // partial tail forward by slicing a reused Buffer would alias memory the
    // next read overwrites, silently corrupting the line across the boundary.
    const s = new LineSplitter(0);
    const scratch = Buffer.alloc(4);
    const source = enc.encode("hello\n");
    const collected: string[] = [];
    for (let i = 0; i < source.length; i += 4) {
      const n = Math.min(4, source.length - i);
      scratch.set(source.subarray(i, i + n), 0);
      collected.push(...s.push(scratch.subarray(0, n)).map((l) => l.text));
      scratch.fill(0); // simulate the next read landing in the same buffer
    }
    expect(collected).toEqual(["hello"]);
  });

  test("consecutive empty lines each yield an empty RawLine", () => {
    const s = new LineSplitter(0);
    const lines = s.push(enc.encode("\n\n"));
    expect(lines).toEqual([
      { text: "", byteOffset: 0, byteLen: 1 },
      { text: "", byteOffset: 1, byteLen: 1 },
    ]);
    expect(s.consumedBytes).toBe(2);
  });
});
