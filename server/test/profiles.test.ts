import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { accountFilePath, detectProfile, loginCommand } from "../profiles/detect";
import {
  createProfile,
  deleteProfile,
  loadProfiles,
  profilesPath,
  resolveConfigDir,
  updateProfile,
} from "../profiles/registry";

let home: string;
let profilesBase: string;
let prevHome: string | undefined;
let prevBase: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cocopit-prof-home-"));
  profilesBase = mkdtempSync(join(tmpdir(), "cocopit-prof-base-"));
  prevHome = process.env.COCOPIT_HOME;
  prevBase = process.env.COCOPIT_PROFILES_BASE;
  process.env.COCOPIT_HOME = home;
  process.env.COCOPIT_PROFILES_BASE = profilesBase;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(profilesBase, { recursive: true, force: true });
  if (prevHome === undefined) delete process.env.COCOPIT_HOME;
  else process.env.COCOPIT_HOME = prevHome;
  if (prevBase === undefined) delete process.env.COCOPIT_PROFILES_BASE;
  else process.env.COCOPIT_PROFILES_BASE = prevBase;
});

describe("profiles registry", () => {
  test("initializes with the default profile at mode 0600", () => {
    const profiles = loadProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.id).toBe("default");
    expect(profiles[0]!.kind).toBe("subscription");
    expect(profiles[0]!.configDir).toBeNull();
    const mode = statSync(profilesPath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test("createProfile slugs the name, allocates a config dir, persists", () => {
    const profile = createProfile({ name: "Work 账号", kind: "subscription" });
    expect(profile.id).toMatch(/^work/);
    expect(profile.configDir).toBe(join(profilesBase, profile.id));
    expect(statSync(profile.configDir!).isDirectory()).toBe(true);

    const reloaded = loadProfiles();
    expect(reloaded).toHaveLength(2);
    expect(reloaded.find((p) => p.id === profile.id)?.name).toBe("Work 账号");
  });

  test("api profile stores endpoint config", () => {
    const profile = createProfile({
      name: "kimi api",
      kind: "api",
      api: { baseUrl: "https://api.moonshot.cn/anthropic", authKind: "auth_token", secret: "sk-test-1234" },
    });
    expect(profile.kind).toBe("api");
    expect(profile.api?.secret).toBe("sk-test-1234");
    expect(loadProfiles().find((p) => p.id === profile.id)?.api?.baseUrl).toBe(
      "https://api.moonshot.cn/anthropic",
    );
  });

  test("duplicate names get distinct ids", () => {
    const a = createProfile({ name: "Work", kind: "subscription" });
    const b = createProfile({ name: "Work", kind: "subscription" });
    expect(a.id).not.toBe(b.id);
  });

  test("update patches fields; delete removes non-default only", () => {
    const p = createProfile({ name: "Temp", kind: "subscription" });
    updateProfile(p.id, { color: "#c9683f" });
    expect(loadProfiles().find((x) => x.id === p.id)?.color).toBe("#c9683f");

    deleteProfile(p.id);
    expect(loadProfiles().find((x) => x.id === p.id)).toBeUndefined();
    expect(() => deleteProfile("default")).toThrow();
  });

  test("resolveConfigDir maps default → claudeDir from config", () => {
    const profiles = loadProfiles();
    const dir = resolveConfigDir(profiles[0]!);
    expect(dir.endsWith(".claude")).toBe(true);
    const p = createProfile({ name: "Other", kind: "subscription" });
    expect(resolveConfigDir(p)).toBe(p.configDir!);
  });
});

describe("detect", () => {
  test("reads oauthAccount from <configDir>/.claude.json", () => {
    const p = createProfile({ name: "Det", kind: "subscription" });
    writeFileSync(
      join(p.configDir!, ".claude.json"),
      JSON.stringify({
        oauthAccount: {
          emailAddress: "me@example.com",
          organizationName: "Acme",
          billingType: "stripe_subscription",
        },
      }),
    );
    const det = detectProfile(p);
    expect(det.loggedIn).toBe(true);
    expect(det.email).toBe("me@example.com");
    expect(det.orgName).toBe("Acme");
  });

  test("missing file or account → loggedIn false", () => {
    const p = createProfile({ name: "Empty", kind: "subscription" });
    expect(detectProfile(p).loggedIn).toBe(false);
    writeFileSync(join(p.configDir!, ".claude.json"), "{}");
    expect(detectProfile(p).loggedIn).toBe(false);
  });

  test("api profile is logged in when a secret exists", () => {
    const p = createProfile({
      name: "api",
      kind: "api",
      api: { authKind: "api_key", secret: "sk-x" },
    });
    expect(detectProfile(p).loggedIn).toBe(true);
  });

  test("loginCommand shell-quotes the config dir", () => {
    const p = createProfile({ name: "Quote Me", kind: "subscription" });
    const cmd = loginCommand(p);
    expect(cmd).toBe(`CLAUDE_CONFIG_DIR='${p.configDir}' claude /login`);
  });
});

describe("where a profile's account file lives", () => {
  test("the default profile reads ~/.claude.json, not ~/.claude/.claude.json", () => {
    // Claude Code keeps the default profile's config beside the data directory.
    // A stale .claude.json inside ~/.claude (left by an older layout or an
    // experiment) would otherwise report a different account than the one in use.
    expect(accountFilePath({ id: "default", name: "默认账号", kind: "subscription", configDir: null })).toBe(
      join(homedir(), ".claude.json"),
    );
  });

  test("a profile with its own config dir reads the file inside it", () => {
    expect(
      accountFilePath({ id: "work", name: "Work", kind: "subscription", configDir: "/tmp/cc-work" }),
    ).toBe(join("/tmp/cc-work", ".claude.json"));
  });
});
