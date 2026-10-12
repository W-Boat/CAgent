-- 体验版 /test：免登录试用 + 每轮问卷。IP 维度限 5 轮/日，数据用于满意度统计。

-- CreateTable
CREATE TABLE "trial_rounds" (
    "id" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "model_key" TEXT NOT NULL DEFAULT 'deepseek-chat',
    "latency_ms" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "trial_surveys" (
    "id" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "round_id" TEXT,
    "overall" INTEGER NOT NULL,
    "problems" JSONB,
    "wants" JSONB,
    "advice" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "trial_rounds_ip_created_at_idx" ON "trial_rounds"("ip", "created_at");
CREATE INDEX "trial_rounds_created_at_idx" ON "trial_rounds"("created_at");
CREATE INDEX "trial_surveys_created_at_idx" ON "trial_surveys"("created_at");

