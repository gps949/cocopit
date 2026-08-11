import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  authorizeRequest,
  hashToken,
  issueSessionCookie,
  loadAuthConfig,
  setAccessToken,
  clearAccessToken,
} from "../auth";

let home: string;
let prevHome: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ccockpit-auth-"));
  prevHome = process.env.CCOCKPIT_HOME;
  process.env.CCOCKPIT_HOME = home;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  if (prevHome === undefined) delete process.env.CCOCKPIT_HOME;
  else process.env.CCOCKPIT_HOME = prevHome;
});

function req(path = "/api/sessions", headers: Record<string, string> = {}): Request {
  return new Request(`http://127.0.0.1:7433${path}`, { headers });
}

describe("no token configured", () => {
  test("everything is allowed — a local-only console needs no login", () => {
    expect(loadAuthConfig().enabled).toBe(false);
    expect(authorizeRequest(req()).ok).toBe(true);
  });
});

describe("token configured", () => {
  beforeEach(() => setAccessToken("s3cret-token"));

  test("the raw token is never stored, only its hash", () => {
    const config = loadAuthConfig();
    expect(config.enabled).toBe(true);
    expect(JSON.stringify(config)).not.toContain("s3cret-token");
    expect(config.tokenHash).toBe(hashToken("s3cret-token"));
  });

  test("requests without credentials are refused", () => {
    const result = authorizeRequest(req());
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
  });

  test("a bearer token authorizes", () => {
    expect(authorizeRequest(req("/api/sessions", { authorization: "Bearer s3cret-token" })).ok).toBe(true);
    expect(authorizeRequest(req("/api/sessions", { authorization: "Bearer wrong" })).ok).toBe(false);
  });

  test("a session cookie issued from the token authorizes", () => {
    const cookie = issueSessionCookie("s3cret-token");
    expect(cookie).toBeTruthy();
    const value = cookie!.split(";")[0]!.split("=")[1]!;
    expect(authorizeRequest(req("/api/sessions", { cookie: `ccockpit_session=${value}` })).ok).toBe(true);
    expect(authorizeRequest(req("/api/sessions", { cookie: "ccockpit_session=forged" })).ok).toBe(false);
  });

  test("a wrong token cannot mint a cookie", () => {
    expect(issueSessionCookie("nope")).toBeNull();
  });

  test("health and the login page stay reachable so the UI can bootstrap", () => {
    expect(authorizeRequest(req("/api/health")).ok).toBe(true);
    expect(authorizeRequest(req("/api/auth/status")).ok).toBe(true);
    expect(authorizeRequest(req("/index.html")).ok).toBe(true);
    expect(authorizeRequest(req("/assets/index-abc.js")).ok).toBe(true);
  });

  test("clearing the token restores open access", () => {
    clearAccessToken();
    expect(loadAuthConfig().enabled).toBe(false);
    expect(authorizeRequest(req()).ok).toBe(true);
  });
});

describe("hashToken", () => {
  test("is stable and differs per input", () => {
    expect(hashToken("a")).toBe(hashToken("a"));
    expect(hashToken("a")).not.toBe(hashToken("b"));
    expect(hashToken("a")).toHaveLength(64);
  });
});
