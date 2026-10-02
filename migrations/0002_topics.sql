-- 话题支持：为 backups 增加话题字段，并新建 topics 映射表。
-- 注意：ALTER TABLE ADD COLUMN 不可重复执行，本迁移仅运行一次。

ALTER TABLE backups ADD COLUMN backup_thread_id INTEGER;
ALTER TABLE backups ADD COLUMN source_thread_id INTEGER;
ALTER TABLE backups ADD COLUMN topic_name TEXT;

CREATE INDEX IF NOT EXISTS idx_backups_thread ON backups(source_thread_id);

CREATE TABLE IF NOT EXISTS topics (
  source_chat_id    INTEGER NOT NULL,
  source_thread_id  INTEGER NOT NULL,
  topic_name        TEXT,
  backup_thread_id  INTEGER,
  backup_topic_id   INTEGER,
  created_at        TEXT NOT NULL,
  updated_at        TEXT,
  PRIMARY KEY (source_chat_id, source_thread_id)
);

CREATE INDEX IF NOT EXISTS idx_topics_backup ON topics(backup_thread_id);
