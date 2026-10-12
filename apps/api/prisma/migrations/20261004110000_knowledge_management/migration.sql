CREATE TABLE knowledge_bases (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'LOCAL',
 mounted BOOLEAN NOT NULL DEFAULT false, agent_id TEXT, connection JSONB, password_encrypted TEXT,
 last_sync_at TIMESTAMP(3), sync_status TEXT NOT NULL DEFAULT 'IDLE', sync_error TEXT,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL
);
CREATE TABLE knowledge_entries (
 id TEXT PRIMARY KEY, base_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
 external_key TEXT, title TEXT NOT NULL, question TEXT NOT NULL DEFAULT '', question_key TEXT NOT NULL,
 answer TEXT NOT NULL, aliases JSONB NOT NULL DEFAULT '[]', url TEXT NOT NULL DEFAULT '', mode TEXT NOT NULL DEFAULT 'RAG',
 status TEXT NOT NULL DEFAULT 'DRAFT', priority INTEGER NOT NULL DEFAULT 50, source TEXT NOT NULL DEFAULT '',
 source_message_id TEXT, reviewed_by_id TEXT, hit_count INTEGER NOT NULL DEFAULT 0,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX knowledge_entries_base_id_question_key_key ON knowledge_entries(base_id, question_key);
CREATE UNIQUE INDEX knowledge_entries_base_id_external_key_key ON knowledge_entries(base_id, external_key);
CREATE INDEX knowledge_entries_status_mode_idx ON knowledge_entries(status, mode);
CREATE TABLE knowledge_revisions (
 id TEXT PRIMARY KEY, entry_id TEXT NOT NULL REFERENCES knowledge_entries(id) ON DELETE CASCADE,
 snapshot JSONB NOT NULL, operator_id TEXT NOT NULL, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX knowledge_revisions_entry_id_created_at_idx ON knowledge_revisions(entry_id, created_at);
ALTER TABLE message_feedback ADD COLUMN resolution TEXT NOT NULL DEFAULT 'OPEN',
 ADD COLUMN resolved_by_id TEXT, ADD COLUMN resolution_note TEXT,
 ADD COLUMN updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE agent_learnings ADD COLUMN candidate_key TEXT, ADD COLUMN fixed_entry_id TEXT;
CREATE UNIQUE INDEX agent_learnings_agent_id_candidate_key_key ON agent_learnings(agent_id,candidate_key);
CREATE TABLE learning_feedback_links (
 learning_id TEXT NOT NULL REFERENCES agent_learnings(id) ON DELETE CASCADE,
 feedback_id TEXT NOT NULL REFERENCES message_feedback(id) ON DELETE CASCADE, user_id TEXT NOT NULL,
 PRIMARY KEY (learning_id,feedback_id)
);
