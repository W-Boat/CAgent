-- CreateEnum
CREATE TYPE "MemorySource" AS ENUM ('USER_EXPLICIT', 'SYSTEM_INFERRED', 'USER_EXTRACTED');

-- CreateEnum
CREATE TYPE "MemoryStatus" AS ENUM ('PENDING', 'ACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "user_memories" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "agent_id" TEXT,
    "source" "MemorySource" NOT NULL DEFAULT 'USER_EXPLICIT',
    "status" "MemoryStatus" NOT NULL DEFAULT 'ACTIVE',
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "importance" INTEGER NOT NULL DEFAULT 3,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3),
    "source_conversation_id" TEXT,
    "source_message_id" TEXT,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_memories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_memories_user_id_status_idx" ON "user_memories"("user_id", "status");

-- CreateIndex
CREATE INDEX "user_memories_agent_id_status_idx" ON "user_memories"("agent_id", "status");

-- CreateIndex
CREATE INDEX "user_memories_category_idx" ON "user_memories"("category");

-- CreateIndex
CREATE INDEX "user_memories_importance_idx" ON "user_memories"("importance");

-- AddForeignKey
ALTER TABLE "user_memories" ADD CONSTRAINT "user_memories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_memories" ADD CONSTRAINT "user_memories_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
