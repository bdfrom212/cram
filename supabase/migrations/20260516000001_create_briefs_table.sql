-- Migration: create briefs table
-- Used by lib/agents/store.ts to persist agent-generated output (briefs).
-- event_id is nullable so Grace's general briefs (no specific event) can be stored.

CREATE TABLE briefs (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id    UUID        REFERENCES events(id) ON DELETE CASCADE,
  agent       TEXT        NOT NULL,
  content     TEXT        NOT NULL,
  model       TEXT,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Index for the most common access pattern: latest brief per event+agent
CREATE INDEX briefs_event_agent_idx ON briefs (event_id, agent, created_at DESC);

-- Index for general (event-less) briefs: latest per agent where event_id IS NULL
CREATE INDEX briefs_general_agent_idx ON briefs (agent, created_at DESC) WHERE event_id IS NULL;

-- RLS: enable and allow all ops for authenticated users (single-user app, matches existing pattern)
ALTER TABLE briefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth users full access" ON briefs
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
