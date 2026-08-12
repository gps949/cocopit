-- Codex multi-agent runs: a subagent's rollout is a full session file whose
-- session_meta names the parent thread and the agent's nickname. Persisting
-- both lets the link table survive its wholesale rebuilds, and lets the
-- session list fold agent children out of the way by default.
ALTER TABLE sessions ADD COLUMN parent_session_id TEXT;
ALTER TABLE sessions ADD COLUMN agent_label TEXT;
CREATE INDEX idx_sessions_parent ON sessions(parent_session_id) WHERE parent_session_id IS NOT NULL;
