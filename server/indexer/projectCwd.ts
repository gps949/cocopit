import type { Database } from "bun:sqlite";

/**
 * Sets each project's working directory to the one its sessions actually used.
 *
 * Claude Code names a storage directory after where it was launched, but every
 * session records its own cwd, and a single session that cd'd elsewhere used to
 * rename the whole project — which is how one directory came to appear twice in
 * the project list. Taking the most common cwd makes the label reflect the
 * project instead of the last file scanned; ties break on the path itself so
 * repeated scans don't flap.
 */
export function reconcileProjectCwd(db: Database): void {
  db.run(`
    UPDATE projects SET cwd = COALESCE(
      (SELECT s.cwd FROM sessions s
        WHERE s.project_id = projects.id AND s.cwd IS NOT NULL
        GROUP BY s.cwd
        ORDER BY COUNT(*) DESC, s.cwd ASC
        LIMIT 1),
      projects.cwd)
  `);
}
