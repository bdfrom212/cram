-- Migration: create commitments table
-- Used by lib/agents/grace-context.ts (reads open commitments for Grace's brief)
-- and app/api/agents/grace/route.ts PATCH handler (add / complete / dismiss).
-- Both contact_id and event_id are nullable — a commitment may relate to neither,
-- one, or both. ON DELETE SET NULL preserves the commitment record if the related
-- contact or event is removed.

CREATE TABLE commitments (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  body          TEXT        NOT NULL,
  source        TEXT,                          -- e.g. 'grace', 'manual', email thread id
  status        TEXT        NOT NULL DEFAULT 'open'
                            CHECK (status IN ('open', 'done', 'dismissed')),
  due_date      DATE,
  contact_id    UUID        REFERENCES contacts(id) ON DELETE SET NULL,
  event_id      UUID        REFERENCES events(id)   ON DELETE SET NULL,
  completed_at  TIMESTAMPTZ,                   -- set when status transitions to 'done'
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- Index for the primary read: all open commitments ordered by age (grace-context.ts, GET route)
CREATE INDEX commitments_open_idx ON commitments (status, created_at ASC) WHERE status = 'open';

-- Auto-update updated_at (reuses the function created in schema.sql)
CREATE TRIGGER commitments_updated_at
  BEFORE UPDATE ON commitments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS: enable and allow all ops for authenticated users (matches existing pattern)
ALTER TABLE commitments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth users full access" ON commitments
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
