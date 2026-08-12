import type { Database } from "bun:sqlite";

/**
 * Fewer shared records than this is coincidence, not a shared history — a
 * handful of identical bookkeeping uuids can turn up between unrelated files.
 */
const MIN_SHARED = 3;

/**
 * Finds sessions whose files hold the same conversation records.
 *
 * A branch continued as its own session copies the records it inherited, uuids
 * and all, so overlap on user/assistant uuids is what identifies the pair.
 * Only conversation records count: attachments and system notes are shared
 * freely without implying any relationship.
 *
 * Cheap to recompute wholesale (one grouped self-join over the uuid index), so
 * it runs after a scan rather than being maintained incrementally.
 */
export function rebuildSessionLinks(db: Database): void {
  db.run("DELETE FROM session_links");
  db.run(
    `INSERT INTO session_links (session_id, related_session_id, shared_records)
     SELECT a.session_id, b.session_id, COUNT(*)
     FROM messages a
     JOIN messages b ON a.uuid = b.uuid AND a.session_id <> b.session_id
     WHERE a.uuid IS NOT NULL AND a.uuid <> ''
       AND a.type IN ('user','assistant') AND b.type IN ('user','assistant')
     GROUP BY a.session_id, b.session_id
     HAVING COUNT(*) >= ${MIN_SHARED}`,
  );
}
