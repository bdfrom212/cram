-- Store VSCO job ID for future contact refetching (separate from Tave job ID)
ALTER TABLE events
  ADD COLUMN vsco_id TEXT;

-- Index for looking up by VSCO ID
CREATE INDEX events_vsco_id_idx ON events(vsco_id);
