-- 自学习反馈机制
--
-- 目标：把「用户实际怎么用、哪里答错了」沉淀成智能体自己的经验，
-- 且**必须人工审核后才注入提示词**——自动改写提示词风险太高，
-- 一条被污染的「经验」会影响之后所有学生。
--
-- 数据流：
--   用户点赞/点踩/写纠正  →  message_feedback
--   系统据此提炼经验      →  agent_learnings(PENDING)
--   管理员审核通过        →  APPROVED，注入智能体系统提示词
--   注入时累加 injected_count，便于之后评估价值

CREATE TYPE "FeedbackSource" AS ENUM ('EXPLICIT', 'IMPLICIT');
CREATE TYPE "LearningKind" AS ENUM ('CORRECTION', 'PREFERENCE', 'FAQ');
CREATE TYPE "LearningStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "message_feedback" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "agent_id" TEXT,
    "positive" BOOLEAN NOT NULL,
    "source" "FeedbackSource" NOT NULL DEFAULT 'EXPLICIT',
    "reason" TEXT,
    "correction" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_feedback_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_learnings" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "kind" "LearningKind" NOT NULL,
    "status" "LearningStatus" NOT NULL DEFAULT 'PENDING',
    "instruction" TEXT NOT NULL,
    "evidence" JSONB,
    "sample_question" TEXT,
    "support_count" INTEGER NOT NULL DEFAULT 1,
    "injected_count" INTEGER NOT NULL DEFAULT 0,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_learnings_pkey" PRIMARY KEY ("id")
);

-- 一个用户对一条消息只有一条评价，重复提交走更新
CREATE UNIQUE INDEX "message_feedback_message_id_user_id_key"
  ON "message_feedback"("message_id", "user_id");

CREATE INDEX "message_feedback_agent_id_created_at_idx"
  ON "message_feedback"("agent_id", "created_at");

CREATE INDEX "agent_learnings_agent_id_status_idx"
  ON "agent_learnings"("agent_id", "status");

ALTER TABLE "message_feedback"
  ADD CONSTRAINT "message_feedback_message_id_fkey"
  FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "message_feedback"
  ADD CONSTRAINT "message_feedback_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_learnings"
  ADD CONSTRAINT "agent_learnings_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_learnings"
  ADD CONSTRAINT "agent_learnings_reviewed_by_id_fkey"
  FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
