import { describe, expect, test } from "bun:test";
import { resolveBindHost } from "../bindHost";

/**
 * Binding beyond loopback exposes the built-in terminal — a remote shell on the
 * host — plus every session transcript and credential path. The token is what
 * makes that safe, so the two settings are interlocked rather than independent.
 */
describe("resolveBindHost", () => {
  test("defaults to loopback when nothing is configured", () => {
    expect(resolveBindHost(undefined, false)).toBe("127.0.0.1");
  });

  test("loopback needs no token — the local-only case stays frictionless", () => {
    expect(resolveBindHost("127.0.0.1", false)).toBe("127.0.0.1");
    expect(resolveBindHost("localhost", false)).toBe("localhost");
    expect(resolveBindHost("::1", false)).toBe("::1");
  });

  test("a public bind without a token is refused, and the error says how to fix it", () => {
    expect(() => resolveBindHost("0.0.0.0", false)).toThrow(/访问令牌/);
  });

  test("a public bind is allowed once a token exists", () => {
    expect(resolveBindHost("0.0.0.0", true)).toBe("0.0.0.0");
    expect(resolveBindHost("192.168.1.10", true)).toBe("192.168.1.10");
  });
});
