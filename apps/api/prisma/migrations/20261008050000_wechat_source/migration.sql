ALTER TABLE "knowledge_bases" ADD COLUMN "last_sync_summary" JSONB;
ALTER TABLE "knowledge_bases"
  ADD COLUMN "ai_review_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "ai_summary_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "automation_model_id" TEXT,
  ADD COLUMN "automation_user_id" TEXT;
ALTER TABLE "knowledge_entries"
  ADD COLUMN "summary" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "ai_review_status" TEXT NOT NULL DEFAULT 'IDLE',
  ADD COLUMN "ai_review" JSONB,
  ADD COLUMN "automation_fingerprint" TEXT,
  ADD COLUMN "automation_updated_at" TIMESTAMP(3);
CREATE INDEX "knowledge_entries_ai_review_status_idx" ON "knowledge_entries"("ai_review_status");
