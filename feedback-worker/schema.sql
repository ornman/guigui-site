-- 桂桂官网反馈表
CREATE TABLE IF NOT EXISTS fb (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  ip         TEXT,          -- 仅用于限流与排查
  ua         TEXT,
  what       TEXT NOT NULL, -- 什么现象
  when_desc  TEXT,          -- 哪天早上
  contact    TEXT,          -- 联系方式(可选)
  log        TEXT           -- 日志末尾(可选)
);
CREATE INDEX IF NOT EXISTS fb_ip_time ON fb (ip, created_at);
