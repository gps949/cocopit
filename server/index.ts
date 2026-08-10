import type { Database } from "bun:sqlite";
import { join, normalize, sep } from "node:path";
import { loadConfig } from "./config";
import { openIndexDb } from "./db/db";
import { Router } from "./http/router";
import { SseHub } from "./http/sse";
import { IndexScheduler, type ScanSource } from "./indexer/scheduler";
import { FsWatcher } from "./indexer/watcher";
import { loadProfiles } from "./profiles/registry";
import { healthHandler } from "./routes/health";
import { registerPricingRoutes } from "./routes/pricing";
import { registerProfileRoutes } from "./routes/profiles";
import { registerUsageRoutes } from "./routes/usage";

const DIST_DIR = normalize(join(import.meta.dir, "..", "web", "dist"));

const INDEXED_TABLES = [
  "messages",
  "usage_events",
  "tool_calls",
  "fts_messages",
  "parse_errors",
  "subagents",
  "sessions",
  "projects",
];

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

export interface ServerDeps {
  db?: Database;
  scheduler?: IndexScheduler;
  hub?: SseHub;
  claudeDir?: string;
  /** Path to the global ~/.claude.json (read-only; calibration source). */
  claudeJsonPath?: string;
  /** Scan sources; defaults to the single default profile on claudeDir. */
  sources?: ScanSource[];
}

/** All registered profiles as scan sources (default profile → claudeDir). */
export function profileScanSources(claudeDir: string): ScanSource[] {
  return loadProfiles().map((profile) => ({
    profileId: profile.id,
    dir: profile.configDir ?? claudeDir,
  }));
}

export function createServer(port?: number, deps: ServerDeps = {}) {
  const router = new Router();
  router.register("GET", "/api/health", healthHandler);

  const { db, scheduler, hub, claudeDir } = deps;
  if (db && scheduler && hub && claudeDir !== undefined) {
    registerUsageRoutes(router, db, deps.claudeJsonPath ?? `${claudeDir}.json`);
    registerPricingRoutes(router, db, hub, scheduler);
    registerProfileRoutes(router, scheduler, () => deps.sources ?? profileScanSources(claudeDir));
    scheduler.addEventListener("progress", (event) => {
      hub.broadcast("index.progress", (event as CustomEvent).detail);
    });
    router.register("GET", "/api/events", (req) => hub.handler(req));
    router.register("GET", "/api/index/status", () => Response.json(scheduler.status));
    router.register("POST", "/api/index/rescan", async (req) => {
      let full = false;
      try {
        full = ((await req.json()) as { full?: boolean }).full === true;
      } catch {
        // empty or malformed body → incremental rescan
      }
      if (full) {
        for (const table of INDEXED_TABLES) db.run(`DELETE FROM ${table}`);
      }
      void scheduler.runScan(deps.sources ?? profileScanSources(claudeDir));
      return Response.json({ started: true }, { status: 202 });
    });
  }

  return Bun.serve({
    hostname: "127.0.0.1",
    port: port ?? (Number(process.env.CCOCKPIT_PORT) || loadConfig().port),
    idleTimeout: 0,
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
  const config = loadConfig();
  const db = openIndexDb();
  const scheduler = new IndexScheduler(db);
  const hub = new SseHub();
  const sources = profileScanSources(config.claudeDir);
  const server = createServer(undefined, { db, scheduler, hub, claudeDir: config.claudeDir, sources });
  console.log(`listening on http://${server.hostname}:${server.port}`);
  scheduler.runScan(sources).then((summary) => {
    console.log(
      `index scan: ${summary.workItems} files, ${summary.errors} errors, ${(summary.durationMs / 1000).toFixed(1)}s`,
    );
  });
  new FsWatcher(scheduler, sources).start();
}
