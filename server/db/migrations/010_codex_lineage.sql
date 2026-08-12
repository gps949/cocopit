-- Codex session lineage: session_meta carries both this rollout's id and the
-- logical thread's session_id — resuming opens a NEW file under the SAME
-- thread (294 of 492 files here are continuations), and forks name their
-- source outright in forked_from_id. Persisted so the link rebuild can chain
-- a thread's files and point forks at their origin.
ALTER TABLE sessions ADD COLUMN thread_id TEXT;
ALTER TABLE sessions ADD COLUMN forked_from TEXT;
CREATE INDEX idx_sessions_thread ON sessions(thread_id) WHERE thread_id IS NOT NULL;
