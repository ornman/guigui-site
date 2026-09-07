-- /fb v2 迁移(PRD docs/prd/guigui-feedback-system.md §6.4)
-- 执行:wrangler d1 execute guigui-feedback --remote --file migrations/002-fb-v2.sql
-- (本地先验可去 --remote 跑一遍)

ALTER TABLE fb ADD COLUMN kind TEXT DEFAULT 'problem';
ALTER TABLE fb ADD COLUMN client_id TEXT;
ALTER TABLE fb ADD COLUMN sender_uid TEXT;
ALTER TABLE fb ADD COLUMN app_ver TEXT;
ALTER TABLE fb ADD COLUMN issue_id INTEGER;
ALTER TABLE fb ADD COLUMN diag_json TEXT;   -- 结构化包全文(七区)
CREATE UNIQUE INDEX IF NOT EXISTS fb_client ON fb(client_id);

-- 实现注记 1:issue_at = issue 实际创建时间。§6.5 预算闸需要「近 1 小时内
-- 创建了多少 issue」的滚动窗口锚点;created_at 是入库时间,对账端点补建的
-- issue 发生在入库之后,二者不可混用,故加此列。
ALTER TABLE fb ADD COLUMN issue_at TEXT;
CREATE INDEX IF NOT EXISTS fb_issue_at ON fb (issue_at);

-- 实现注记 2:fb_ops = 管道自状态键值表(§6.5 报警路径)。
-- gh_fail_streak:GitHub 连续失败计数;gh_broken_since:报警置位时间。
CREATE TABLE IF NOT EXISTS fb_ops (k TEXT PRIMARY KEY, v TEXT NOT NULL);
