-- Every dashboard query aggregates usage_events over a time range. Indexing ts
-- alone found the rows but then read each one from the table — 86 MB of random
-- reads whose cost showed up as a multi-second dashboard whenever the page
-- cache had moved on. Carrying the aggregated columns in the index makes those
-- queries covering: SQLite answers from the index and never touches the table.
--
-- Measured on a 481k-event history: summary 821ms -> 12ms, by-project
-- 2102ms -> 22ms, for 9 MB more index (56 -> 65 MB).
DROP INDEX IF EXISTS idx_usage_ts;
CREATE INDEX idx_usage_ts ON usage_events(
  ts, session_id, model, cost_usd,
  input_tokens, output_tokens,
  cache_read_tokens, cache_w5m_tokens, cache_w1h_tokens,
  web_search_requests
);
