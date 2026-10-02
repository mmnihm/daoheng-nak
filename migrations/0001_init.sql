-- 备份机器人索引表
CREATE TABLE IF NOT EXISTS backups (
  id            TEXT PRIMARY KEY,            -- 本地短 ID
  backup_chat_id    INTEGER NOT NULL,        -- 备份频道 Chat ID
  backup_message_id INTEGER NOT NULL,        -- 备份频道中的消息 ID
  source_chat_id    INTEGER,                 -- 来源对话 Chat ID
  source_message_id INTEGER,                -- 来源消息 ID
  sender_id         INTEGER,                 -- 发送者 User ID
  sender_name       TEXT,                    -- 发送者显示名
  type              TEXT NOT NULL,           -- text|document|photo|video|audio|voice|animation|sticker
  file_unique_id    TEXT,                    -- Telegram 文件唯一标识（去重用）
  file_name         TEXT,                    -- 文件名
  mime_type         TEXT,
  file_size         INTEGER,
  caption           TEXT,                    -- 文字说明 / 文本内容
  created_at        TEXT NOT NULL,           -- 归档时间 ISO
  UNIQUE(backup_chat_id, backup_message_id)
);

CREATE INDEX IF NOT EXISTS idx_backups_created ON backups(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backups_type ON backups(type);
CREATE INDEX IF NOT EXISTS idx_backups_file_unique ON backups(file_unique_id);
CREATE INDEX IF NOT EXISTS idx_backups_sender ON backups(sender_id);
