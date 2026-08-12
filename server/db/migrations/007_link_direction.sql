-- Direction is determinable after all, and the evidence is unambiguous: in both
-- real pairs the shorter session's conversation records are ALL present in the
-- longer one (zero records of its own), with identical timestamps, and the
-- longer one's additional records begin after the shorter one's last. One
-- session was continued as the other.
--
-- `role` says what the RELATED session is to this one: parent, child, or
-- related when neither contains the other.
ALTER TABLE session_links ADD COLUMN role TEXT NOT NULL DEFAULT 'related';
