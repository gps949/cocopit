import type { Database } from "bun:sqlite";

/**
 * Fewer shared records than this is coincidence, not a shared history — a
 * handful of identical bookkeeping uuids can turn up between unrelated files.
 */
const MIN_SHARED = 3;

interface Overlap {
  a: string;
  b: string;
  shared: number;
}

/**
 * Finds sessions whose files hold the same conversation records, and which way
 * the relationship runs.
 *
 * Continuing a conversation in a new session copies what came before, uuids and
 * timestamps intact, so overlap on user/assistant uuids identifies the pair.
 * Direction follows from containment: the session with no conversation records
 * of its own is the one that was continued — in both real pairs here it stops
 * at the moment the other picks up. When each side has records the other lacks,
 * nothing is claimed.
 *
 * Cheap to recompute wholesale, so it runs after a scan rather than being
 * maintained incrementally.
 */
export function rebuildSessionLinks(db: Database): void {
  db.run("DELETE FROM session_links");

  const overlaps = db
    .prepare(
      `SELECT a.session_id AS a, b.session_id AS b, COUNT(*) AS shared
       FROM messages a
       JOIN messages b ON a.uuid = b.uuid AND a.session_id < b.session_id
       WHERE a.uuid IS NOT NULL AND a.uuid <> ''
         AND a.type IN ('user','assistant') AND b.type IN ('user','assistant')
       GROUP BY a.session_id, b.session_id
       HAVING COUNT(*) >= ${MIN_SHARED}`,
    )
    .all() as Overlap[];
  if (overlaps.length === 0) return;

  const convCount = db.prepare(
    `SELECT COUNT(*) AS n FROM messages
     WHERE session_id = $id AND type IN ('user','assistant') AND uuid IS NOT NULL AND uuid <> ''`,
  );
  const sizeOf = new Map<string, number>();
  const size = (id: string): number => {
    let n = sizeOf.get(id);
    if (n === undefined) {
      n = (convCount.get({ $id: id }) as { n: number }).n;
      sizeOf.set(id, n);
    }
    return n;
  };

  const insert = db.prepare(
    "INSERT INTO session_links (session_id, related_session_id, shared_records, role) VALUES (?,?,?,?)",
  );
  for (const { a, b, shared } of overlaps) {
    const aWhole = size(a) === shared;
    const bWhole = size(b) === shared;
    // both wholly contained means they are the same conversation twice, which
    // says nothing about which came first
    const aIsParent = aWhole && !bWhole;
    const bIsParent = bWhole && !aWhole;

    insert.run(a, b, shared, bIsParent ? "parent" : aIsParent ? "child" : "related");
    insert.run(b, a, shared, aIsParent ? "parent" : bIsParent ? "child" : "related");
  }
}
