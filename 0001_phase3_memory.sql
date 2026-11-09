-- JARVIS Phase 3: conversation history and long-term memory (Cloudflare D1 / SQLite).
-- Safe to run more than once (IF NOT EXISTS). Phase 2 had no database, so nothing is duplicated.

CREATE TABLE IF NOT EXISTS conversations (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  created_at INTEGER NOT NULL,  -- unix milliseconds
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations (updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT NOT NULL,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS memories (
  id         TEXT PRIMARY KEY,
  category   TEXT NOT NULL CHECK (category IN ('preference', 'fact', 'project', 'goal', 'instruction', 'decision')),
  content    TEXT NOT NULL,
  keywords   TEXT NOT NULL DEFAULT '',   -- space-separated lowercase words, used for retrieval
  source     TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'explicit', 'suggested')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memories_category ON memories (category, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_updated ON memories (updated_at DESC);
