import { test } from 'node:test';
import assert from 'node:assert';
import { makeDb } from './helpers.js';
import {
  insertBackup, findByFileUnique, getTopicMapping, upsertSourceTopic,
  claimBackupTopic, listTopics, stats, cleanupOld, listRecent, searchBackups, getBackupById, newId,
} from '../src/db.js';

test('newId 生成唯一短 id', () => {
  const ids = new Set(Array.from({ length: 500 }, () => newId()));
  assert.equal(ids.size, 500);
});

test('insertBackup / findByFileUnique / getBackupById', async () => {
  const db = await makeDb();
  const row = {
    id: 'abc', backup_chat_id: -100, backup_message_id: 5, backup_thread_id: 77,
    source_chat_id: -200, source_message_id: 9, source_thread_id: 42,
    sender_id: 111, sender_name: 'Tom', type: 'document', file_unique_id: 'uniq1',
    file_name: 'a.pdf', mime_type: 'application/pdf', file_size: 1024,
    caption: 'hi', topic_name: 'T1', created_at: '2026-10-02T10:00:00Z',
  };
  await insertBackup(db, row);
  assert.ok((await findByFileUnique(db, -100, 'uniq1')).id === 'abc');
  assert.equal((await findByFileUnique(db, -100, 'nope')), null);
  const got = await getBackupById(db, 'abc');
  assert.equal(got.file_name, 'a.pdf');
  assert.equal(got.backup_thread_id, 77);
});

test('upsertSourceTopic + claimBackupTopic 原子认领', async () => {
  const db = await makeDb();
  await upsertSourceTopic(db, -200, 42, '话题A');
  // 首次认领成功
  assert.equal(await claimBackupTopic(db, -200, 42, 888), true);
  const m = await getTopicMapping(db, -200, 42);
  assert.equal(m.backup_thread_id, 888);
  assert.equal(m.topic_name, '话题A');
  // 再次认领应失败（已绑定）
  assert.equal(await claimBackupTopic(db, -200, 42, 999), false);
  const m2 = await getTopicMapping(db, -200, 42);
  assert.equal(m2.backup_thread_id, 888, '不应被覆盖');
});

test('upsertSourceTopic 更新话题名', async () => {
  const db = await makeDb();
  await upsertSourceTopic(db, -200, 42, '旧名');
  await upsertSourceTopic(db, -200, 42, '新名');
  const m = await getTopicMapping(db, -200, 42);
  assert.equal(m.topic_name, '新名');
});

test('listTopics 统计各话题备份数', async () => {
  const db = await makeDb();
  await upsertSourceTopic(db, -200, 42, 'T1');
  await claimBackupTopic(db, -200, 42, 888);
  await upsertSourceTopic(db, -200, 43, 'T2');
  await claimBackupTopic(db, -200, 43, 889);

  const mk = (id, tid, ts) => ({
    id, backup_chat_id: -100, backup_message_id: id, backup_thread_id: tid,
    source_chat_id: -200, source_message_id: id, source_thread_id: tid,
    sender_id: 1, sender_name: 'x', type: 'text', file_unique_id: null,
    file_name: null, mime_type: null, file_size: null, caption: 'c', topic_name: null, created_at: ts,
  });
  await insertBackup(db, mk(1, 42, '2026-10-02T10:00:00Z'));
  await insertBackup(db, mk(2, 42, '2026-10-02T11:00:00Z'));
  await insertBackup(db, mk(3, 43, '2026-10-02T09:00:00Z'));

  const rows = (await listTopics(db)).results;
  assert.equal(rows.length, 2);
  const t1 = rows.find(r => r.source_thread_id === 42);
  const t2 = rows.find(r => r.source_thread_id === 43);
  assert.equal(t1.count, 2);
  assert.equal(t2.count, 1);
  // 按最近活动降序：T1(11:00) 在 T2(09:00) 前
  assert.ok(rows[0].last_at >= rows[1].last_at);
});

test('stats 汇总', async () => {
  const db = await makeDb();
  await upsertSourceTopic(db, -200, 42, 'T1');
  await claimBackupTopic(db, -200, 42, 888);
  const mk = (id, type, size) => ({
    id, backup_chat_id: -100, backup_message_id: id, backup_thread_id: 888,
    source_chat_id: -200, source_message_id: id, source_thread_id: 42,
    sender_id: 1, sender_name: 'x', type, file_unique_id: null,
    file_name: null, mime_type: null, file_size: size, caption: null, topic_name: 'T1',
    created_at: '2026-10-02T10:00:00Z',
  });
  await insertBackup(db, mk('1', 'document', 1024));
  await insertBackup(db, mk('2', 'photo', 2048));
  const s = await stats(db);
  assert.equal(s.total, 2);
  assert.equal(s.totalSize, 3072);
  assert.equal(s.topics, 1);
  assert.equal(s.byType.document, 1);
  assert.equal(s.byType.photo, 1);
});

test('searchBackups 按话题名/文件名匹配', async () => {
  const db = await makeDb();
  const mk = (id, name, topic) => ({
    id, backup_chat_id: -100, backup_message_id: id, backup_thread_id: null,
    source_chat_id: -200, source_message_id: id, source_thread_id: null,
    sender_id: 1, sender_name: 'Tom', type: 'document', file_unique_id: null,
    file_name: name, mime_type: null, file_size: null, caption: null, topic_name: topic,
    created_at: '2026-10-02T10:00:00Z',
  });
  await insertBackup(db, mk('1', 'report.pdf', '财务'));
  await insertBackup(db, mk('2', 'photo.jpg', '旅行'));
  const r = (await searchBackups(db, '财')).results;
  assert.equal(r.length, 1);
  assert.equal(r[0].file_name, 'report.pdf');
  const r2 = (await searchBackups(db, 'Tom')).results;
  assert.equal(r2.length, 2);
});

test('cleanupOld 按天数清理', async () => {
  const db = await makeDb();
  const old = '2020-01-01T00:00:00Z';
  const now = new Date().toISOString();
  const mk = (id, ts) => ({
    id, backup_chat_id: -100, backup_message_id: id, backup_thread_id: null,
    source_chat_id: -200, source_message_id: id, source_thread_id: null,
    sender_id: 1, sender_name: 'x', type: 'text', file_unique_id: null,
    file_name: null, mime_type: null, file_size: null, caption: null, topic_name: null,
    created_at: ts,
  });
  await insertBackup(db, mk('1', old));
  await insertBackup(db, mk('2', now));
  const n = await cleanupOld(db, 30);
  assert.equal(n, 1);
  const list = (await listRecent(db, 10, 0)).results;
  assert.equal(list.length, 1);
});

test('initDb 幂等（重复调用不报错）', async () => {
  const { initDb } = await import('../src/db.js');
  const { makeD1 } = await import('./helpers.js');
  const d1 = makeD1();
  await initDb({ DB: d1 });
  await initDb({ DB: d1 });
  assert.ok(true, '重复建表未抛错');
});

test('迁移 0001 -> 0002 顺序执行后 schema 完整', async () => {
  const { makeD1 } = await import('./helpers.js');
  const d1 = makeD1();
  const fs = await import('node:fs');
  const sql1 = fs.readFileSync('migrations/0001_init.sql', 'utf8');
  const sql2 = fs.readFileSync('migrations/0002_topics.sql', 'utf8');
  // D1 mock 的 prepare 一次只执行一条语句；拆分逐条执行
  for (const stmt of sql1.split(';').map(s => s.trim()).filter(Boolean)) {
    await d1.prepare(stmt).run();
  }
  for (const stmt of sql2.split(';').map(s => s.trim()).filter(Boolean)) {
    await d1.prepare(stmt).run();
  }
  // 验证 backups 含话题字段
  const cols = (await d1.prepare("SELECT name FROM pragma_table_info('backups')").all()).results.map(r => r.name);
  for (const c of ['backup_thread_id', 'source_thread_id', 'topic_name']) {
    assert.ok(cols.includes(c), `backups 应有列 ${c}`);
  }
  // 验证 topics 表存在
  const tables = (await d1.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).results.map(r => r.name);
  assert.ok(tables.includes('topics'), '应存在 topics 表');
});

test('initDb 运行时建表包含话题字段与 topics 表', async () => {
  const db = await makeDb();
  const cols = (await db.prepare("SELECT name FROM pragma_table_info('backups')").all()).results.map(r => r.name);
  for (const c of ['backup_thread_id', 'source_thread_id', 'topic_name']) {
    assert.ok(cols.includes(c), `运行时 backups 应有列 ${c}`);
  }
  const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).results.map(r => r.name);
  assert.ok(tables.includes('topics'));
});
