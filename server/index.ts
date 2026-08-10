import { join, normalize, sep } from "node:path";
import { loadConfig } from "./config";
import { Router } from "./http/router";
import { healthHandler } from "./routes/health";

const router = new Router();
router.register("GET", "/api/health", healthHandler);

const DIST_DIR = normalize(join(import.meta.dir, "..", "web", "dist"));

async function serveStatic(pathname: string): Promise<Response> {
  const indexFile = Bun.file(join(DIST_DIR, "index.html"));
  if (!(await indexFile.exists())) {
    return new Response("web ui not built — run: bun run build", { status: 503 });
  }

  const requestedPath = normalize(join(DIST_DIR, decodeURIComponent(pathname)));
  if (requestedPath !== DIST_DIR && !requestedPath.startsWith(DIST_DIR + sep)) {
    // path traversal attempt — stay inside dist
    return new Response("Forbidden", { status: 403 });
  }

  const file = Bun.file(requestedPath);
  if (await file.exists()) {
    return new Response(file);
  }

  const hasExtension = /\.[^/.]+$/.test(pathname);
  if (!hasExtension) {
    return new Response(indexFile);
  }

  return new Response("Not Found", { status: 404 });
}

export function createServer(port?: number) {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: port ?? (Number(process.env.CCOCKPIT_PORT) || loadConfig().port),
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname.startsWith("/api/")) {
        const match = router.match(req);
        if (match) {
          return match.handler(req, match.params);
        }
        return new Response("Not Found", { status: 404 });
      }

      return serveStatic(url.pathname);
    },
  });
}

if (import.meta.main) {
  const server = createServer();
  console.log(`listening on http://${server.hostname}:${server.port}`);
}
