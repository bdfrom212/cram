-- Migration: add inquiry stage tracking to events
-- Events can now be inquiry, booked, or completed
-- Inquiries are VSCO leads/inquiry stage jobs awaiting research and response

ALTER TABLE events
  ADD COLUMN stage TEXT NOT NULL DEFAULT 'booked'
    CHECK (stage IN ('inquiry', 'booked', 'completed'));

-- Index for filtering inquiry events
CREATE INDEX events_stage_idx ON events(stage);
