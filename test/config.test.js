import { test } from 'node:test';
import assert from 'node:assert';

// 测试 loadConfig 可在模块导入后再次注入环境（模拟 Workers fetch 时才拿到 env）
const { config, loadConfig, isAllowed } = await import('../src/config.js');

test('loadConfig 在导入后注入环境变量', () => {
  loadConfig({ BOT_TOKEN: 'T', ADMIN_IDS: '111,222', BACKUP_CHANNEL_ID: '-100555', RETENTION_DAYS: '7' });
  assert.equal(config.botToken, 'T');
  assert.deepEqual(config.adminIds, [111, 222]);
  assert.equal(config.backupChannelId, -100555);
  assert.equal(config.retentionDays, 7);
});

test('loadConfig 处理空/非法值', () => {
  loadConfig({});
  assert.equal(config.botToken, '');
  assert.deepEqual(config.adminIds, []);
  assert.equal(config.backupChannelId, null);
  assert.equal(config.retentionDays, 0);
  loadConfig({ ADMIN_IDS: 'abc, 0, -5, 333' });
  assert.deepEqual(config.adminIds, [333], '只保留正整数');
});

test('isAllowed：未配置 ADMIN_IDS 时放行', () => {
  loadConfig({});
  assert.equal(isAllowed(999), true);
});

test('isAllowed：配置后仅放行名单内', () => {
  loadConfig({ ADMIN_IDS: '111' });
  assert.equal(isAllowed(111), true);
  assert.equal(isAllowed(222), false);
});
