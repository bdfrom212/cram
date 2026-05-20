-- Migration: add research columns to contacts table
-- research_summary is written by the Diana researcher agent via components/ResearchSection.tsx
-- (PUT /api/contacts/[id] with { research_summary, last_researched_at }).
-- last_researched_at is read by grace-context.ts to surface contacts on upcoming events
-- who haven't been researched in 90+ days.

ALTER TABLE contacts
  ADD COLUMN research_summary   TEXT,
  ADD COLUMN last_researched_at TIMESTAMPTZ;

-- Index to support the grace-context.ts query that finds unresearched contacts:
--   WHERE last_researched_at IS NULL OR last_researched_at < CURRENT_DATE - INTERVAL '90 days'
CREATE INDEX contacts_last_researched_idx ON contacts (last_researched_at);
