-- CreateEnum
CREATE TYPE "CampusGuideMode" AS ENUM ('GUIDE', 'FULL');

-- CreateEnum
CREATE TYPE "CampusGuideDetailStatus" AS ENUM ('full', 'basic', 'rendered', 'verified', 'attachment_only', 'link_only', 'unavailable');

-- CreateTable
CREATE TABLE "campus_guide_items" (
    "id" TEXT NOT NULL,
    "external_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "cat" TEXT NOT NULL DEFAULT '未分类',
    "type" TEXT NOT NULL DEFAULT '事项',
    "source" TEXT NOT NULL DEFAULT '',
    "name" TEXT,
    "dept" TEXT,
    "place" TEXT,
    "tel" TEXT,
    "campus" TEXT,
    "form" TEXT,
    "office_time" TEXT,
    "contact" TEXT,
    "login" TEXT,
    "access" TEXT,
    "detail_status" TEXT NOT NULL,
    "subtype" TEXT,
    "summary_short" TEXT NOT NULL DEFAULT '',
    "detail" TEXT,
    "steps" JSONB,
    "key_facts" JSONB,
    "detail_parts" JSONB,
    "extra" JSONB,
    "verified_at" TEXT,
    "note" TEXT,
    "views" INTEGER NOT NULL DEFAULT 0,
    "search_text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campus_guide_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campus_guide_runs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "mode" "CampusGuideMode" NOT NULL DEFAULT 'GUIDE',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "browser_session_id" TEXT,
    "visited_urls" JSONB,
    "step_progress" JSONB,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "campus_guide_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "campus_guide_items_external_id_key" ON "campus_guide_items"("external_id");

-- CreateIndex
CREATE INDEX "campus_guide_items_cat_idx" ON "campus_guide_items"("cat");

-- CreateIndex
CREATE INDEX "campus_guide_items_detail_status_idx" ON "campus_guide_items"("detail_status");

-- CreateIndex
CREATE INDEX "campus_guide_items_access_idx" ON "campus_guide_items"("access");

-- CreateIndex
CREATE INDEX "campus_guide_items_dept_idx" ON "campus_guide_items"("dept");

-- CreateIndex
CREATE INDEX "campus_guide_items_type_idx" ON "campus_guide_items"("type");

-- CreateIndex
CREATE UNIQUE INDEX "campus_guide_runs_browser_session_id_key" ON "campus_guide_runs"("browser_session_id");

-- CreateIndex
CREATE INDEX "campus_guide_runs_user_id_created_at_idx" ON "campus_guide_runs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "campus_guide_runs_item_id_idx" ON "campus_guide_runs"("item_id");

-- AddForeignKey
ALTER TABLE "campus_guide_runs" ADD CONSTRAINT "campus_guide_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campus_guide_runs" ADD CONSTRAINT "campus_guide_runs_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "campus_guide_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
