-- 备份机器人索引表
CREATE TABLE IF NOT EXISTS backups (
  id            TEXT PRIMARY KEY,            -- 本地短 ID
  backup_chat_id    INTEGER NOT NULL,        -- 备份频道 Chat ID
  backup_message_id INTEGER NOT NULL,        -- 备份频道中的消息 ID
  backup_thread_id  INTEGER,                 -- 备份频道中的话题 thread id
  source_chat_id    INTEGER,                 -- 来源对话 Chat ID
  source_message_id INTEGER,                -- 来源消息 ID
  source_thread_id  INTEGER,                -- 来源话题 thread id
  sender_id         INTEGER,                 -- 发送者 User ID
  sender_name       TEXT,                    -- 发送者显示名
  type              TEXT NOT NULL,           -- text|document|photo|video|audio|voice|animation|sticker|topic_created|topic_edited
  file_unique_id    TEXT,                    -- Telegram 文件唯一标识（去重用）
  file_name         TEXT,                    -- 文件名
  mime_type         TEXT,
  file_size         INTEGER,
  caption           TEXT,                    -- 文字说明 / 文本内容
  topic_name        TEXT,                    -- 来源话题名
  created_at        TEXT NOT NULL,           -- 归档时间 ISO
  UNIQUE(backup_chat_id, backup_message_id)
);

-- 话题映射表：来源话题 -> 备份频道话题
CREATE TABLE IF NOT EXISTS topics (
  source_chat_id    INTEGER NOT NULL,
  source_thread_id  INTEGER NOT NULL,
  topic_name        TEXT,                    -- 来源话题名（来自 forum_topic_created）
  backup_thread_id  INTEGER,                 -- 备份频道中对应话题的 thread id
  backup_topic_id   INTEGER,                 -- createForumTopic 返回的 message_thread_id
  created_at        TEXT NOT NULL,
  updated_at        TEXT,
  PRIMARY KEY (source_chat_id, source_thread_id)
);

CREATE INDEX IF NOT EXISTS idx_backups_created ON backups(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backups_type ON backups(type);
CREATE INDEX IF NOT EXISTS idx_backups_file_unique ON backups(file_unique_id);
CREATE INDEX IF NOT EXISTS idx_backups_sender ON backups(sender_id);
CREATE INDEX IF NOT EXISTS idx_backups_thread ON backups(source_thread_id);
CREATE INDEX IF NOT EXISTS idx_topics_backup ON topics(backup_thread_id);
