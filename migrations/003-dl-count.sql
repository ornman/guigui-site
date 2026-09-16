-- /download 下载计数迁移(2026-09-16)
-- 执行:wrangler d1 execute guigui-feedback --remote --file migrations/003-dl-count.sql
-- (本地先验可去 --remote 跑一遍)

-- 一次 GET /download = 一条事件;口径与判 bot 规则见 lib/dl-core.js 头注。
CREATE TABLE IF NOT EXISTS download_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,     -- 与 fb 同口径:'YYYY-MM-DD HH:MM:SS'(UTC)
  ver TEXT,                     -- version.json latest(计数时点;读不到为 NULL)
  ua  TEXT,                     -- 截 200,统计端 JS 统一判 bot
  country TEXT                  -- request.cf.country(可空)
);
CREATE INDEX IF NOT EXISTS idx_download_events_created_at ON download_events(created_at);
