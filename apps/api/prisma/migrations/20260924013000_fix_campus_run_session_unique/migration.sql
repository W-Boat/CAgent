-- 导览会话复用：一个浏览器会话会被同一用户的多条导览记录共用。
--
-- 原设计把 browser_session_id 设成唯一，含义是「一会话一记录」；
-- 但 open() 的实际行为是——切换事项时**保留同一个 Chromium 会话**、只换页面，
-- 同时新建一条导览记录以便分别审计。两者冲突，于是切换事项时报
--   Unique constraint failed on the fields: (`browser_session_id`)
--
-- 去掉唯一约束，改为普通索引（仍能按会话反查记录），语义变为「一会话多记录」。

DROP INDEX IF EXISTS "campus_guide_runs_browser_session_id_key";

CREATE INDEX IF NOT EXISTS "campus_guide_runs_browser_session_id_idx"
  ON "campus_guide_runs"("browser_session_id");
