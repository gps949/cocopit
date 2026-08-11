import type { Database } from "bun:sqlite";
import { join, normalize, sep } from "node:path";
import {
  authorizeRequest,
  clearAccessToken,
  issueSessionCookie,
  isSecureRequest,
  loadAuthConfig,
  setAccessToken,
} from "./auth";
import { resolveBindHost } from "./bindHost";
import { warmUsageCache } from "./usageWarm";
import { loadConfig } from "./config";
import { openIndexDb } from "./db/db";
import { Router } from "./http/router";
import { SseHub } from "./http/sse";
import { IndexScheduler, type ScanSource } from "./indexer/scheduler";
import { FsWatcher } from "./indexer/watcher";
import { loadProfiles } from "./profiles/registry";
import { healthHandler } from "./routes/health";
import { registerConfigRoutes } from "./routes/config";
import { registerPricingRoutes } from "./routes/pricing";
import { registerSessionRoutes } from "./routes/sessions";
import { registerSystemRoutes } from "./routes/system";
import { registerLiveRoutes } from "./routes/live";
import { registerProfileRoutes } from "./routes/profiles";
import { registerTerminalRoutes, terminalUpgradeAllowed } from "./routes/terminal";
import { registerUsageRoutes } from "./routes/usage";
import { terminalWebSocketHandlers, type TerminalSocketData } from "./terminal/socket";

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
  /** Extra origins allowed for writes; defaults to config.allowedOrigins. */
  allowedOrigins?: string[];
  /** Bind address; defaults to config.host under the token interlock. */
  hostname?: string;
}

/**
 * State-changing requests must come from this console itself. Browsers attach
 * Origin to cross-origin writes, so rejecting a foreign Origin keeps another
 * site from driving the local API (it can still be called by curl or native
 * apps, which send no Origin). Reads are exempt: their responses are unreadable
 * cross-origin anyway.
 */
export function originAllowed(req: Request, allowedOrigins: string[] = []): boolean {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return true;
  const origin = req.headers.get("origin");
  if (!origin) return true;

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  // configured origins cover reverse-proxied / tunnelled remote access
  const normalize = (value: string) => value.trim().replace(/\/+$/, "").toLowerCase();
  if (allowedOrigins.some((allowed) => normalize(allowed) === normalize(parsed.origin))) return true;

  const isLoopback =
    parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "[::1]";
  return isLoopback && parsed.port === String(new URL(req.url).port);
}

/**
 * True when the request came from this machine rather than through a proxy.
 * The peer address must come from the socket: req.url is built from the Host
 * header, which any client can set to 127.0.0.1.
 */
export function isLoopbackRequest(req: Request, peerAddress: string | undefined): boolean {
  if (req.headers.get("x-forwarded-for")) return false; // arrived through a proxy
  if (!peerAddress) return false; // cannot prove locality → treat as remote
  return peerAddress === "127.0.0.1" || peerAddress === "::1" || peerAddress === "::ffff:127.0.0.1";
}

/** All registered profiles as scan sources (default profile → claudeDir). */
export function profileScanSources(claudeDir: string): ScanSource[] {
  return loadProfiles().map((profile) => ({
    profileId: profile.id,
    dir: profile.configDir ?? claudeDir,
  }));
}

export function createServer(port?: number, deps: ServerDeps = {}) {
  // Bun exposes the socket peer on the server object, not the Request; stash it
  // per request so routes can tell a local caller from a proxied one.
  const peers = new WeakMap<Request, string>();
  const peerAddressOf = (req: Request) => peers.get(req);
  const bindHost = deps.hostname ?? resolveBindHost(loadConfig().host, loadAuthConfig().enabled);
  const bindPort = port ?? (Number(process.env.CCOCKPIT_PORT) || loadConfig().port);
  const router = new Router();
  router.register("GET", "/api/health", healthHandler);

  router.register("GET", "/api/auth/status", () => {
    return Response.json({ required: loadAuthConfig().enabled });
  });

  router.register("POST", "/api/auth/login", async (req) => {
    let token = "";
    try {
      token = String(((await req.json()) as { token?: string }).token ?? "");
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }
    const cookie = issueSessionCookie(token, isSecureRequest(req));
    if (!cookie) return Response.json({ error: "令牌不正确" }, { status: 401 });
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json", "set-cookie": cookie },
    });
  });

  router.register("POST", "/api/auth/logout", () => {
    return new Response(JSON.stringify({ ok: true }), {
      headers: {
        "content-type": "application/json",
        "set-cookie": "ccockpit_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
      },
    });
  });

  // Managing the token itself is a local-only operation: it is how you recover
  // from a lost token, so it must not be reachable through the proxy.
  router.register("POST", "/api/auth/token", async (req) => {
    if (!isLoopbackRequest(req, peerAddressOf(req))) {
      return Response.json({ error: "仅允许在本机设置访问令牌" }, { status: 403 });
    }
    let body: { token?: string | null };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }
    if (body.token === null || body.token === "") {
      clearAccessToken();
      return Response.json({ required: false });
    }
    if (typeof body.token !== "string" || body.token.length < 8) {
      return Response.json({ error: "令牌至少 8 个字符" }, { status: 400 });
    }
    setAccessToken(body.token);
    return Response.json({ required: true });
  });

  const { db, scheduler, hub, claudeDir } = deps;
  if (db && scheduler && hub && claudeDir !== undefined) {
    registerUsageRoutes(router, db, deps.claudeJsonPath ?? `${claudeDir}.json`);
    registerPricingRoutes(router, db, hub, scheduler);
    registerProfileRoutes(router, scheduler, () => deps.sources ?? profileScanSources(claudeDir));
    registerSessionRoutes(router, db);
    registerLiveRoutes(router, db, claudeDir);
    registerTerminalRoutes(router, db);
    registerConfigRoutes(router, db, claudeDir);
    registerSystemRoutes(router, claudeDir, bindHost, bindPort, (req) =>
      isLoopbackRequest(req, peerAddressOf(req)),
    );
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

  const allowedOrigins = () => deps.allowedOrigins ?? loadConfig().allowedOrigins ?? [];

  return Bun.serve<TerminalSocketData>({
    hostname: bindHost,
    port: bindPort,
    idleTimeout: 0,
    websocket: terminalWebSocketHandlers(),
    async fetch(req, server) {
      const url = new URL(req.url);
      const peer = server.requestIP(req);
      if (peer) peers.set(req, peer.address);

      if (!originAllowed(req, allowedOrigins())) {
        return new Response("Forbidden: cross-origin request", { status: 403 });
      }

      const auth = authorizeRequest(req);
      if (!auth.ok) {
        return Response.json({ error: auth.reason ?? "unauthorized" }, { status: auth.status ?? 401 });
      }

      // WebSocket upgrades are GETs and CORS does not apply to them, so the
      // terminal socket needs its own origin gate.
      const attachMatch = /^\/api\/terminal\/([^/]+)\/attach$/.exec(url.pathname);
      if (attachMatch) {
        if (!terminalUpgradeAllowed(req, allowedOrigins())) {
          return new Response("Forbidden: cross-origin websocket", { status: 403 });
        }
        const name = decodeURIComponent(attachMatch[1]!);
        if (!name.startsWith("cc-")) {
          return new Response("Not Found", { status: 404 });
        }
        const upgraded = server.upgrade(req, { data: { name, attachment: null } });
        return upgraded ? undefined : new Response("Expected a websocket upgrade", { status: 426 });
      }

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

  let server: ReturnType<typeof createServer>;
  try {
    server = createServer(undefined, { db, scheduler, hub, claudeDir: config.claudeDir, sources });
  } catch (err) {
    // the bind interlock is a configuration mistake, not a crash — say what to do
    console.error(`\n${(err as Error).message}\n`);
    process.exit(1);
  }
  console.log(`listening on http://${server.hostname}:${server.port}`);
  scheduler.runScan(sources).then((summary) => {
    console.log(
      `index scan: ${summary.workItems} files, ${summary.errors} errors, ${(summary.durationMs / 1000).toFixed(1)}s`,
    );
    warmUsageCache(db);
  });
  new FsWatcher(scheduler, sources).start();
}
