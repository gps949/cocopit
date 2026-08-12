import { describe, expect, test } from "bun:test";
import { applyMigrations, openDb } from "../db/db";
import { rebuildSessionLinks } from "../indexer/sessionLinks";

function seed() {
  const db = openDb(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO projects (id, profile_id, dir_name) VALUES (1,'default','p')").run();
  return db;
}

function addSession(db: ReturnType<typeof seed>, id: string) {
  db.prepare("INSERT INTO sessions (id, project_id, file_path) VALUES (?,1,?)").run(id, `/tmp/${id}.jsonl`);
}

function addMsg(db: ReturnType<typeof seed>, sid: string, uuid: string, seq: number, type = "assistant") {
  db.prepare(
    "INSERT INTO messages (session_id, uuid, seq, byte_offset, byte_len, type) VALUES (?,?,?,0,0,?)",
  ).run(sid, uuid, seq, type);
}

/**
 * Two session files can hold the same conversation records — a branch of one
 * continued as the other. Shown as unrelated sessions, that is the same kind of
 * false picture as showing rewound work: the console asserts something about
 * the history that is not true.
 */
describe("rebuildSessionLinks", () => {
  test("links two sessions that share conversation records", () => {
    const db = seed();
    addSession(db, "a");
    addSession(db, "b");
    for (let i = 0; i < 5; i++) {
      addMsg(db, "a", `u${i}`, i);
      addMsg(db, "b", `u${i}`, i + 10);
    }
    rebuildSessionLinks(db);

    const links = db.prepare("SELECT * FROM session_links ORDER BY session_id").all() as Array<{
      session_id: string;
      related_session_id: string;
      shared_records: number;
    }>;
    // stored both ways so either session can find the other
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({ session_id: "a", related_session_id: "b", shared_records: 5 });
    expect(links[1]).toMatchObject({ session_id: "b", related_session_id: "a", shared_records: 5 });
    db.close();
  });

  test("a coincidental overlap below the threshold is not a link", () => {
    const db = seed();
    addSession(db, "a");
    addSession(db, "b");
    addMsg(db, "a", "shared", 0);
    addMsg(db, "b", "shared", 0);
    rebuildSessionLinks(db);
    expect(db.prepare("SELECT COUNT(*) n FROM session_links").get()).toEqual({ n: 0 });
    db.close();
  });

  test("only conversation records count — shared bookkeeping is not a branch", () => {
    const db = seed();
    addSession(db, "a");
    addSession(db, "b");
    for (let i = 0; i < 8; i++) {
      addMsg(db, "a", `att${i}`, i, "attachment");
      addMsg(db, "b", `att${i}`, i, "attachment");
    }
    rebuildSessionLinks(db);
    expect(db.prepare("SELECT COUNT(*) n FROM session_links").get()).toEqual({ n: 0 });
    db.close();
  });

  test("rebuilding replaces previous links rather than accumulating", () => {
    const db = seed();
    addSession(db, "a");
    addSession(db, "b");
    for (let i = 0; i < 5; i++) {
      addMsg(db, "a", `u${i}`, i);
      addMsg(db, "b", `u${i}`, i);
    }
    rebuildSessionLinks(db);
    rebuildSessionLinks(db);
    expect(db.prepare("SELECT COUNT(*) n FROM session_links").get()).toEqual({ n: 2 });
    db.close();
  });

  test("a session sharing with two others gets both links", () => {
    const db = seed();
    for (const id of ["a", "b", "c"]) addSession(db, id);
    for (let i = 0; i < 5; i++) {
      addMsg(db, "a", `u${i}`, i);
      addMsg(db, "b", `u${i}`, i);
      addMsg(db, "c", `u${i}`, i);
    }
    rebuildSessionLinks(db);
    const forA = db.prepare("SELECT related_session_id r FROM session_links WHERE session_id='a' ORDER BY r").all();
    expect(forA.map((x) => (x as { r: string }).r)).toEqual(["b", "c"]);
    db.close();
  });
});

describe("direction", () => {
  const build = () => {
    const db = seed();
    addSession(db, "parent");
    addSession(db, "child");
    // the parent's whole conversation is copied into the child, which then
    // continues on its own — the shape both real pairs have
    for (let i = 0; i < 5; i++) {
      addMsg(db, "parent", `u${i}`, i);
      addMsg(db, "child", `u${i}`, i);
    }
    for (let i = 5; i < 12; i++) addMsg(db, "child", `u${i}`, i);
    return db;
  };

  test("the session wholly contained in the other is the parent", () => {
    const db = build();
    rebuildSessionLinks(db);
    const fromChild = db.prepare("SELECT role FROM session_links WHERE session_id='child'").get();
    const fromParent = db.prepare("SELECT role FROM session_links WHERE session_id='parent'").get();
    expect(fromChild).toEqual({ role: "parent" }); // what the other session is to me
    expect(fromParent).toEqual({ role: "child" });
    db.close();
  });

  test("when neither contains the other, no direction is claimed", () => {
    const db = seed();
    addSession(db, "a");
    addSession(db, "b");
    for (let i = 0; i < 5; i++) {
      addMsg(db, "a", `u${i}`, i);
      addMsg(db, "b", `u${i}`, i);
    }
    addMsg(db, "a", "a-only", 9);
    addMsg(db, "b", "b-only", 9);
    rebuildSessionLinks(db);
    const roles = db.prepare("SELECT DISTINCT role FROM session_links").all();
    expect(roles).toEqual([{ role: "related" }]);
    db.close();
  });

  test("two identical sessions claim no direction either", () => {
    const db = seed();
    addSession(db, "a");
    addSession(db, "b");
    for (let i = 0; i < 5; i++) {
      addMsg(db, "a", `u${i}`, i);
      addMsg(db, "b", `u${i}`, i);
    }
    rebuildSessionLinks(db);
    const roles = db.prepare("SELECT DISTINCT role FROM session_links").all();
    expect(roles).toEqual([{ role: "related" }]);
    db.close();
  });
});
