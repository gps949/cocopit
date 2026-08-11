import type { Database } from "bun:sqlite";

/**
 * Reads the usage table once at startup so the dashboard doesn't.
 *
 * Every dashboard query aggregates the same table — 86 MB and ~480k rows on a
 * heavy history. Warm, each answers in well under 100 ms; cold, the first one
 * pays the whole read and the dashboard hangs for seconds. Nothing is cached in
 * process (the numbers must stay live as the index grows); this just makes the
 * OS page cache hold the pages before a person is waiting on them.
 */
export function warmUsageCache(db: Database): void {
  // deliberately off the critical path — a slow disk must not delay serving
  setTimeout(() => {
    try {
      const started = Date.now();
      db.prepare(
        `SELECT COUNT(*) AS n, SUM(cost_usd), SUM(input_tokens), SUM(output_tokens),
                SUM(cache_read_tokens), SUM(cache_w5m_tokens), SUM(cache_w1h_tokens)
         FROM usage_events`,
      ).get();
      // the by-project shape walks usage → sessions → projects one row at a
      // time; those lookups are the slowest thing on the dashboard when cold,
      // and they miss entirely if only the usage table is warmed
      db.prepare(
        `SELECT p.id, SUM(u.cost_usd) FROM usage_events u
         JOIN sessions s ON s.id = u.session_id
         JOIN projects p ON p.id = s.project_id
         GROUP BY p.id`,
      ).all();
      const elapsed = Date.now() - started;
      if (elapsed > 500) console.log(`usage table warmed in ${(elapsed / 1000).toFixed(1)}s`);
    } catch {
      // warming is an optimization; a failure here must never break startup
    }
  }, 0);
}
