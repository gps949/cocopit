-- Two session files can contain the same conversation records: one is a branch
-- of the other continued separately. Shown as unrelated sessions, that is a
-- false picture of the history.
--
-- The relationship is stored symmetrically. The obvious column name would be
-- fork_parent_session_id, but "parent" is a claim about direction that the data
-- does not support — both sides carry the same first timestamp, and neither is
-- marked as derived. Dropping that never-populated column rather than filling
-- it with a guess.
CREATE TABLE IF NOT EXISTS session_links (
  session_id         TEXT NOT NULL,
  related_session_id TEXT NOT NULL,
  shared_records     INTEGER NOT NULL,
  PRIMARY KEY (session_id, related_session_id)
);
CREATE INDEX IF NOT EXISTS idx_session_links ON session_links(session_id);
ALTER TABLE sessions DROP COLUMN fork_parent_session_id;
