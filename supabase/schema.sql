-- Run this in the Supabase SQL editor to create the schema

CREATE TABLE contacts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  company TEXT,
  role TEXT CHECK (role IN ('planner', 'client', 'vendor')) DEFAULT 'planner',
  email TEXT,
  phone TEXT,
  website TEXT,
  instagram TEXT,
  photo_url TEXT,
  action_items TEXT,
  personal_notes TEXT,
  last_contact_date DATE,
  gmail_sync_enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT,  -- couple names e.g. "Smith/Jones"
  date DATE NOT NULL,
  venue_name TEXT,
  venue_city TEXT,
  venue_state TEXT,
  notes TEXT,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE event_contacts (
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  role TEXT CHECK (role IN ('planner', 'client', 'coordinator', 'vendor')) DEFAULT 'planner',
  PRIMARY KEY (event_id, contact_id)
);

CREATE TABLE key_people (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  title TEXT,
  email TEXT,
  notes TEXT
);

CREATE TABLE email_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  gmail_thread_id TEXT,
  subject TEXT,
  last_message_at TIMESTAMPTZ,
  snippet TEXT,
  direction TEXT CHECK (direction IN ('inbound', 'outbound'))
);

CREATE TABLE notes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER contacts_updated_at BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER events_updated_at BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Full-text search index on contacts
CREATE INDEX contacts_search_idx ON contacts
  USING GIN (to_tsvector('english', coalesce(name,'') || ' ' || coalesce(company,'') || ' ' || coalesce(email,'')));

-- Full-text search index on events
CREATE INDEX events_search_idx ON events
  USING GIN (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(venue_name,'') || ' ' || coalesce(venue_city,'') || ' ' || coalesce(venue_state,'')));

-- RLS: enable and allow all ops for authenticated users (single-user app)
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE key_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth users full access" ON contacts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth users full access" ON events FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth users full access" ON event_contacts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth users full access" ON key_people FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth users full access" ON email_log FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth users full access" ON notes FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Storage bucket for contact photos (run in Supabase dashboard or via API)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('photos', 'photos', true);
-- CREATE POLICY "auth users full access" ON storage.objects FOR ALL TO authenticated USING (bucket_id = 'photos') WITH CHECK (bucket_id = 'photos');
