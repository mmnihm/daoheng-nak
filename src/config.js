// 运行时配置：Cloudflare Workers 中 env 在 fetch 时才注入，
// 不能在模块导入时一次性计算，否则 config 会停留在空值。
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
  botToken: '',
  adminIds: [],
  backupChannelId: null,
  retentionDays: 0,
};

export function loadConfig(e = globalThis.__BOT_ENV__ || (typeof process !== 'undefined' ? process.env : {})) {
  config.botToken = e.BOT_TOKEN || '';
  config.adminIds = parseIds(e.ADMIN_IDS);
  config.backupChannelId = e.BACKUP_CHANNEL_ID ? Number(e.BACKUP_CHANNEL_ID) : null;
  config.retentionDays = Math.max(0, Number(e.RETENTION_DAYS) || 0);
  return config;
}

loadConfig(env);

export function isAllowed(userId) {
  if (!config.adminIds.length) return true; // 未配置则放行（首次配置场景）
  return config.adminIds.includes(Number(userId));
}
