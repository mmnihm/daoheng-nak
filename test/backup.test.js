import { test } from 'node:test';
import assert from 'node:assert';
import { fakeBot, fakeCtx, makeDb } from './helpers.js';

// 在导入 config 前 set env，使 config 读到测试值
globalThis.__BOT_ENV__ = {
  BOT_TOKEN: '0:fake',
  ADMIN_IDS: '111',
  BACKUP_CHANNEL_ID: '-100555',
};

const { extractFile, sourceTopic, formatSize, senderName, ensureBackupTopic, handleBackup } =
  await import('../src/services/backup.js');

test('extractFile 各类型', () => {
  const doc = extractFile({ document: { file_id: 'd1', file_unique_id: 'du', file_name: 'a.pdf', mime_type: 'application/pdf', file_size: 100 } });
  assert.equal(doc.type, 'document');
  assert.equal(doc.fileId, 'd1');
  assert.equal(doc.fileName, 'a.pdf');

  const photo = extractFile({ photo: [{ file_id: 'p0', file_unique_id: 'pu', file_size: 10 }, { file_id: 'p1', file_unique_id: 'pu', file_size: 50 }] });
  assert.equal(photo.type, 'photo');
  assert.equal(photo.fileId, 'p1'); // 取最大尺寸

  const vid = extractFile({ video: { file_id: 'v1', file_unique_id: 'vu', duration: 5, mime_type: 'video/mp4', file_size: 999 } });
  assert.equal(vid.type, 'video');
  assert.match(vid.fileName, /视频_5s/);

  assert.equal(extractFile({ text: 'hi' }), null);
});

test('formatSize 边界', () => {
  assert.equal(formatSize(0), '0 B');
  assert.equal(formatSize(512), '512 B');
  assert.equal(formatSize(1024), '1.0 KB');
  assert.equal(formatSize(1048576), '1.0 MB');
  assert.equal(formatSize(1073741824), '1.0 GB');
});

test('senderName 降级链', () => {
  assert.equal(senderName({ first_name: 'A', last_name: 'B' }), 'A B');
  assert.equal(senderName({ first_name: 'A' }), 'A');
  assert.equal(senderName({ username: 'un' }), 'un');
  assert.equal(senderName({ id: 7 }), '7');
  assert.equal(senderName(null), '未知');
});

test('sourceTopic 各分支', () => {
  assert.equal(sourceTopic({}), null);
  assert.deepEqual(sourceTopic({ message_thread_id: 42 }), { threadId: 42, name: null });
  assert.deepEqual(sourceTopic({ message_thread_id: 42, forum_topic_created: { name: '新话题' } }), { threadId: 42, name: '新话题' });
  assert.deepEqual(sourceTopic({ message_thread_id: 42, forum_topic_edited: { name: '改名' } }), { threadId: 42, name: '改名' });
  // 仅改图标（无 name）
  assert.deepEqual(sourceTopic({ message_thread_id: 42, forum_topic_edited: { icon_custom_emoji_id: 'x' } }), { threadId: 42, name: null });
});

test('ensureBackupTopic 新话题：创建并认领', async () => {
  const db = await makeDb();
  const bot = fakeBot();
  const res = await ensureBackupTopic(bot, db, -200, { threadId: 42, name: '财务' });
  assert.ok(res.backupThreadId, '应返回备份 thread id');
  assert.equal(res.name, '财务');
  const created = bot.calls.find(c => c.m === 'createForumTopic');
  assert.ok(created, '应调用 createForumTopic');
  assert.equal(created.name, '财务');
  // 再次调用应复用，不重复创建
  const res2 = await ensureBackupTopic(bot, db, -200, { threadId: 42, name: '财务' });
  assert.equal(res2.backupThreadId, res.backupThreadId);
  const creates = bot.calls.filter(c => c.m === 'createForumTopic');
  assert.equal(creates.length, 1, '不应重复创建');
});

test('ensureBackupTopic 无名话题用占位名', async () => {
  const db = await makeDb();
  const bot = fakeBot();
  const res = await ensureBackupTopic(bot, db, -200, { threadId: 77, name: null });
  assert.ok(res.backupThreadId);
  const created = bot.calls.find(c => c.m === 'createForumTopic');
  assert.equal(created.name, '话题 #77');
});

test('ensureBackupTopic 话题改名时同步备份话题名', async () => {
  const db = await makeDb();
  const bot = fakeBot();
  await ensureBackupTopic(bot, db, -200, { threadId: 42, name: '旧名' });
  const { getTopicMapping } = await import('../src/db.js');
  const before = await getTopicMapping(db, -200, 42);
  // 模拟后续收到 forum_topic_edited 改名
  const res = await ensureBackupTopic(bot, db, -200, { threadId: 42, name: '新名' });
  assert.equal(res.backupThreadId, before.backup_thread_id);
  const edit = bot.calls.find(c => c.m === 'editForumTopic');
  assert.ok(edit, '应调用 editForumTopic');
  assert.equal(edit.opts.name, '新名');
  assert.equal(res.name, '新名', '返回名应为同步后的新名');
});

test('ensureBackupTopic 备份频道未开启话题时回落', async () => {
  const db = await makeDb();
  const bot = fakeBot({ createForumTopic: () => { throw new Error('Bad Request: chat is not a forum'); } });
  const res = await ensureBackupTopic(bot, db, -200, { threadId: 42, name: '财务' });
  assert.equal(res.backupThreadId, null, '回落为不分话题');
  assert.equal(res.name, '财务');
});

test('ensureBackupTopic 并发认领：失败方删除重复话题', async () => {
  const db = await makeDb();
  const { upsertSourceTopic, claimBackupTopic } = await import('../src/db.js');
  // 来源话题已登记但尚未绑定备份话题
  await upsertSourceTopic(db, -200, 42, '财务');
  // 模拟并发：createForumTopic 被调用时，另一请求抢先认领了 thread 555
  const bot = fakeBot({
    createForumTopic: async () => {
      await claimBackupTopic(db, -200, 42, 555); // 竞争者抢先认领
      return { message_thread_id: 777 }; // 本请求创建的（将被删除）
    },
  });
  const res = await ensureBackupTopic(bot, db, -200, { threadId: 42, name: '财务' });
  assert.equal(res.backupThreadId, 555, '应使用已认领的 thread');
  const del = bot.calls.find(c => c.m === 'deleteForumTopic');
  assert.ok(del, '应删除重复创建的话题');
  assert.equal(del.threadId, 777);
});

test('ensureBackupTopic 未配置备份频道时返回占位名', async () => {
  const { config } = await import('../src/config.js');
  const saved = config.backupChannelId;
  config.backupChannelId = null;
  try {
    const db = await makeDb();
    const bot = fakeBot();
    const res = await ensureBackupTopic(bot, db, -200, { threadId: 42, name: null });
    assert.equal(res.backupThreadId, null);
    assert.equal(res.name, '话题 #42');
    assert.equal(bot.calls.length, 0, '不应调用任何 API');
  } finally {
    config.backupChannelId = saved;
  }
});

test('handleBackup 普通文件：复制并索引', async () => {
  const db = await makeDb();
  const bot = fakeBot();
  const ctx = fakeCtx({
    message: { message_id: 10, document: { file_id: 'd1', file_unique_id: 'du1', file_name: 'a.pdf', mime_type: 'application/pdf', file_size: 100 } },
    env: { DB: db },
  });
  await handleBackup(bot, ctx);
  const copy = bot.calls.find(c => c.m === 'copyMessage');
  assert.ok(copy, '应复制消息');
  assert.equal(copy.targetChat, -100555);
  assert.equal(copy.opts.message_thread_id, undefined, '非话题消息不应带 thread');
  assert.ok(ctx._replies[0].includes('已备份'));
});

test('handleBackup 话题内文件：复制到对应备份话题', async () => {
  const db = await makeDb();
  const bot = fakeBot();
  const ctx = fakeCtx({
    message: { message_id: 11, message_thread_id: 42, document: { file_id: 'd2', file_unique_id: 'du2', file_name: 'b.pdf', mime_type: 'application/pdf', file_size: 200 } },
    env: { DB: db },
  });
  await handleBackup(bot, ctx);
  const copy = bot.calls.find(c => c.m === 'copyMessage');
  assert.ok(copy.opts.message_thread_id, '应带备份话题 thread');
  // 索引应记录 source_thread_id 与 topic_name
  const { listRecent } = await import('../src/db.js');
  const rows = (await listRecent(db, 10, 0)).results;
  assert.equal(rows[0].source_thread_id, 42);
  assert.ok(rows[0].topic_name);
});

test('handleBackup 去重：同文件不重复备份', async () => {
  const db = await makeDb();
  const bot = fakeBot();
  const msg = { message_id: 12, document: { file_id: 'd3', file_unique_id: 'dup', file_name: 'c.pdf', mime_type: 'application/pdf', file_size: 1 } };
  const ctx1 = fakeCtx({ message: { ...msg }, env: { DB: db } });
  await handleBackup(bot, ctx1);
  const ctx2 = fakeCtx({ message: { ...msg, message_id: 13 }, env: { DB: db } });
  await handleBackup(bot, ctx2);
  const copies = bot.calls.filter(c => c.m === 'copyMessage');
  assert.equal(copies.length, 1, '第二次应被去重跳过');
  assert.match(ctx2._replies[0], /已备份过/);
});

test('handleBackup 话题服务消息：登记并不归档', async () => {
  const db = await makeDb();
  const bot = fakeBot();
  const ctx = fakeCtx({
    message: { message_id: 20, message_thread_id: 99, forum_topic_created: { name: '公告' } },
    env: { DB: db },
  });
  await handleBackup(bot, ctx);
  // 不应复制服务消息
  assert.equal(bot.calls.filter(c => c.m === 'copyMessage').length, 0);
  // 应登记话题
  const { getTopicMapping } = await import('../src/db.js');
  const m = await getTopicMapping(db, ctx.chat.id, 99);
  assert.equal(m.topic_name, '公告');
  assert.match(ctx._replies[0], /话题已登记/);
});

test('handleBackup 仅改图标的话题消息：不归档也不报错', async () => {
  const db = await makeDb();
  const bot = fakeBot();
  const ctx = fakeCtx({
    message: { message_id: 21, message_thread_id: 88, forum_topic_edited: { icon_custom_emoji_id: 'x' } },
    env: { DB: db },
  });
  await handleBackup(bot, ctx);
  assert.equal(bot.calls.filter(c => c.m === 'copyMessage').length, 0, '不应归档服务消息');
});

test('handleBackup 无权限用户被拒', async () => {
  const db = await makeDb();
  const bot = fakeBot();
  const ctx = fakeCtx({
    message: { message_id: 30, text: 'hi' },
    from: { id: 999, first_name: 'Stranger' },
    env: { DB: db },
  });
  await handleBackup(bot, ctx);
  assert.equal(bot.calls.filter(c => c.m === 'copyMessage').length, 0);
  assert.match(ctx._replies[0], /无权限/);
});
