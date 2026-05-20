-- Grace chat tables: sessions, messages, and operations log
-- This enables Grace (the Chief of Staff agent) to maintain conversation history
-- and track all data modifications for audit and undo capability.

CREATE TABLE chat_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_message_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE chat_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID REFERENCES chat_sessions(id) ON DELETE CASCADE NOT NULL,
  role TEXT CHECK (role IN ('user', 'assistant')) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE operations_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  agent TEXT,
  operation_type TEXT,
  entity_type TEXT,
  entity_id UUID,
  before_state JSONB,
  after_state JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  undone_at TIMESTAMPTZ
);

-- Enable RLS
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_log ENABLE ROW LEVEL SECURITY;

-- RLS Policies: authenticated users access only their own records
CREATE POLICY "auth users own sessions" ON chat_sessions FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "auth users own messages" ON chat_messages FOR ALL TO authenticated USING (
  session_id IN (SELECT id FROM chat_sessions WHERE user_id = auth.uid())
) WITH CHECK (
  session_id IN (SELECT id FROM chat_sessions WHERE user_id = auth.uid())
);
CREATE POLICY "auth users own operations log" ON operations_log FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Indexes for faster queries
CREATE INDEX chat_sessions_user_id_idx ON chat_sessions(user_id);
CREATE INDEX chat_sessions_last_message_at_idx ON chat_sessions(last_message_at DESC);
CREATE INDEX chat_messages_session_id_idx ON chat_messages(session_id);
CREATE INDEX operations_log_user_id_idx ON operations_log(user_id);
CREATE INDEX operations_log_entity_idx ON operations_log(entity_type, entity_id);
CREATE INDEX operations_log_created_at_idx ON operations_log(created_at DESC);
