-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "allow_browser" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "starters" JSONB;
