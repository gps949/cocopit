-- A project's working directory was whatever cwd the most recently scanned
-- session happened to record, so one session that had cd'd into a subdirectory
-- renamed the whole project — and made two storage directories look like two
-- projects sharing one path. Keep cwd per session instead; the project's
-- directory is then the one most of its sessions actually used.
ALTER TABLE sessions ADD COLUMN cwd TEXT;
CREATE INDEX IF NOT EXISTS idx_sessions_cwd ON sessions(cwd);
