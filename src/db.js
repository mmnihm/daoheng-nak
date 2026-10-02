// D1 数据访问层。所有查询集中在此，便于维护。
import { log } from './logger.js';

export async function initDb(env) {
  const db = env?.DB;
  if (!db) return null;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS backups (
        id TEXT PRIMARY KEY,
        backup_chat_id INTEGER NOT NULL,
        backup_message_id INTEGER NOT NULL,
        backup_thread_id INTEGER,
        source_chat_id INTEGER,
        source_message_id INTEGER,
        source_thread_id INTEGER,
        sender_id INTEGER,
        sender_name TEXT,
        type TEXT NOT NULL,
        file_unique_id TEXT,
        file_name TEXT,
        mime_type TEXT,
        file_size INTEGER,
        caption TEXT,
        topic_name TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(backup_chat_id, backup_message_id)
      )`
    )
    .run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS topics (
        source_chat_id INTEGER NOT NULL,
        source_thread_id INTEGER NOT NULL,
        topic_name TEXT,
        backup_thread_id INTEGER,
        backup_topic_id INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT,
        PRIMARY KEY (source_chat_id, source_thread_id)
      )`
    )
    .run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_backups_created ON backups(created_at DESC)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_backups_type ON backups(type)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_backups_file_unique ON backups(file_unique_id)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_backups_sender ON backups(sender_id)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_backups_thread ON backups(source_thread_id)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_topics_backup ON topics(backup_thread_id)').run();
  return db;
}

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export async function insertBackup(db, row) {
  await db
    .prepare(
      `INSERT INTO backups
        (id, backup_chat_id, backup_message_id, backup_thread_id, source_chat_id, source_message_id,
         source_thread_id, sender_id, sender_name, type, file_unique_id, file_name, mime_type,
         file_size, caption, topic_name, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(
      row.id, row.backup_chat_id, row.backup_message_id, row.backup_thread_id ?? null,
      row.source_chat_id, row.source_message_id, row.source_thread_id ?? null,
      row.sender_id, row.sender_name, row.type, row.file_unique_id ?? null,
      row.file_name ?? null, row.mime_type ?? null, row.file_size ?? null,
      row.caption ?? null, row.topic_name ?? null, row.created_at
    )
    .run();
}

export async function findByFileUnique(db, chatId, fileUniqueId) {
  return db
    .prepare('SELECT id FROM backups WHERE backup_chat_id=? AND file_unique_id=? LIMIT 1')
    .bind(chatId, fileUniqueId)
    .first();
}

export async function listRecent(db, limit = 20, offset = 0) {
  return db
    .prepare('SELECT * FROM backups ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .bind(limit, offset)
    .all();
}

export async function searchBackups(db, keyword, limit = 20) {
  const like = `%${keyword}%`;
  return db
    .prepare(
      `SELECT * FROM backups
       WHERE file_name LIKE ? OR caption LIKE ? OR sender_name LIKE ? OR topic_name LIKE ?
       ORDER BY created_at DESC LIMIT ?`
    )
    .bind(like, like, like, like, limit)
    .all();
}

export async function getBackupById(db, id) {
  return db.prepare('SELECT * FROM backups WHERE id=? LIMIT 1').bind(id).first();
}

export async function stats(db) {
  const total = await db.prepare('SELECT COUNT(*) AS n FROM backups').first();
  const byType = await db.prepare('SELECT type, COUNT(*) AS n FROM backups GROUP BY type').all();
  const size = await db.prepare('SELECT COALESCE(SUM(file_size),0) AS s FROM backups').first();
  const oldest = await db.prepare('SELECT MIN(created_at) AS c FROM backups').first();
  const newest = await db.prepare('SELECT MAX(created_at) AS c FROM backups').first();
  const topics = await db.prepare('SELECT COUNT(*) AS n FROM topics WHERE backup_thread_id IS NOT NULL').first();
  return {
    total: total?.n || 0,
    totalSize: Number(size?.s || 0),
    byType: (byType?.results || []).reduce((m, r) => ((m[r.type] = r.n), m), {}),
    oldest: oldest?.c || null,
    newest: newest?.c || null,
    topics: topics?.n || 0,
  };
}

export async function cleanupOld(db, days) {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const r = await db.prepare('DELETE FROM backups WHERE created_at < ?').bind(cutoff).run();
  log('CLEANUP', `清理 ${days} 天前的索引，影响 ${r.meta?.changes || 0} 条`);
  return r.meta?.changes || 0;
}

// ---- 话题映射 ----

// 取来源话题映射（含备份话题 thread id）
export async function getTopicMapping(db, sourceChatId, sourceThreadId) {
  return db
    .prepare('SELECT * FROM topics WHERE source_chat_id=? AND source_thread_id=? LIMIT 1')
    .bind(sourceChatId, sourceThreadId)
    .first();
}

// 记录/更新来源话题名（来自 forum_topic_created / forum_topic_edited）
export async function upsertSourceTopic(db, sourceChatId, sourceThreadId, name) {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO topics (source_chat_id, source_thread_id, topic_name, created_at, updated_at)
       VALUES (?,?,?,?,?)
       ON CONFLICT(source_chat_id, source_thread_id) DO UPDATE SET
         topic_name=excluded.topic_name, updated_at=excluded.updated_at`
    )
    .bind(sourceChatId, sourceThreadId, name, now, now)
    .run();
}

// 写入备份频道对应话题的 thread id（无条件更新）
export async function setBackupTopic(db, sourceChatId, sourceThreadId, backupThreadId, backupTopicId) {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE topics SET backup_thread_id=?, backup_topic_id=?, updated_at=? WHERE source_chat_id=? AND source_thread_id=?`
    )
    .bind(backupThreadId, backupTopicId, now, sourceChatId, sourceThreadId)
    .run();
}

// 原子认领：仅当该来源话题尚未绑定备份话题时写入，返回是否认领成功。
// 用于避免并发 webhook 为同一新话题重复创建备份话题。
export async function claimBackupTopic(db, sourceChatId, sourceThreadId, backupThreadId) {
  const now = new Date().toISOString();
  const r = await db
    .prepare(
      `UPDATE topics
       SET backup_thread_id=?, backup_topic_id=?, updated_at=?
       WHERE source_chat_id=? AND source_thread_id=? AND backup_thread_id IS NULL`
    )
    .bind(backupThreadId, backupThreadId, now, sourceChatId, sourceThreadId)
    .run();
  return (r.meta?.changes || 0) > 0;
}

// 列出所有话题及备份计数
export async function listTopics(db) {
  return db
    .prepare(
      `SELECT t.source_chat_id, t.source_thread_id, t.topic_name, t.backup_thread_id,
              COUNT(b.id) AS count, MAX(b.created_at) AS last_at
       FROM topics t
       LEFT JOIN backups b ON b.source_thread_id = t.source_thread_id AND b.source_chat_id = t.source_chat_id
       GROUP BY t.source_chat_id, t.source_thread_id
       ORDER BY last_at DESC NULLS LAST`
    )
    .all();
}
