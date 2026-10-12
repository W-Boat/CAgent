-- CreateEnum
CREATE TYPE "LoveVisibility" AS ENUM ('SHARED', 'PRIVATE');

-- CreateEnum
CREATE TYPE "LoveTaskStatus" AS ENUM ('OPEN', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LoveWishKind" AS ENUM ('PLACE', 'THING', 'EXPERIENCE', 'OTHER');

-- CreateEnum
CREATE TYPE "LoveWishStatus" AS ENUM ('OPEN', 'PLANNED', 'FULFILLED', 'DROPPED');

-- AlterEnum
ALTER TYPE "UsageSource" ADD VALUE 'LOVELINE';

-- CreateTable
CREATE TABLE "couples" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '我们的空间',
    "member_a_id" TEXT NOT NULL,
    "member_b_id" TEXT,
    "together_since" TIMESTAMP(3) NOT NULL,
    "invite_code" TEXT,
    "theme" TEXT NOT NULL DEFAULT 'rose',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "couples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "love_moments" (
    "id" TEXT NOT NULL,
    "couple_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "happened_at" TIMESTAMP(3) NOT NULL,
    "mood" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "visibility" "LoveVisibility" NOT NULL DEFAULT 'SHARED',
    "created_by_agent" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "love_moments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "love_tasks" (
    "id" TEXT NOT NULL,
    "couple_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "assignee" TEXT NOT NULL DEFAULT 'both',
    "priority" INTEGER NOT NULL DEFAULT 2,
    "due_at" TIMESTAMP(3),
    "status" "LoveTaskStatus" NOT NULL DEFAULT 'OPEN',
    "created_by_agent" BOOLEAN NOT NULL DEFAULT false,
    "done_at" TIMESTAMP(3),
    "done_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "love_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "love_wishes" (
    "id" TEXT NOT NULL,
    "couple_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "kind" "LoveWishKind" NOT NULL DEFAULT 'OTHER',
    "price" DOUBLE PRECISION,
    "url" TEXT,
    "for_partner" BOOLEAN NOT NULL DEFAULT false,
    "status" "LoveWishStatus" NOT NULL DEFAULT 'OPEN',
    "created_by_agent" BOOLEAN NOT NULL DEFAULT false,
    "fulfilled_at" TIMESTAMP(3),
    "fulfilled_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "love_wishes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "couples_member_a_id_key" ON "couples"("member_a_id");

-- CreateIndex
CREATE UNIQUE INDEX "couples_member_b_id_key" ON "couples"("member_b_id");

-- CreateIndex
CREATE UNIQUE INDEX "couples_invite_code_key" ON "couples"("invite_code");

-- CreateIndex
CREATE INDEX "couples_member_a_id_idx" ON "couples"("member_a_id");

-- CreateIndex
CREATE INDEX "couples_member_b_id_idx" ON "couples"("member_b_id");

-- CreateIndex
CREATE INDEX "love_moments_couple_id_happened_at_idx" ON "love_moments"("couple_id", "happened_at");

-- CreateIndex
CREATE INDEX "love_moments_couple_id_visibility_idx" ON "love_moments"("couple_id", "visibility");

-- CreateIndex
CREATE INDEX "love_tasks_couple_id_status_idx" ON "love_tasks"("couple_id", "status");

-- CreateIndex
CREATE INDEX "love_tasks_couple_id_due_at_idx" ON "love_tasks"("couple_id", "due_at");

-- CreateIndex
CREATE INDEX "love_wishes_couple_id_status_idx" ON "love_wishes"("couple_id", "status");

-- AddForeignKey
ALTER TABLE "couples" ADD CONSTRAINT "couples_member_a_id_fkey" FOREIGN KEY ("member_a_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "couples" ADD CONSTRAINT "couples_member_b_id_fkey" FOREIGN KEY ("member_b_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "love_moments" ADD CONSTRAINT "love_moments_couple_id_fkey" FOREIGN KEY ("couple_id") REFERENCES "couples"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "love_moments" ADD CONSTRAINT "love_moments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "love_tasks" ADD CONSTRAINT "love_tasks_couple_id_fkey" FOREIGN KEY ("couple_id") REFERENCES "couples"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "love_tasks" ADD CONSTRAINT "love_tasks_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "love_tasks" ADD CONSTRAINT "love_tasks_done_by_id_fkey" FOREIGN KEY ("done_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "love_wishes" ADD CONSTRAINT "love_wishes_couple_id_fkey" FOREIGN KEY ("couple_id") REFERENCES "couples"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "love_wishes" ADD CONSTRAINT "love_wishes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

