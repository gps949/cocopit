import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveCocopitHome } from "./config";

/**
 * Optional access token for remote deployments. cocopit binds to loopback and
 * checks Origin, which is enough on your own machine; putting it behind a
 * reverse proxy exposes it to anyone who can reach that proxy, so a token can
 * be required. With no token configured nothing changes — a local-only console
 * should not demand a login.
 */

export interface AuthConfig {
  enabled: boolean;
  tokenHash?: string;
  /** Server-side secret used to sign session cookies. */
  cookieSecret?: string;
  updatedAt?: number;
}

export const SESSION_COOKIE = "cocopit_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function authPath(): string {
  return join(resolveCocopitHome(), "auth.json");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function loadAuthConfig(): AuthConfig {
  const path = authPath();
  if (!existsSync(path)) return { enabled: false };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as AuthConfig;
    return parsed.tokenHash ? { ...parsed, enabled: true } : { enabled: false };
  } catch {
    // an unreadable auth file must not silently disable protection
    return { enabled: true, tokenHash: "unreadable" };
  }
}

export function setAccessToken(token: string): void {
  const config: AuthConfig = {
    enabled: true,
    tokenHash: hashToken(token),
    cookieSecret: randomBytes(32).toString("hex"),
    updatedAt: Date.now(),
  };
  writeFileSync(authPath(), JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}

export function clearAccessToken(): void {
  const path = authPath();
  if (existsSync(path)) unlinkSync(path);
}

/** Signed, expiring cookie value: <expiry>.<hmac-ish digest>. */
function signSession(expiry: number, secret: string): string {
  return `${expiry}.${createHash("sha256").update(`${expiry}:${secret}`).digest("hex")}`;
}

export function issueSessionCookie(token: string, secure = false): string | null {
  const config = loadAuthConfig();
  if (!config.enabled || !config.tokenHash) return null;
  if (!constantTimeEqual(hashToken(token), config.tokenHash)) return null;

  const expiry = Date.now() + SESSION_TTL_MS;
  const value = signSession(expiry, config.cookieSecret ?? config.tokenHash);
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  const flags = secure ? "; Secure" : "";
  return `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${flags}`;
}

function sessionValid(value: string, config: AuthConfig): boolean {
  const separator = value.indexOf(".");
  if (separator < 0) return false;
  const expiry = Number(value.slice(0, separator));
  if (!Number.isFinite(expiry) || expiry < Date.now()) return false;
  return constantTimeEqual(value, signSession(expiry, config.cookieSecret ?? config.tokenHash ?? ""));
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

/**
 * Paths the browser must reach before it can possibly hold a session. Only
 * these two auth endpoints qualify: /api/auth/token can overwrite or clear the
 * credential, so it goes through the gate like everything else.
 */
const BOOTSTRAP_PATHS = new Set(["/api/health", "/api/auth/status", "/api/auth/login"]);

function isBootstrapPath(pathname: string): boolean {
  if (BOOTSTRAP_PATHS.has(pathname)) return true;
  if (pathname.startsWith("/api/")) return false;
  return true; // static assets and the SPA shell
}

export interface AuthResult {
  ok: boolean;
  status?: number;
  reason?: string;
}

export function authorizeRequest(req: Request, config = loadAuthConfig()): AuthResult {
  if (!config.enabled) return { ok: true };

  const { pathname } = new URL(req.url);
  if (isBootstrapPath(pathname)) return { ok: true };

  const header = req.headers.get("authorization");
  if (header?.startsWith("Bearer ")) {
    const token = header.slice("Bearer ".length).trim();
    if (config.tokenHash && constantTimeEqual(hashToken(token), config.tokenHash)) return { ok: true };
  }

  const cookie = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
  if (cookie && sessionValid(cookie, config)) return { ok: true };

  return { ok: false, status: 401, reason: "需要访问令牌" };
}

/**
 * Whether a privileged mutation (network settings, the token itself) must come
 * from a local socket peer.
 *
 * With a token configured, holding it is proof enough — administering the
 * console remotely is the reason the token exists. With no token, the gate lets
 * everyone through, and a same-host proxy or an ssh tunnel can put a remote
 * client on that open console; requiring a real loopback peer keeps them from
 * repointing the bind address or the allowed origins.
 */
export function requiresLocalPeer(config = loadAuthConfig()): boolean {
  return !config.enabled;
}

/** True when the client is talking HTTPS, directly or through a TLS proxy. */
export function isSecureRequest(req: Request): boolean {
  const proto = req.headers.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0]!.trim() === "https";
  return new URL(req.url).protocol === "https:";
}
