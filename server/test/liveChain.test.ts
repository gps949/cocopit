import { describe, expect, test } from "bun:test";
import { applyMigrations, openDb } from "../db/db";
import { markSuperseded, recomputeSuperseded, type ChainRow } from "../indexer/liveChain";

const row = (uuid: string, parent: string | null, type = "assistant"): ChainRow => ({
  uuid,
  parentUuid: parent,
  type,
});

/**
 * /rewind leaves the abandoned attempt in the file. Rendering records in file
 * order therefore shows work that was taken back as if it had happened — in a
 * sample of 198 branched sessions, every single one contained such content, and
 * 18 of them were more than 80% abandoned.
 */
describe("markSuperseded", () => {
  test("a straight conversation has nothing superseded", () => {
    const superseded = markSuperseded([row("a", null, "user"), row("b", "a"), row("c", "b", "user")]);
    expect(superseded.size).toBe(0);
  });

  test("the branch that does not lead to the final record is superseded", () => {
    // a → b (abandoned) and a → c → d (kept)
    const superseded = markSuperseded([
      row("a", null, "user"),
      row("b", "a"),
      row("c", "a"),
      row("d", "c", "user"),
    ]);
    expect([...superseded]).toEqual(["b"]);
  });

  test("everything hanging off an abandoned branch is superseded too", () => {
    const superseded = markSuperseded([
      row("a", null, "user"),
      row("b", "a"),
      row("b2", "b"),
      row("b3", "b2"),
      row("c", "a"),
      row("d", "c", "user"),
    ]);
    expect([...superseded].sort()).toEqual(["b", "b2", "b3"]);
  });

  test("auxiliary records attached to a live message are not abandoned", () => {
    // attachments hang off the same parent as the continuation; treating them
    // as a competing branch would flag most of a transcript
    const superseded = markSuperseded([
      row("a", null, "user"),
      row("att", "a", "attachment"),
      row("b", "a"),
      row("c", "b", "user"),
    ]);
    expect(superseded.has("att")).toBe(false);
  });

  test("a chain broken by a missing parent marks nothing rather than everything", () => {
    // resumed and compacted sessions reference uuids that are not in this file;
    // walking up from the last record stops early and would otherwise declare
    // the whole transcript abandoned
    const superseded = markSuperseded([
      row("orphan", "not-in-file", "user"),
      row("x", "orphan"),
      row("y", "x", "user"),
    ]);
    expect(superseded.size).toBe(0);
  });

  test("an empty session is handled", () => {
    expect(markSuperseded([]).size).toBe(0);
  });

  test("records without a uuid are ignored rather than crashing", () => {
    const superseded = markSuperseded([row("", null), row("a", null, "user"), row("b", "a", "user")]);
    expect(superseded.size).toBe(0);
  });
});

describe("recomputeSuperseded", () => {
  test("writes the flag for one session without touching another", () => {
    const db = openDb(":memory:");
    applyMigrations(db);
    const add = (sid: string, uuid: string, parent: string | null, seq: number, type = "assistant") =>
      db
        .prepare(
          "INSERT INTO messages (session_id, uuid, parent_uuid, seq, byte_offset, byte_len, type) VALUES (?,?,?,?,0,0,?)",
        )
        .run(sid, uuid, parent, seq, type);

    add("s1", "a", null, 0, "user");
    add("s1", "b", "a", 1); // abandoned
    add("s1", "c", "a", 2);
    add("s1", "d", "c", 3, "user");
    add("s2", "x", null, 0, "user");
    add("s2", "y", "x", 1, "user");

    recomputeSuperseded(db, "s1");

    const flagged = db
      .prepare("SELECT uuid FROM messages WHERE superseded = 1 ORDER BY uuid")
      .all() as Array<{ uuid: string }>;
    expect(flagged.map((r) => r.uuid)).toEqual(["b"]);
    db.close();
  });

  test("re-running after the session grows moves the flag", () => {
    const db = openDb(":memory:");
    applyMigrations(db);
    const add = (uuid: string, parent: string | null, seq: number, type = "user") =>
      db
        .prepare(
          "INSERT INTO messages (session_id, uuid, parent_uuid, seq, byte_offset, byte_len, type) VALUES ('s',?,?,?,0,0,?)",
        )
        .run(uuid, parent, seq, type);

    add("a", null, 0);
    add("b", "a", 1);
    recomputeSuperseded(db, "s");
    expect(db.prepare("SELECT COUNT(*) n FROM messages WHERE superseded = 1").get()).toEqual({ n: 0 });

    // the conversation is rewound: a new child of 'a' becomes the live end
    add("c", "a", 2);
    recomputeSuperseded(db, "s");
    const flagged = db.prepare("SELECT uuid FROM messages WHERE superseded = 1").all() as Array<{ uuid: string }>;
    expect(flagged.map((r) => r.uuid)).toEqual(["b"]);
    db.close();
  });
});

describe("a file that holds several conversations", () => {
  test("/clear starts a new tree; the earlier conversation is history, not an abandoned branch", () => {
    // one session file can contain many root records — each /clear begins a
    // fresh tree. Judging every record against the LAST tree's chain would bury
    // completed earlier conversations as if they had been rewound away.
    const superseded = markSuperseded([
      row("a1", null, "user"),
      row("a2", "a1"),
      row("a3", "a2", "user"),
      row("b1", null, "user"), // /clear
      row("b2", "b1"),
    ]);
    expect(superseded.size).toBe(0);
  });

  test("a rewind inside an earlier tree is still caught", () => {
    const superseded = markSuperseded([
      row("a1", null, "user"),
      row("a2", "a1"), // abandoned within tree A
      row("a3", "a1"),
      row("a4", "a3", "user"),
      row("b1", null, "user"), // /clear
      row("b2", "b1"),
    ]);
    expect([...superseded]).toEqual(["a2"]);
  });

  test("each tree is judged by its own last record", () => {
    const superseded = markSuperseded([
      row("a1", null, "user"),
      row("a2", "a1"),
      row("b1", null, "user"),
      row("b2", "b1"), // abandoned within tree B
      row("b3", "b1"),
      row("b4", "b3", "user"),
    ]);
    expect([...superseded]).toEqual(["b2"]);
  });
});
