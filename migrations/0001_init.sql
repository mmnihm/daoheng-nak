-- 备份机器人基础表
CREATE TABLE IF NOT EXISTS backups (
  id            TEXT PRIMARY KEY,
  backup_chat_id    INTEGER NOT NULL,
  backup_message_id INTEGER NOT NULL,
  source_chat_id    INTEGER,
  source_message_id INTEGER,
  sender_id         INTEGER,
  sender_name       TEXT,
  type              TEXT NOT NULL,
  file_unique_id    TEXT,
  file_name         TEXT,
  mime_type         TEXT,
  file_size         INTEGER,
  caption           TEXT,
  created_at        TEXT NOT NULL,
  UNIQUE(backup_chat_id, backup_message_id)
);

CREATE INDEX IF NOT EXISTS idx_backups_created ON backups(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backups_type ON backups(type);
CREATE INDEX IF NOT EXISTS idx_backups_file_unique ON backups(file_unique_id);
CREATE INDEX IF NOT EXISTS idx_backups_sender ON backups(sender_id);
