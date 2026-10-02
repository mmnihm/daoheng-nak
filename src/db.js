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
        source_chat_id INTEGER,
        source_message_id INTEGER,
        sender_id INTEGER,
        sender_name TEXT,
        type TEXT NOT NULL,
        file_unique_id TEXT,
        file_name TEXT,
        mime_type TEXT,
        file_size INTEGER,
        caption TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(backup_chat_id, backup_message_id)
      )`
    )
    .run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_backups_created ON backups(created_at DESC)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_backups_type ON backups(type)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_backups_file_unique ON backups(file_unique_id)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_backups_sender ON backups(sender_id)').run();
  return db;
}

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export async function insertBackup(db, row) {
  await db
    .prepare(
      `INSERT INTO backups
        (id, backup_chat_id, backup_message_id, source_chat_id, source_message_id,
         sender_id, sender_name, type, file_unique_id, file_name, mime_type,
         file_size, caption, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(
      row.id, row.backup_chat_id, row.backup_message_id, row.source_chat_id,
      row.source_message_id, row.sender_id, row.sender_name, row.type,
      row.file_unique_id, row.file_name, row.mime_type, row.file_size,
      row.caption, row.created_at
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
       WHERE file_name LIKE ? OR caption LIKE ? OR sender_name LIKE ?
       ORDER BY created_at DESC LIMIT ?`
    )
    .bind(like, like, like, limit)
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
  return {
    total: total?.n || 0,
    totalSize: Number(size?.s || 0),
    byType: (byType?.results || []).reduce((m, r) => ((m[r.type] = r.n), m), {}),
    oldest: oldest?.c || null,
    newest: newest?.c || null,
  };
}

export async function cleanupOld(db, days) {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const r = await db.prepare('DELETE FROM backups WHERE created_at < ?').bind(cutoff).run();
  log('CLEANUP', `清理 ${days} 天前的索引，影响 ${r.meta?.changes || 0} 条`);
  return r.meta?.changes || 0;
}
