// 核心备份逻辑：从入站消息提取文件信息，复制到备份频道（保留话题结构），并写入 D1 索引。
import { config, isAllowed } from '../config.js';
import {
  insertBackup, newId, findByFileUnique,
  getTopicMapping, upsertSourceTopic, claimBackupTopic,
} from '../db.js';
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

// 来源话题信息：thread id 与（若可得）话题名
export function sourceTopic(msg) {
  const threadId = msg.message_thread_id;
  if (threadId == null) return null;
  // forum_topic_created / forum_topic_edited 服务消息自带话题名
  if (msg.forum_topic_created) {
    return { threadId, name: msg.forum_topic_created.name || null };
  }
  if (msg.forum_topic_edited && msg.forum_topic_edited.name) {
    return { threadId, name: msg.forum_topic_edited.name };
  }
  return { threadId, name: null };
}

// 确保备份频道中存在对应话题，返回 { backupThreadId, name }。
// 备份频道必须是开启了话题的超级群，否则回落为不分话题。
// 并发安全：用原子认领避免为同一来源话题重复创建备份话题。
export async function ensureBackupTopic(bot, db, sourceChatId, src) {
  if (!src) return { backupThreadId: null, name: null };
  const targetChat = config.backupChannelId;
  if (!targetChat) {
    return { backupThreadId: null, name: src.name || `话题 #${src.threadId}` };
  }

  const existing = await getTopicMapping(db, sourceChatId, src.threadId);
  let name;
  if (existing) {
    name = existing.topic_name || src.name || `话题 #${src.threadId}`;
    if (existing.backup_thread_id != null) {
      // 若来源话题名更新了，尝试同步更新备份话题名（best-effort）
      if (src.name && existing.topic_name !== src.name) {
        try { await bot.api.editForumTopic(targetChat, existing.backup_thread_id, { name: src.name }); }
        catch (e) { log('TOPIC', `更新备份话题名失败：${e.message}`); }
        await upsertSourceTopic(db, sourceChatId, src.threadId, src.name);
      }
      // 用最新名（同步后的来源名）而非旧快照
      const effectiveName = src.name || existing.topic_name || name;
      return { backupThreadId: existing.backup_thread_id, name: effectiveName };
    }
  } else {
    name = src.name || `话题 #${src.threadId}`;
    await upsertSourceTopic(db, sourceChatId, src.threadId, name);
  }

  // 创建备份话题；并发时用原子认领避免重复
  try {
    const created = await bot.api.createForumTopic(targetChat, name);
    const newThreadId = created.message_thread_id;
 const claimed = await claimBackupTopic(db, sourceChatId, src.threadId, newThreadId);
    if (!claimed) {
      // 认领失败：另一并发请求已创建，删除本次重复创建的话题
      try { await bot.api.deleteForumTopic(targetChat, newThreadId); }
      catch (e) { log('TOPIC', `删除重复话题失败：${e.message}`); }
      const winner = await getTopicMapping(db, sourceChatId, src.threadId);
      return { backupThreadId: winner?.backup_thread_id ?? null, name: winner?.topic_name || name };
    }
    log('TOPIC', `创建备份话题「${name}」`, { backupThreadId: newThreadId });
    return { backupThreadId: newThreadId, name };
  } catch (e) {
    log('TOPIC', `创建备份话题失败（备份频道可能未开启话题）：${e.message}`);
    return { backupThreadId: null, name };
  }
}

// 处理话题创建/改名服务消息：登记来源话题名，并预建备份话题。
async function handleTopicService(bot, ctx) {
  const msg = ctx.message;
  const db = ctx.env?.DB;
  const src = sourceTopic(msg);
  if (!src || !src.name) return false;

  if (db) {
    await upsertSourceTopic(db, ctx.chat.id, src.threadId, src.name);
    if (config.backupChannelId) {
      await ensureBackupTopic(bot, db, ctx.chat.id, src);
    }
  }
  log('TOPIC', `话题服务消息：${src.name}`, { threadId: src.threadId });
  return true;
}

// 处理一条入站消息：复制到备份频道（保留话题）并索引。
export async function handleBackup(bot, ctx) {
  const msg = ctx.message;
  if (!msg) return;

  const userId = ctx.from?.id;
  if (!isAllowed(userId)) {
    await ctx.reply(`⛔ 无权限\n\n你的 Telegram ID：${userId}\n请把这个 ID 加入 Cloudflare 的 ADMIN_IDS。`);
    return;
  }

  const db = ctx.env?.DB;
  const targetChat = config.backupChannelId || ctx.chat.id;

  // 话题服务消息（创建 / 改名）：登记话题名 + 预建备份话题，然后结束（不作为内容归档）
  if (msg.forum_topic_created || msg.forum_topic_edited) {
    const handled = await handleTopicService(bot, ctx);
    if (handled) {
      await ctx.reply(`🧵 话题已登记：${sourceTopic(msg).name}`);
    }
    return;
  }

  const srcTopic = sourceTopic(msg);
  let backupThreadId = null;
  let topicName = null;
  if (srcTopic && db && config.backupChannelId) {
    const t = await ensureBackupTopic(bot, db, ctx.chat.id, srcTopic);
    backupThreadId = t.backupThreadId;
    topicName = t.name;
  } else if (srcTopic) {
    topicName = srcTopic.name || (db ? (await getTopicMapping(db, ctx.chat.id, srcTopic.threadId))?.topic_name : null) || `话题 #${srcTopic.threadId}`;
  }

  const fileInfo = extractFile(msg);
  const caption = msg.caption || msg.text || '';
  const type = fileInfo ? fileInfo.type : msg.text ? 'text' : msg.forum_topic_created ? 'topic_created' : 'unknown';

  // 去重：同一文件在备份频道已存在则跳过复制，仅提示。
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
    const opts = backupThreadId != null ? { message_thread_id: backupThreadId } : {};
    copied = await bot.api.copyMessage(targetChat, ctx.chat.id, msg.message_id, opts);
  } catch (e) {
    log('BACKUP', `复制到备份频道失败：${e.message}`, { targetChat });
    await ctx.reply(`❌ 备份失败：${e.message}`);
    return;
  }

  const row = {
    id: newId(),
    backup_chat_id: targetChat,
    backup_message_id: copied.message_id,
    backup_thread_id: backupThreadId,
    source_chat_id: ctx.chat.id,
    source_message_id: msg.message_id,
    source_thread_id: srcTopic?.threadId || null,
    sender_id: userId || null,
    sender_name: senderName(ctx.from),
    type,
    file_unique_id: fileInfo?.fileUniqueId || null,
    file_name: fileInfo?.fileName || null,
    mime_type: fileInfo?.mimeType || null,
    file_size: fileInfo?.fileSize || null,
    caption: caption || null,
    topic_name: topicName || null,
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
  const topicStr = topicName ? `\n🧵 话题：${topicName}` : '';
  await ctx.reply(
    `✅ 已备份\n\n` +
    `📦 ID：${row.id}\n` +
    `🏷️ 类型：${type}${fileInfo?.fileName ? `\n📄 文件：${fileInfo.fileName}` : ''}${sizeStr}${topicStr}\n` +
    `👤 来自：${row.sender_name}\n` +
    `🕐 时间：${row.created_at.replace('T', ' ').slice(0, 19)}`
  );
  log('BACKUP', `归档 ${type} 来自 ${row.sender_name}`, { id: row.id, topic: topicName });
}
