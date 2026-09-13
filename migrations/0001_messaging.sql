-- Base schema for @agilesyndrome/cf-genai-messaging.
CREATE TABLE IF NOT EXISTS messaging_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  context TEXT NOT NULL UNIQUE,
  title TEXT,
  created_by_type TEXT,
  created_by_key TEXT,
  created_by_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messaging_conversation_participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES messaging_conversations(id) ON DELETE CASCADE,
  participant_type TEXT NOT NULL,
  participant_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(conversation_id, participant_type, participant_key)
);

CREATE TABLE IF NOT EXISTS messaging_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES messaging_conversations(id) ON DELETE CASCADE,
  context TEXT NOT NULL,
  sender_type TEXT NOT NULL,
  sender_key TEXT,
  sender_name TEXT NOT NULL,
  body TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text',
  response_type TEXT,
  audience_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_messaging_conversations_context
  ON messaging_conversations(context);
CREATE INDEX IF NOT EXISTS idx_messaging_messages_thread
  ON messaging_messages(conversation_id, id);
