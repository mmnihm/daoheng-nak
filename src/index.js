import { createBot } from './bot.js';
import { initDb } from './db.js';
import { loadConfig, config } from './config.js';
import { log } from './logger.js';

// Cloudflare Workers 入口：处理 Webhook + 初始化 D1。
export default {
  async fetch(request, env, ctx) {
    globalThis.__BOT_ENV__ = env;
    loadConfig(env);
    const url = new URL(request.url);

    // 健康检查
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response('telegram-backup-bot ok', { status: 200 });
    }

    if (url.pathname !== '/webhook') {
      return new Response('Not Found', { status: 404 });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    try {
      await initDb(env);
      const bot = createBot();
      const update = await request.json();
      await bot.handleUpdate(update, { env });
      return new Response('ok', { status: 200 });
    } catch (e) {
      log('WEBHOOK', `处理失败：${e.message}`);
      return new Response('error', { status: 200 });
    }
  },
};

// 本地 node 入口（仅用于调试，Workers 环境不会执行）。
if (typeof process !== 'undefined' && !globalThis.__BOT_ENV__) {
  globalThis.__BOT_ENV__ = process.env;
  loadConfig(process.env);
  if (config.botToken) {
    const bot = createBot();
    bot.start();
    log('BOOT', '本地长轮询模式已启动');
  }
}
