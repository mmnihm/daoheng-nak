import { Bot } from 'grammy';
import { config } from './config.js';
import { startCommand, helpCommand, statsCommand, listCommand, searchCommand, restoreCommand, cleanupCommand } from './commands/index.js';
import { handleBackup } from './services/backup.js';
import { log } from './logger.js';

export function createBot(options = {}) {
  const bot = new Bot(config.botToken);

  bot.command('start', startCommand);
  bot.command('help', helpCommand);
  bot.command('stats', statsCommand);
  bot.command('list', listCommand);
  bot.command('search', searchCommand);
  bot.command('restore', restoreCommand);
  bot.command('cleanup', cleanupCommand);

  // 任何带文件/媒体/文本的消息都视为备份请求。
  bot.on(['message:document', 'message:photo', 'message:video', 'message:audio', 'message:voice', 'message:animation', 'message:sticker', 'message:text'], (ctx) => handleBackup(bot, ctx));

  bot.catch((err) => log('ERROR', err.message));
  return bot;
}
