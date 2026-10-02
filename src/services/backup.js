// 核心备份逻辑：从入站消息提取文件信息，复制到备份频道，并写入 D1 索引。
import { config, isAllowed } from '../config.js';
import { insertBackup, newId, findByFileUnique } from '../db.js';
import { log } from '../logger.js';

// 从 Telegram 消息中提取文件元数据。
export function extractFile(msg) {
  if (msg.document) {
    return { type: 'document', fileId: msg.document.file_id, fileUniqueId: msg.document.file_unique_id, fileName: msg.document.file_name || '未命名文件', mimeType: msg.document.mime_type, fileSize: msg.document.file_size };
  }
  if (msg.video) {
    return { type: 'video', fileId: msg.video.file_id, fileUniqueId: msg.video.file_unique_id, fileName: msg.video.file_name || `视频_${msg.video.duration || 0}s`, mimeType: msg.video.mime_type, fileSize: msg.video.file_size };
  }
  if (msg.animation) {
    return { type: 'animation', fileId: msg.animation.file_id, fileUniqueId: msg.animation.file_unique_id, fileName: msg.animation.file_name || 'GIF', mimeType: msg.animation.mime_type, fileSize: msg.animation.file_size };
  }
  if (msg.photo) {
    const p = msg.photo[msg.photo.length - 1];
    return { type: 'photo', fileId: p.file_id, fileUniqueId: p.file_unique_id, fileName: `图片_${p.file_unique_id}`, mimeType: 'image/jpeg', fileSize: p.file_size };
  }
  if (msg.audio) {
    return { type: 'audio', fileId: msg.audio.file_id, fileUniqueId: msg.audio.file_unique_id, fileName: msg.audio.file_name || msg.audio.title || '音频', mimeType: msg.audio.mime_type, fileSize: msg.audio.file_size };
  }
  if (msg.voice) {
    return { type: 'voice', fileId: msg.voice.file_id, fileUniqueId: msg.voice.file_unique_id, fileName: `语音_${msg.voice.duration || 0}s`, mimeType: msg.voice.mime_type, fileSize: msg.voice.file_size };
  }
  if (msg.sticker) {
    return { type: 'sticker', fileId: msg.sticker.file_id, fileUniqueId: msg.sticker.file_unique_id, fileName: msg.sticker.set_name || '贴纸', mimeType: msg.sticker.mime_type, fileSize: msg.sticker.file_size };
  }
  return null;
}

export function senderName(from) {
  if (!from) return '未知';
  return [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || String(from.id);
}

export function formatSize(bytes) {
  if (!bytes) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

// 处理一条入站消息：复制到备份频道并索引。
export async function handleBackup(bot, ctx) {
  const msg = ctx.message;
  if (!msg) return;

  const userId = ctx.from?.id;
  if (!isAllowed(userId)) {
    await ctx.reply(`⛔ 无权限\n\n你的 Telegram ID：${userId}\n请把这个 ID 加入 Cloudflare 的 ADMIN_IDS。`);
    return;
  }

  const targetChat = config.backupChannelId || ctx.chat.id;
  const fileInfo = extractFile(msg);
  const caption = msg.caption || msg.text || '';
  const type = fileInfo ? fileInfo.type : msg.text ? 'text' : 'unknown';

  // 去重：同一文件在备份频道已存在则跳过复制，仅提示。
  const db = ctx.env?.DB;
  if (db && fileInfo?.fileUniqueId) {
    const dup = await findByFileUnique(db, targetChat, fileInfo.fileUniqueId);
    if (dup) {
      await ctx.reply(`♻️ 该文件已备份过：\n📦 ID：${dup.id}\n类型：${type}${fileInfo.fileName ? `\n文件：${fileInfo.fileName}` : ''}`);
      return;
    }
  }

  // 复制消息到备份频道（保留原始文件，不经过 Worker 下载）。
  let copied;
  try {
    copied = await bot.api.copyMessage(targetChat, ctx.chat.id, msg.message_id);
  } catch (e) {
    log('BACKUP', `复制到备份频道失败：${e.message}`, { targetChat });
    await ctx.reply(`❌ 备份失败：${e.message}`);
    return;
  }

  const row = {
    id: newId(),
    backup_chat_id: targetChat,
    backup_message_id: copied.message_id,
    source_chat_id: ctx.chat.id,
    source_message_id: msg.message_id,
    sender_id: userId || null,
    sender_name: senderName(ctx.from),
    type,
    file_unique_id: fileInfo?.fileUniqueId || null,
    file_name: fileInfo?.fileName || null,
    mime_type: fileInfo?.mimeType || null,
    file_size: fileInfo?.fileSize || null,
    caption: caption || null,
    created_at: new Date().toISOString(),
  };

  if (db) {
    try {
      await insertBackup(db, row);
    } catch (e) {
      log('BACKUP', `写入索引失败：${e.message}`);
    }
  }

  const sizeStr = fileInfo?.fileSize ? ` | ${formatSize(fileInfo.fileSize)}` : '';
  await ctx.reply(
    `✅ 已备份\n\n` +
    `📦 ID：${row.id}\n` +
    `🏷️ 类型：${type}${fileInfo?.fileName ? `\n📄 文件：${fileInfo.fileName}` : ''}${sizeStr}\n` +
    `👤 来自：${row.sender_name}\n` +
    `🕐 时间：${row.created_at.replace('T', ' ').slice(0, 19)}`
  );
  log('BACKUP', `归档 ${type} 来自 ${row.sender_name}`, { id: row.id });
}
