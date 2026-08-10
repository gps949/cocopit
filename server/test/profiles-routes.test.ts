import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations, openDb } from "../db/db";
import { SseHub } from "../http/sse";
import { createServer } from "../index";
import { IndexScheduler } from "../indexer/scheduler";

let dir: string;
let home: string;
let profilesBase: string;
let prevHome: string | undefined;
let prevBase: string | undefined;
let db: Database;
let server: ReturnType<typeof createServer>;
let base: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ccockpit-proutes-"));
  home = mkdtempSync(join(tmpdir(), "ccockpit-proutes-home-"));
  profilesBase = mkdtempSync(join(tmpdir(), "ccockpit-proutes-base-"));
  prevHome = process.env.CCOCKPIT_HOME;
  prevBase = process.env.CCOCKPIT_PROFILES_BASE;
  process.env.CCOCKPIT_HOME = home;
  process.env.CCOCKPIT_PROFILES_BASE = profilesBase;

  db = openDb(":memory:");
  applyMigrations(db);
  server = createServer(0, {
    db,
    scheduler: new IndexScheduler(db, { workers: 1 }),
    hub: new SseHub(),
    claudeDir: dir,
    claudeJsonPath: join(dir, "claude.json"),
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
  rmSync(profilesBase, { recursive: true, force: true });
  if (prevHome === undefined) delete process.env.CCOCKPIT_HOME;
  else process.env.CCOCKPIT_HOME = prevHome;
  if (prevBase === undefined) delete process.env.CCOCKPIT_PROFILES_BASE;
  else process.env.CCOCKPIT_PROFILES_BASE = prevBase;
});

describe("profiles routes", () => {
  test("GET lists the default profile with detection state", async () => {
    const res = await fetch(`${base}/api/profiles`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { profiles: any[] };
    expect(body.profiles).toHaveLength(1);
    expect(body.profiles[0].id).toBe("default");
    expect(body.profiles[0].detection).toBeDefined();
  });

  test("POST creates a subscription profile and returns its login command", async () => {
    const res = await fetch(`${base}/api/profiles`, {
      method: "POST",
      body: JSON.stringify({ name: "Work", kind: "subscription" }),
    });
    expect(res.status).toBe(201);
    const profile = (await res.json()) as any;
    expect(profile.id).toBe("work");
    expect(profile.loginCommand).toContain("CLAUDE_CONFIG_DIR=");
    expect(profile.loginCommand).toContain("claude /login");
  });

  test("api profile secrets are masked in responses", async () => {
    const res = await fetch(`${base}/api/profiles`, {
      method: "POST",
      body: JSON.stringify({
        name: "Kimi",
        kind: "api",
        api: { baseUrl: "https://api.moonshot.cn/anthropic", authKind: "auth_token", secret: "sk-verysecret-9876" },
      }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as any;
    expect(created.api.secret).toBe("****9876");

    const list = (await (await fetch(`${base}/api/profiles`)).json()) as { profiles: any[] };
    const kimi = list.profiles.find((p) => p.id === "kimi");
    expect(kimi.api.secret).toBe("****9876");
    expect(JSON.stringify(list)).not.toContain("sk-verysecret-9876");
  });

  test("detect endpoint reads oauthAccount and caches lastDetected", async () => {
    const list = (await (await fetch(`${base}/api/profiles`)).json()) as { profiles: any[] };
    const work = list.profiles.find((p) => p.id === "work");
    writeFileSync(
      join(work.configDir, ".claude.json"),
      JSON.stringify({ oauthAccount: { emailAddress: "w@x.com", organizationName: "X Org" } }),
    );
    const det = (await (await fetch(`${base}/api/profiles/work/detect`)).json()) as any;
    expect(det.loggedIn).toBe(true);
    expect(det.email).toBe("w@x.com");

    const after = (await (await fetch(`${base}/api/profiles`)).json()) as { profiles: any[] };
    expect(after.profiles.find((p) => p.id === "work").lastDetected.email).toBe("w@x.com");
  });

  test("activate writes current-profile.sh for the profile", async () => {
    const res = await fetch(`${base}/api/profiles/work/activate`, { method: "POST" });
    expect(res.status).toBe(200);
    const script = readFileSync(join(home, "current-profile.sh"), "utf8");
    expect(script).toContain(`export CLAUDE_CONFIG_DIR='${join(profilesBase, "work")}'`);

    // default profile clears the override
    await fetch(`${base}/api/profiles/default/activate`, { method: "POST" });
    const cleared = readFileSync(join(home, "current-profile.sh"), "utf8");
    expect(cleared).toContain("unset CLAUDE_CONFIG_DIR");
  });

  test("api profile activate exports endpoint env", async () => {
    await fetch(`${base}/api/profiles/kimi/activate`, { method: "POST" });
    const script = readFileSync(join(home, "current-profile.sh"), "utf8");
    expect(script).toContain("export ANTHROPIC_BASE_URL='https://api.moonshot.cn/anthropic'");
    expect(script).toContain("export ANTHROPIC_AUTH_TOKEN='sk-verysecret-9876'");
  });

  test("PATCH updates without clobbering the secret on masked input", async () => {
    const res = await fetch(`${base}/api/profiles/kimi`, {
      method: "PATCH",
      body: JSON.stringify({ color: "#c9683f", api: { authKind: "auth_token", secret: "****9876" } }),
    });
    expect(res.status).toBe(200);
    await fetch(`${base}/api/profiles/kimi/activate`, { method: "POST" });
    const script = readFileSync(join(home, "current-profile.sh"), "utf8");
    expect(script).toContain("sk-verysecret-9876"); // real secret preserved
  });

  test("PATCH cannot repoint a profile's config dir or change its kind", async () => {
    const before = ((await (await fetch(`${base}/api/profiles`)).json()) as { profiles: any[] }).profiles.find(
      (p) => p.id === "kimi",
    );
    const res = await fetch(`${base}/api/profiles/kimi`, {
      method: "PATCH",
      body: JSON.stringify({ configDir: null, kind: "subscription", id: "hijacked", name: "renamed" }),
    });
    expect(res.status).toBe(200);
    const after = ((await (await fetch(`${base}/api/profiles`)).json()) as { profiles: any[] }).profiles.find(
      (p) => p.id === "kimi",
    );
    expect(after.configDir).toBe(before.configDir); // never repointed at ~/.claude
    expect(after.kind).toBe("api");
    expect(after.name).toBe("renamed"); // editable fields still apply
  });

  test("DELETE removes non-default; default is rejected", async () => {
    const del = await fetch(`${base}/api/profiles/work`, { method: "DELETE" });
    expect(del.status).toBe(200);
    const bad = await fetch(`${base}/api/profiles/default`, { method: "DELETE" });
    expect(bad.status).toBe(400);
  });
});
