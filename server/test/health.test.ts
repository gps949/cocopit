import { describe, expect, test } from "bun:test";
import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { Router } from "../http/router";
import { createServer } from "../index";

const DIST_DIR = join(import.meta.dir, "..", "..", "web", "dist");
const DIST_BACKUP = `${DIST_DIR}.bak-test`;

describe("GET /api/health", () => {
  test("returns ok status and a non-empty version", async () => {
    const server = createServer(0);
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/api/health`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(typeof body.version).toBe("string");
      expect(body.version.length).toBeGreaterThan(0);
    } finally {
      server.stop();
    }
  });
});

describe("static hosting", () => {
  test("GET / returns 503 when web/dist is not built", async () => {
    // Ensure the precondition holds regardless of whether `bun run build`
    // has already produced web/dist in this checkout.
    const distExisted = existsSync(DIST_DIR);
    if (distExisted) {
      renameSync(DIST_DIR, DIST_BACKUP);
    }

    const server = createServer(0);
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/`);
      expect(res.status).toBe(503);
      expect(await res.text()).toBe("web ui not built — run: bun run build");
    } finally {
      server.stop();
      if (distExisted) {
        renameSync(DIST_BACKUP, DIST_DIR);
      }
    }
  });
});

describe("Router", () => {
  test("extracts :param segments", () => {
    const router = new Router();
    router.register("GET", "/api/items/:id", () => new Response("ok"));

    const match = router.match(new Request("http://localhost/api/items/42"));
    expect(match).not.toBeNull();
    expect(match?.params).toEqual({ id: "42" });
  });

  test("returns null when the method does not match", () => {
    const router = new Router();
    router.register("GET", "/api/items/:id", () => new Response("ok"));

    const match = router.match(
      new Request("http://localhost/api/items/42", { method: "POST" }),
    );
    expect(match).toBeNull();
  });

  test("returns null for an unregistered path", () => {
    const router = new Router();
    router.register("GET", "/api/items/:id", () => new Response("ok"));

    const match = router.match(new Request("http://localhost/api/unknown"));
    expect(match).toBeNull();
  });
});
