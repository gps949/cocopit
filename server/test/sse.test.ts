import { describe, expect, test } from "bun:test";
import { SseHub } from "../http/sse";

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  needle: string,
  timeoutMs = 2000,
): Promise<string> {
  const dec = new TextDecoder();
  let buf = "";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await Promise.race([
      reader.read(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("read timeout")), timeoutMs)),
    ]);
    if (result.done) break;
    buf += dec.decode(result.value, { stream: true });
    if (buf.includes(needle)) return buf;
  }
  throw new Error(`needle ${JSON.stringify(needle)} not found; got: ${JSON.stringify(buf)}`);
}

describe("SseHub", () => {
  test("handler returns a text/event-stream response with initial comment", async () => {
    const hub = new SseHub();
    const res = hub.handler(new Request("http://localhost/api/events"));
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const reader = res.body!.getReader();
    await readUntil(reader, ": connected");
    await reader.cancel();
  });

  test("broadcast reaches connected clients as named events", async () => {
    const hub = new SseHub();
    const res = hub.handler(new Request("http://localhost/api/events"));
    const reader = res.body!.getReader();
    await readUntil(reader, ": connected");
    hub.broadcast("index.progress", { pct: 0.5 });
    const buf = await readUntil(reader, "event: index.progress");
    expect(buf).toContain('data: {"pct":0.5}');
    await reader.cancel();
  });

  test("heartbeat comments flow at the configured interval", async () => {
    const hub = new SseHub({ heartbeatMs: 20 });
    const res = hub.handler(new Request("http://localhost/api/events"));
    const reader = res.body!.getReader();
    await readUntil(reader, ": ping");
    await reader.cancel();
  });

  test("cancelled clients are dropped", async () => {
    const hub = new SseHub();
    const res = hub.handler(new Request("http://localhost/api/events"));
    const reader = res.body!.getReader();
    await readUntil(reader, ": connected");
    expect(hub.clientCount).toBe(1);
    await reader.cancel();
    await new Promise((r) => setTimeout(r, 10));
    expect(hub.clientCount).toBe(0);
    hub.broadcast("noop", {}); // must not throw with zero clients
  });
});
