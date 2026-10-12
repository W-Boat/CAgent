CREATE TABLE "evaluation_jobs" (
 "id" TEXT NOT NULL PRIMARY KEY,"user_id" TEXT NOT NULL,"title" TEXT NOT NULL,"status" TEXT NOT NULL DEFAULT 'QUEUED',
 "total" INTEGER NOT NULL,"batch_count" INTEGER NOT NULL,"completed" INTEGER NOT NULL DEFAULT 0,"succeeded" INTEGER NOT NULL DEFAULT 0,"failed" INTEGER NOT NULL DEFAULT 0,
 "options" JSONB NOT NULL,"error" TEXT,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_at" TIMESTAMP(3) NOT NULL,"started_at" TIMESTAMP(3),"finished_at" TIMESTAMP(3),
 CONSTRAINT "evaluation_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "evaluation_jobs_user_id_created_at_idx" ON "evaluation_jobs"("user_id","created_at");
CREATE INDEX "evaluation_jobs_status_created_at_idx" ON "evaluation_jobs"("status","created_at");
CREATE TABLE "evaluation_turns" (
 "id" TEXT NOT NULL PRIMARY KEY,"job_id" TEXT NOT NULL,"position" INTEGER NOT NULL,"batch_id" TEXT NOT NULL,"split" TEXT NOT NULL,"turn" INTEGER NOT NULL,
 "question" TEXT NOT NULL,"reply" TEXT NOT NULL DEFAULT '',"status" TEXT NOT NULL DEFAULT 'PENDING',"error" TEXT,"conversation_id" TEXT,"assistant_message_id" TEXT,
 "usage" JSONB NOT NULL DEFAULT '{}',"runtime" JSONB,"sources" JSONB NOT NULL DEFAULT '[]',"latency_ms" INTEGER NOT NULL DEFAULT 0,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_at" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "evaluation_turns_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "evaluation_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "evaluation_turns_job_id_position_key" ON "evaluation_turns"("job_id","position");
CREATE UNIQUE INDEX "evaluation_turns_job_id_batch_id_turn_key" ON "evaluation_turns"("job_id","batch_id","turn");
CREATE INDEX "evaluation_turns_job_id_status_idx" ON "evaluation_turns"("job_id","status");
ALTER TABLE "conversations" ADD COLUMN "evaluation_job_id" TEXT;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_evaluation_job_id_fkey" FOREIGN KEY ("evaluation_job_id") REFERENCES "evaluation_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "conversations_evaluation_job_id_idx" ON "conversations"("evaluation_job_id");
-- Keep historical records for audit and rollback; retired implementations and ORM models are removed.
UPDATE "agents" SET "enabled"=false WHERE "key" ~* '(editorial|loveline|love.line|couple)' OR "name" ~ '(人文之光|情侣空间|心屿)';
UPDATE "skills" SET "enabled"=false WHERE "key" ~* '(editorial|loveline|love.line|couple)' OR "name" ~ '(人文之光|情侣空间|心屿)';
DELETE FROM "settings" WHERE "key"='loveline_enabled';
