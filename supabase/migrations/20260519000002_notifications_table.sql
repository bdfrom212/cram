-- Notifications for research completion and other async events

CREATE TABLE notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  contact_ids UUID[] DEFAULT '{}',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  action_url TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth users full access" ON notifications FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Index for unread notifications, ordered by most recent
CREATE INDEX notifications_unread_idx ON notifications(read_at, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX notifications_event_idx ON notifications(event_id);
