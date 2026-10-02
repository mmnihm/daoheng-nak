// 命令处理：统计、列表、搜索、恢复、清理、话题、帮助。
import { config, isAllowed } from '../config.js';
import { listRecent, searchBackups, getBackupById, stats, cleanupOld, listTopics, getBackupChatId, setSetting, deleteSetting } from '../db.js';
import { formatSize } from '../services/backup.js';

function gate(ctx) {
  if (!isAllowed(ctx.from?.id)) {
    return ctx.reply(`⛔ 无权限\n\n你的 Telegram ID：${ctx.from?.id}\n请把这个 ID 加入 Cloudflare 的 ADMIN_IDS。`);
  }
  return null;
}

export async function setBackupCommand(ctx) {
  if (await gate(ctx)) return;
  const db = ctx.env?.DB;
  if (!db) return ctx.reply('⚠️ 未配置 D1 数据库。');

  let raw = String(ctx.match || '').trim();
  let chatId = null;
  const replied = ctx.message?.reply_to_message;
  const origin = replied?.forward_origin;

  if (!raw && origin?.type === 'channel' && origin.chat?.id) {
    chatId = Number(origin.chat.id);
  } else if (raw) {
    chatId = Number(raw);
  }

  if (!Number.isSafeInteger(chatId)) {
    return ctx.reply(
      '⚙️ 设置备份群/频道\n\n' +
      '方式一：/setbackup -100xxxxxxxxxx\n' +
      '方式二：把备份频道的一条消息转发给我，再回复这条转发消息发送 /setbackup。'
    );
  }

  await setSetting(db, 'backup_chat_id', chatId);
  await ctx.reply(`✅ 备份目标已设置\n\n📦 Chat ID：${chatId}\n\n以后收到的文件会自动备份到这里。`);
}

export async function backupCommand(ctx) {
  if (await gate(ctx)) return;
  const db = ctx.env?.DB;
  if (!db) return ctx.reply('⚠️ 未配置 D1 数据库。');
  const chatId = await getBackupChatId(db);
  if (!chatId) return ctx.reply('📦 当前还没有设置备份群/频道。\n\n使用 /setbackup 设置。');
  await ctx.reply(`📦 当前备份目标\n\nChat ID：${chatId}`);
}

export async function clearBackupCommand(ctx) {
  if (await gate(ctx)) return;
  const db = ctx.env?.DB;
  if (!db) return ctx.reply('⚠️ 未配置 D1 数据库。');
  await deleteSetting(db, 'backup_chat_id');
  await ctx.reply('✅ 已清除备份目标。\n\n请重新使用 /setbackup 设置。');
}

export async function startCommand(ctx) {
  await ctx.reply(
    `🗄️ 备份机器人\n\n` +
    `把文件、图片、视频、语音或文字直接发给我，我会自动归档到备份频道并建立索引。话题（论坛 Topic）消息会归档到备份频道里对应的话题中。\n\n` +
    `可用命令：\n` +
    `/stats — 备份统计\n` +
    `/list — 最近备份\n` +
    `/topics — 话题列表\n` +
    `/search 关键词 — 搜索备份\n` +
    `/restore <ID> — 重新发送一份备份\n` +
    `/cleanup <天数> — 清理 N 天前的索引\n` +
    `/setbackup <Chat ID> — 设置备份群/频道\n` +
    `/backup — 查看当前备份目标\n` +
    `/clearbackup — 清除机器人内的备份设置\n` +
    `/help — 帮助`
  );
}

export async function helpCommand(ctx) {
  return startCommand(ctx);
}

export async function statsCommand(ctx) {
  if (await gate(ctx)) return;
  const db = ctx.env?.DB;
  if (!db) return ctx.reply('⚠️ 未配置 D1 数据库。');
  const s = await stats(db);
  const lines = Object.entries(s.byType).map(([t, n]) => `  ${t}：${n}`).join('\n') || '  （无）';
  await ctx.reply(
    `📊 备份统计\n\n` +
    `总数：${s.total}\n` +
    `总大小：${formatSize(s.totalSize)}\n` +
    `话题数：${s.topics}\n` +
    `最早：${s.oldest ? s.oldest.replace('T', ' ').slice(0, 19) : '—'}\n` +
    `最近：${s.newest ? s.newest.replace('T', ' ').slice(0, 19) : '—'}\n\n` +
    `按类型：\n${lines}`
  );
}

export async function listCommand(ctx) {
  if (await gate(ctx)) return;
  const db = ctx.env?.DB;
  if (!db) return ctx.reply('⚠️ 未配置 D1 数据库。');
  const rows = (await listRecent(db, 15, 0))?.results || [];
  if (!rows.length) return ctx.reply('📭 还没有任何备份。');
  const text = rows.map(r => brief(r)).join('\n');
  await ctx.reply(`🗂️ 最近备份（${rows.length}）\n\n${text}`);
}

export async function topicsCommand(ctx) {
  if (await gate(ctx)) return;
  const db = ctx.env?.DB;
  if (!db) return ctx.reply('⚠️ 未配置 D1 数据库。');
  const rows = (await listTopics(db))?.results || [];
  if (!rows.length) return ctx.reply('🧵 还没有任何话题记录。');
  const text = rows.map(t =>
    `• ${t.topic_name || `话题 #${t.source_thread_id}`}${t.backup_thread_id ? '' : '（未映射）'} — ${t.count} 条` +
    (t.last_at ? ` · ${(t.last_at).replace('T', ' ').slice(0, 16)}` : '')
  ).join('\n');
  await ctx.reply(`🧵 话题（${rows.length}）\n\n${text}`);
}

export async function searchCommand(ctx) {
  if (await gate(ctx)) return;
  const db = ctx.env?.DB;
  if (!db) return ctx.reply('⚠️ 未配置 D1 数据库。');
  const keyword = String(ctx.match || '').trim();
  if (!keyword) return ctx.reply('用法：/search 关键词');
  const rows = (await searchBackups(db, keyword, 15))?.results || [];
  if (!rows.length) return ctx.reply(`🔍 没有匹配「${keyword}」的备份。`);
  await ctx.reply(`🔍 搜索结果（${rows.length}）\n\n${rows.map(brief).join('\n')}`);
}

export async function restoreCommand(ctx) {
  if (await gate(ctx)) return;
  const db = ctx.env?.DB;
  if (!db) return ctx.reply('⚠️ 未配置 D1 数据库。');
  const id = String(ctx.match || '').trim();
  if (!id) return ctx.reply('用法：/restore <ID>');
  const row = await getBackupById(db, id);
  if (!row) return ctx.reply(`❌ 找不到 ID：${id}`);
  try {
    await ctx.api.copyMessage(ctx.chat.id, row.backup_chat_id, row.backup_message_id);
    await ctx.reply(`✅ 已恢复：${row.file_name || row.type}`);
  } catch (e) {
    await ctx.reply(`❌ 恢复失败：${e.message}`);
  }
}

export async function cleanupCommand(ctx) {
  if (await gate(ctx)) return;
  const db = ctx.env?.DB;
  if (!db) return ctx.reply('⚠️ 未配置 D1 数据库。');
  const days = Math.max(0, Number(String(ctx.match || '').trim()) || config.retentionDays);
  if (!days) return ctx.reply('用法：/cleanup <天数>\n或设置环境变量 RETENTION_DAYS。');
  const n = await cleanupOld(db, days);
  await ctx.reply(`🧹 已清理 ${n} 条 ${days} 天前的索引记录。\n（备份频道中的消息不会自动删除。）`);
}

function brief(r) {
  const name = r.file_name || r.caption || r.type;
  const sz = r.file_size ? ` · ${formatSize(r.file_size)}` : '';
  const tp = r.topic_name ? ` [${r.topic_name}]` : '';
  const t = (r.created_at || '').replace('T', ' ').slice(0, 16);
  return `• [${r.id}] ${name}${sz}${tp} — ${t}`;
}
