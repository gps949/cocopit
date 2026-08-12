-- /rewind leaves the abandoned attempt in the file, so a transcript read in
-- file order shows work that was taken back as if it had happened. Marking
-- those records lets the reader hide them (and keeps them out of the outline)
-- without discarding anything.
ALTER TABLE messages ADD COLUMN superseded INTEGER NOT NULL DEFAULT 0;
