// 命令处理：统计、列表、搜索、恢复、清理、帮助。
import { config, isAllowed } from '../config.js';
import { listRecent, searchBackups, getBackupById, stats, cleanupOld } from '../db.js';
import { formatSize } from '../services/backup.js';

function gate(ctx) {
  if (!isAllowed(ctx.from?.id)) {
    return ctx.reply(`⛔ 无权限\n\n你的 Telegram ID：${ctx.from?.id}\n请把这个 ID 加入 Cloudflare 的 ADMIN_IDS。`);
  }
  return null;
}

export async function startCommand(ctx) {
  await ctx.reply(
    `🗄️ 备份机器人\n\n` +
    `把文件、图片、视频、语音或文字直接发给我，我会自动归档到备份频道并建立索引。\n\n` +
    `可用命令：\n` +
    `/stats — 备份统计\n` +
    `/list — 最近备份\n` +
    `/search 关键词 — 搜索备份\n` +
    `/restore <ID> — 重新发送一份备份\n` +
    `/cleanup <天数> — 清理 N 天前的索引\n` +
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
  const t = (r.created_at || '').replace('T', ' ').slice(0, 16);
  return `• [${r.id}] ${name}${sz} — ${t}`;
}
