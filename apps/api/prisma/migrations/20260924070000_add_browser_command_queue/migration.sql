-- 浏览器指令队列：把「网页渲染与操控」下沉到用户本地浏览器执行。
--
-- 背景：服务器内存有限（2GB 规格跑不动 Chromium），因此服务端不再启动浏览器。
-- 改为下发指令 → 本地客户端（网页端直连 / 浏览器扩展）轮询领取 → 回填结果与截图。
-- 服务端仍保留完整留痕，后台可回放操作轨迹。

-- CreateEnum
CREATE TYPE "BrowserExecutor" AS ENUM ('SERVER', 'LOCAL');

-- AlterTable
ALTER TABLE "browser_sessions" ADD COLUMN     "client_kind" TEXT,
ADD COLUMN     "executor" "BrowserExecutor" NOT NULL DEFAULT 'LOCAL',
ADD COLUMN     "last_seen_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "browser_commands" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "selector" TEXT,
    "value" TEXT,
    "timeout" INTEGER NOT NULL DEFAULT 15000,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "screenshot_data" TEXT,
    "screenshot_path" TEXT,
    "error" TEXT,
    "url" TEXT,
    "title" TEXT,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "browser_commands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "browser_commands_session_id_status_idx" ON "browser_commands"("session_id", "status");

-- CreateIndex
CREATE INDEX "browser_commands_session_id_seq_idx" ON "browser_commands"("session_id", "seq");

-- AddForeignKey
ALTER TABLE "browser_commands" ADD CONSTRAINT "browser_commands_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "browser_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
