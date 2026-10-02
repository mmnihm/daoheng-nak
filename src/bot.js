import { Bot } from 'grammy';
import { config } from './config.js';
import {
  startCommand, helpCommand, statsCommand, listCommand,
  topicsCommand, searchCommand, restoreCommand, cleanupCommand,
} from './commands/index.js';
import { handleBackup } from './services/backup.js';
import { log } from './logger.js';

export function createBot(options = {}) {
  const bot = new Bot(config.botToken);

  bot.command('start', startCommand);
  bot.command('help', helpCommand);
  bot.command('stats', statsCommand);
  bot.command('list', listCommand);
  bot.command('topics', topicsCommand);
  bot.command('search', searchCommand);
  bot.command('restore', restoreCommand);
  bot.command('cleanup', cleanupCommand);

  // 话题服务消息（创建/改名）：登记话题名并预建备份话题。
  bot.on(['message:forum_topic_created', 'message:forum_topic_edited'], (ctx) => handleBackup(bot, ctx));

  // 任何带文件/媒体/文本的消息都视为备份请求（含话题内消息）。
  bot.on(
    [
      'message:document', 'message:photo', 'message:video', 'message:audio',
      'message:voice', 'message:animation', 'message:sticker', 'message:text',
    ],
    (ctx) => handleBackup(bot, ctx)
  );

  bot.catch((err) => log('ERROR', err.message));
  return bot;
}
