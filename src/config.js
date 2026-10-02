const env = globalThis.__BOT_ENV__ || (typeof process !== 'undefined' ? process.env : {});

function parseIds(raw) {
  return String(raw || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isSafeInteger(n) && n > 0);
}

export const config = {
  botToken: env.BOT_TOKEN || '',
  adminIds: parseIds(env.ADMIN_IDS),
  backupChannelId: env.BACKUP_CHANNEL_ID ? Number(env.BACKUP_CHANNEL_ID) : null,
  retentionDays: Math.max(0, Number(env.RETENTION_DAYS) || 0),
};

export function isAllowed(userId) {
  if (!config.adminIds.length) return true; // 未配置则放行（首次配置场景）
  return config.adminIds.includes(Number(userId));
}
