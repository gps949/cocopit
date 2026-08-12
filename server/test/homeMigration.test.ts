import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateLegacyHome } from "../homeMigration";

let base: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "cocopit-migrate-"));
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const legacy = () => join(base, ".ccockpit");
const current = () => join(base, ".cocopit");

/**
 * The rename must not look like a fresh install. Everything the tool owns lives
 * in that one directory — an 814 MB index, the access token, config, settings
 * presets and every config backup.
 */
describe("migrateLegacyHome", () => {
  test("moves the old directory across, contents intact", () => {
    mkdirSync(join(legacy(), "snapshots"), { recursive: true });
    writeFileSync(join(legacy(), "auth.json"), '{"tokenHash":"abc"}');
    writeFileSync(join(legacy(), "snapshots", "strict.json"), '{"name":"strict"}');

    const moved = migrateLegacyHome(legacy(), current());

    expect(moved).toBe(true);
    expect(existsSync(legacy())).toBe(false);
    expect(readFileSync(join(current(), "auth.json"), "utf8")).toBe('{"tokenHash":"abc"}');
    expect(readFileSync(join(current(), "snapshots", "strict.json"), "utf8")).toBe('{"name":"strict"}');
  });

  test("does nothing when there is no old directory", () => {
    expect(migrateLegacyHome(legacy(), current())).toBe(false);
    expect(existsSync(current())).toBe(false);
  });

  test("never overwrites an existing new directory", () => {
    mkdirSync(legacy(), { recursive: true });
    writeFileSync(join(legacy(), "auth.json"), "old");
    mkdirSync(current(), { recursive: true });
    writeFileSync(join(current(), "auth.json"), "new");

    expect(migrateLegacyHome(legacy(), current())).toBe(false);
    expect(readFileSync(join(current(), "auth.json"), "utf8")).toBe("new");
    // the old one is left alone rather than deleted — nothing of the user's is
    // thrown away on a guess
    expect(existsSync(legacy())).toBe(true);
  });
});
