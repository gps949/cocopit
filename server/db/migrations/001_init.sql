CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  profile_id TEXT NOT NULL DEFAULT 'default',
  dir_name TEXT NOT NULL,
  cwd TEXT,
  first_ts INTEGER, last_ts INTEGER,
  UNIQUE(profile_id, dir_name)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  file_path TEXT NOT NULL,
  file_size INTEGER DEFAULT 0,
  file_mtime_ms INTEGER DEFAULT 0,
  parsed_bytes INTEGER DEFAULT 0,
  first_ts INTEGER, last_ts INTEGER,
  title TEXT, slug TEXT, git_branch TEXT, cc_version TEXT,
  line_count INTEGER DEFAULT 0,
  user_msg_count INTEGER DEFAULT 0,
  assistant_msg_count INTEGER DEFAULT 0,
  models TEXT,
  input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
  cache_creation_tokens INTEGER DEFAULT 0, cache_read_tokens INTEGER DEFAULT 0,
  cost_usd REAL,
  subagent_count INTEGER DEFAULT 0,
  fork_parent_session_id TEXT,
  has_pr_link INTEGER DEFAULT 0
);
CREATE INDEX idx_sessions_project ON sessions(project_id, last_ts DESC);
CREATE INDEX idx_sessions_last_ts ON sessions(last_ts DESC);

CREATE TABLE messages (
  session_id TEXT NOT NULL,
  uuid TEXT NOT NULL,
  parent_uuid TEXT,
  seq INTEGER NOT NULL,
  byte_offset INTEGER NOT NULL,
  byte_len INTEGER NOT NULL,
  ts INTEGER,
  type TEXT NOT NULL,
  subtype TEXT,
  model TEXT,
  is_sidechain INTEGER DEFAULT 0,
  snippet TEXT,
  PRIMARY KEY (session_id, uuid)
) WITHOUT ROWID;
CREATE INDEX idx_messages_session_seq ON messages(session_id, seq);

CREATE TABLE usage_events (
  session_id TEXT NOT NULL,
  uuid TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'main',
  agent_id TEXT NOT NULL DEFAULT '',
  ts INTEGER NOT NULL,
  model TEXT NOT NULL,
  service_tier TEXT,
  input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  cache_w5m_tokens INTEGER DEFAULT 0, cache_w1h_tokens INTEGER DEFAULT 0,
  web_search_requests INTEGER DEFAULT 0, web_fetch_requests INTEGER DEFAULT 0,
  cost_usd REAL,
  pricing_version INTEGER,
  PRIMARY KEY (session_id, uuid, source, agent_id)
) WITHOUT ROWID;
CREATE INDEX idx_usage_ts ON usage_events(ts);
CREATE INDEX idx_usage_model_ts ON usage_events(model, ts);

CREATE TABLE subagents (
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  agent_type TEXT, description TEXT, tool_use_id TEXT, spawn_depth INTEGER,
  file_path TEXT,
  file_size INTEGER DEFAULT 0,
  file_mtime_ms INTEGER DEFAULT 0,
  parsed_bytes INTEGER DEFAULT 0,
  cost_usd REAL,
  PRIMARY KEY (session_id, agent_id)
);

CREATE TABLE tool_calls (
  session_id TEXT NOT NULL,
  uuid TEXT NOT NULL,
  ts INTEGER,
  tool_name TEXT NOT NULL,
  is_error INTEGER DEFAULT 0,
  duration_ms INTEGER
);
CREATE INDEX idx_tools_name ON tool_calls(tool_name);

CREATE TABLE prompt_history (
  ts INTEGER, project TEXT, session_id TEXT, display TEXT
);

CREATE TABLE parse_errors (
  file_path TEXT, byte_offset INTEGER, line_no INTEGER,
  error TEXT, ts INTEGER
);

CREATE VIRTUAL TABLE fts_messages USING fts5(
  content, session_id UNINDEXED, uuid UNINDEXED,
  tokenize = 'trigram'
);
