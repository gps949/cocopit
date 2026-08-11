import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  authorizeRequest,
  requiresLocalPeer,
  hashToken,
  issueSessionCookie,
  loadAuthConfig,
  setAccessToken,
  clearAccessToken,
} from "../auth";
import { isLoopbackRequest } from "../index";

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

  test("health, status and login stay reachable so the UI can bootstrap", () => {
    expect(authorizeRequest(req("/api/health")).ok).toBe(true);
    expect(authorizeRequest(req("/api/auth/status")).ok).toBe(true);
    expect(authorizeRequest(req("/api/auth/login")).ok).toBe(true);
    expect(authorizeRequest(req("/index.html")).ok).toBe(true);
    expect(authorizeRequest(req("/assets/index-abc.js")).ok).toBe(true);
  });

  test("managing the token itself is NOT a bootstrap path", () => {
    // it can overwrite or clear the credential, so it must require the current one
    expect(authorizeRequest(req("/api/auth/token")).ok).toBe(false);
    expect(
      authorizeRequest(req("/api/auth/token", { authorization: "Bearer s3cret-token" })).ok,
    ).toBe(true);
  });

  test("a Secure cookie is issued over https, plain over loopback http", () => {
    expect(issueSessionCookie("s3cret-token", true)).toContain("Secure");
    expect(issueSessionCookie("s3cret-token", false)).not.toContain("Secure");
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

describe("isLoopbackRequest", () => {
  test("the Host header cannot claim to be local — a remote client can set it freely", () => {
    const spoofed = new Request("http://127.0.0.1:7433/api/auth/token", { method: "POST" });
    // no peer address known → cannot prove locality
    expect(isLoopbackRequest(spoofed, undefined)).toBe(false);
    // the real socket peer is what counts
    expect(isLoopbackRequest(spoofed, "203.0.113.9")).toBe(false);
    expect(isLoopbackRequest(spoofed, "127.0.0.1")).toBe(true);
    expect(isLoopbackRequest(spoofed, "::1")).toBe(true);
  });

  test("a forwarded request is never local even from a loopback peer (the proxy runs locally)", () => {
    const proxied = new Request("http://127.0.0.1:7433/api/auth/token", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.9" },
    });
    expect(isLoopbackRequest(proxied, "127.0.0.1")).toBe(false);
  });
});

describe("privileged config mutation", () => {
  test("without a token, changing network settings still requires a local peer", () => {
    // an ssh tunnel or a same-host proxy can put a remote client on an
    // unauthenticated console; the global gate lets them through because no
    // token is configured, so locality is the only remaining check
    expect(requiresLocalPeer(loadAuthConfig())).toBe(true);
  });

  test("with a token configured, holding it is sufficient — remote admin is the point", () => {
    setAccessToken("s3cret-token");
    expect(requiresLocalPeer(loadAuthConfig())).toBe(false);
  });
});
