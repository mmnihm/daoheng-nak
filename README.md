# Telegram 备份机器人 · Cloudflare Workers

一个跑在 Cloudflare Workers 上的 Telegram 备份机器人。把文件、图片、视频、语音或文字直接发给它，它会自动复制归档到指定备份频道，并用 D1 建立可搜索的索引。

## 功能

- 📥 自动归档：文档、图片、视频、音频、语音、GIF、贴纸、文字
- ♻️ 文件去重：同一文件不会重复备份
- 📊 统计：总数、总大小、按类型分布
- 🗂️ 列表 / 🔎 搜索：按文件名、说明、发送者搜索
- 🔁 恢复：按 ID 重新发送一份备份
- 🧹 清理：按天数清理过期索引
- 🔐 仅管理员可用

## 部署

1. 在 Cloudflare 创建一个 D1 数据库，名称用 `telegram-backup-bot-db`，把 ID 填入 `wrangler.toml`。
2. 在 Worker Secrets/Variables 设置：
   - `BOT_TOKEN`：Telegram Bot Token（必须用 Secret）
   - `ADMIN_IDS`：管理员 Numeric User ID，多个用英文逗号分隔
   - `BACKUP_CHANNEL_ID`：备份频道/群 Chat ID，机器人需为该频道管理员
   - `RETENTION_DAYS`（可选）：保留天数，用于 `/cleanup`
3. `npm install && npm run deploy`
4. 建表：`npm run db:apply`
5. 设置 Webhook：
   ```
   https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://你的Worker域名/webhook
   ```

## 使用

直接给机器人发文件/消息即自动备份。命令：

| 命令 | 说明 |
| --- | --- |
| `/start` `/help` | 帮助 |
| `/stats` | 备份统计 |
| `/list` | 最近备份 |
| `/search 关键词` | 搜索备份 |
| `/restore <ID>` | 重新发送一份备份 |
| `/cleanup <天数>` | 清理 N 天前的索引 |

## 说明

- 备份采用 Telegram 消息复制机制，文件不经过 Worker 下载，速度快且不占 Worker 体积。
- `/cleanup` 只清理索引记录，不会删除备份频道中的消息。
