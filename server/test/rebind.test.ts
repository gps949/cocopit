import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../index";

let home: string;
let prevHome: string | undefined;
let server: ReturnType<typeof createServer> | null = null;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ccockpit-rebind-"));
  prevHome = process.env.CCOCKPIT_HOME;
  process.env.CCOCKPIT_HOME = home;
});

afterEach(() => {
  server?.stop(true);
  server = null;
  rmSync(home, { recursive: true, force: true });
  if (prevHome === undefined) delete process.env.CCOCKPIT_HOME;
  else process.env.CCOCKPIT_HOME = prevHome;
});

/**
 * Changing where the console listens should not mean going to the machine and
 * restarting it — especially since the reason to change it is usually that you
 * are not at that machine.
 */
describe("rebind", () => {
  test("moves the listener to a new port and serves there", async () => {
    server = createServer(0, { hostname: "127.0.0.1" });
    const first = server.port;
    expect((await fetch(`http://127.0.0.1:${first}/api/health`)).ok).toBe(true);

    const result = await server.rebind("127.0.0.1", 0);
    expect(result.ok).toBe(true);
    expect(server.port).not.toBe(first);
    expect((await fetch(`http://127.0.0.1:${server.port}/api/health`)).ok).toBe(true);
  });

  test("a failed rebind keeps the old listener serving", async () => {
    const blocker = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("busy") });
    server = createServer(0, { hostname: "127.0.0.1" });
    const original = server.port;

    const result = await server.rebind("127.0.0.1", blocker.port!);

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(server.port).toBe(original);
    expect((await fetch(`http://127.0.0.1:${original}/api/health`)).ok).toBe(true);
    blocker.stop(true);
  });

  test("rebinding to the same address is a no-op that still succeeds", async () => {
    server = createServer(0, { hostname: "127.0.0.1" });
    const port = server.port;
    const result = await server.rebind("127.0.0.1", port!);
    expect(result.ok).toBe(true);
    expect(server.port).toBe(port);
    expect((await fetch(`http://127.0.0.1:${port}/api/health`)).ok).toBe(true);
  });
});
