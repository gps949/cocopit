-- Codex support: sessions/usage inherit the product through their project.
-- Codex project dir_names are prefixed "codex:" so a Claude project over the
-- same cwd cannot collide inside the (profile_id, dir_name) unique key.
ALTER TABLE projects ADD COLUMN product TEXT NOT NULL DEFAULT 'claude';
CREATE INDEX idx_projects_product ON projects(product);

ALTER TABLE prompt_history ADD COLUMN product TEXT NOT NULL DEFAULT 'claude';

-- usage_events carries product directly: dashboard aggregations run on a
-- covering index, and forcing a sessions+projects join onto every one of them
-- just to learn the product would reopen the 86 MB random-read problem the
-- covering index exists to close. The index gains product as its leading
-- column, so per-product range scans stay covering.
ALTER TABLE usage_events ADD COLUMN product TEXT NOT NULL DEFAULT 'claude';
DROP INDEX IF EXISTS idx_usage_ts;
CREATE INDEX idx_usage_ts ON usage_events(
  product, ts, session_id, model, cost_usd,
  input_tokens, output_tokens,
  cache_read_tokens, cache_w5m_tokens, cache_w1h_tokens,
  web_search_requests
);
