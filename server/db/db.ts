import { Database, type Statement } from "bun:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { dbPath } from "../config";

const MIGRATIONS_DIR = join(import.meta.dir, "migrations");

export function openDb(path: string): Database {
  const db = new Database(path, { create: true });
  db.run("PRAGMA journal_mode = WAL;");
  db.run("PRAGMA synchronous = NORMAL;");
  return db;
}

function schemaVersion(db: Database): number {
  const hasMeta = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'")
    .get();
  if (!hasMeta) return 0;
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
    | { value: string }
    | null;
  return row ? Number(row.value) : 0;
}

export function applyMigrations(db: Database): void {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const current = schemaVersion(db);

  for (const file of files) {
    const version = Number.parseInt(file, 10);
    if (!Number.isInteger(version)) {
      throw new Error(`migration filename must start with a number: ${file}`);
    }
    if (version <= current) continue;

    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    db.transaction(() => {
      db.run(sql);
      db.prepare(
        "INSERT INTO meta (key, value) VALUES ('schema_version', $version) " +
          "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run({ $version: String(version) });
    })();
  }
}

/** Runs a prepared statement for every row inside a single transaction. */
export function insertMany(db: Database, stmt: Statement, rows: unknown[]): void {
  db.transaction(() => {
    for (const row of rows) {
      if (Array.isArray(row)) {
        stmt.run(...row);
      } else {
        stmt.run(row as never);
      }
    }
  })();
}

export function openIndexDb(): Database {
  const db = openDb(dbPath());
  applyMigrations(db);
  return db;
}
