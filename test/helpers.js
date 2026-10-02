// 测试工具：用 better-sqlite3 内存库模拟 D1，构造假 bot/ctx。
import Database from 'better-sqlite3';

// 把 better-sqlite3 适配成 D1 风格接口（prepare().bind().run/first/all）
export function makeD1() {
  const sqlite = new Database(':memory:');
  // D1 默认外键关闭；保持与 D1 行为一致
  return {
    prepare(query) {
      const stmt = sqlite.prepare(query);
      const wrap = (s) => ({
        run() { const r = s.run(); return { meta: { changes: r.changes, last_row_id: r.lastInsertRowid } }; },
        async first() { return s.get() ?? null; },
        async all() { return { results: s.all() }; },
      });
      return {
        ...wrap(stmt),
        bind(...args) { return wrap(stmt.bind(...args)); },
      };
    },
  };
}

// 用 src/db.js 的 initDb 建表，返回可用的 d1 对象
export async function makeDb() {
  const { initDb } = await import('../src/db.js');
  const d1 = makeD1();
  await initDb({ DB: d1 });
  return d1;
}

// 假 bot：记录所有 API 调用，可编程返回值
export function fakeBot({ createForumTopic, editForumTopic, deleteForumTopic, copyMessage } = {}) {
  const calls = [];
  const api = {
    createForumTopic: async (chatId, name) => {
      calls.push({ m: 'createForumTopic', chatId, name });
      if (createForumTopic) return createForumTopic(chatId, name);
      return { message_thread_id: Math.floor(1000 + Math.random() * 9000) };
    },
    editForumTopic: async (chatId, threadId, opts) => {
      calls.push({ m: 'editForumTopic', chatId, threadId, opts });
      if (editForumTopic) return editForumTopic(chatId, threadId, opts);
      return { ok: true };
    },
    deleteForumTopic: async (chatId, threadId) => {
      calls.push({ m: 'deleteForumTopic', chatId, threadId });
      if (deleteForumTopic) return deleteForumTopic(chatId, threadId);
      return { ok: true };
    },
    copyMessage: async (targetChat, fromChat, messageId, opts = {}) => {
      calls.push({ m: 'copyMessage', targetChat, fromChat, messageId, opts });
      if (copyMessage) return copyMessage(targetChat, fromChat, messageId, opts);
      return { message_id: Math.floor(100 + Math.random() * 900) };
    },
  };
  return { api, calls };
}

// 假 ctx：记录 reply 文本，可携带 message/from/chat/env
export function fakeCtx({ message, from, chat, env } = {}) {
  const replies = [];
  return {
    message,
    from: from ?? { id: 111, first_name: 'Test', username: 'tester' },
    chat: chat ?? { id: -100999, type: 'supergroup' },
    env: env ?? {},
    reply: async (text) => { replies.push(text); return { message_id: replies.length }; },
    _replies: replies,
  };
}

export function assert(cond, msg) {
  if (!cond) throw new Error('断言失败：' + msg);
}
