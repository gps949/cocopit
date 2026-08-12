import type { Database } from "bun:sqlite";

export interface ChainRow {
  uuid: string;
  parentUuid: string | null;
  type: string;
}

/** Records that carry the conversation itself, as opposed to bookkeeping. */
const CONVERSATION = new Set(["user", "assistant"]);

/**
 * Which records were taken back by a rewind.
 *
 * `/rewind` does not delete anything: the abandoned attempt stays in the file
 * and the replacement is written as a second child of the same parent. Read in
 * file order — which is how a transcript is read — the two are indistinguishable
 * from a conversation that really went both ways.
 *
 * The conversation as it finally stood is the chain from the last conversation
 * record back to the root; conversation records off that chain were superseded.
 * Auxiliary records (attachments, hooks, system notes) hang off the same parents
 * without competing with them, so they are never marked.
 *
 * Two cases deliberately mark nothing: a session with no branches, and one whose
 * chain runs into a parent that is not in this file. The latter happens after
 * `/compact` or when a session continues an earlier one, and walking up stops
 * early — believing that result would condemn the entire transcript.
 */
export function markSuperseded(rows: ChainRow[]): Set<string> {
  const byUuid = new Map<string, ChainRow>();
  for (const row of rows) if (row.uuid) byUuid.set(row.uuid, row);

  const conversation = rows.filter((row) => row.uuid && CONVERSATION.has(row.type));
  if (conversation.length === 0) return new Set();

  // One file can hold several conversations: /clear starts a fresh tree in the
  // same session, so a record's root — not the file — is what it competes
  // within. Judging everything against the last tree would bury completed
  // earlier conversations as though they had been rewound away.
  const rootOf = new Map<string, string>();
  const findRoot = (row: ChainRow): string | null => {
    const path: ChainRow[] = [];
    let cursor: ChainRow | undefined = row;
    const seen = new Set<string>();
    while (cursor) {
      const cached = rootOf.get(cursor.uuid);
      if (cached) {
        for (const step of path) rootOf.set(step.uuid, cached);
        return cached;
      }
      if (seen.has(cursor.uuid)) return null; // cycle: refuse to guess
      seen.add(cursor.uuid);
      path.push(cursor);
      if (!cursor.parentUuid) {
        for (const step of path) rootOf.set(step.uuid, cursor.uuid);
        return cursor.uuid;
      }
      const parent: ChainRow | undefined = byUuid.get(cursor.parentUuid);
      if (!parent) return null; // dangling (resumed or compacted): unknowable
      cursor = parent;
    }
    return null;
  };

  const lastOfTree = new Map<string, ChainRow>();
  for (const row of conversation) {
    const root = findRoot(row);
    if (root === null) return new Set(); // any dangling chain: mark nothing
    lastOfTree.set(root, row); // conversation is in file order, so this ends up last
  }

  const live = new Set<string>();
  for (const last of lastOfTree.values()) {
    let cursor: ChainRow | undefined = last;
    while (cursor) {
      if (live.has(cursor.uuid)) break;
      live.add(cursor.uuid);
      if (!cursor.parentUuid) break;
      cursor = byUuid.get(cursor.parentUuid);
    }
  }

  const superseded = new Set<string>();
  for (const row of conversation) if (!live.has(row.uuid)) superseded.add(row.uuid);
  return superseded;
}

/**
 * Recomputes and stores the flag for one session. Called after each ingest of
 * that session's file: appending records can move the live end, so a record
 * that was superseded may become live again (and vice versa) as the file grows.
 */
export function recomputeSuperseded(db: Database, sessionId: string): void {
  const rows = db
    .prepare(
      `SELECT uuid, parent_uuid AS parentUuid, type FROM messages
       WHERE session_id = $id AND uuid IS NOT NULL AND uuid <> '' ORDER BY seq`,
    )
    .all({ $id: sessionId }) as ChainRow[];

  const superseded = markSuperseded(rows);
  db.prepare("UPDATE messages SET superseded = 0 WHERE session_id = $id AND superseded = 1").run({
    $id: sessionId,
  });
  if (superseded.size === 0) return;

  const mark = db.prepare("UPDATE messages SET superseded = 1 WHERE session_id = $id AND uuid = $uuid");
  for (const uuid of superseded) mark.run({ $id: sessionId, $uuid: uuid });
}
