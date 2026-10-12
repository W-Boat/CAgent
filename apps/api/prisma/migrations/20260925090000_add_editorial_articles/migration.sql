-- 人文之光社论语料（495 篇读者投稿）。
--
-- 定位：可溯源的检索与引述。回答时必须给出篇号与原文片段，
-- 让用户能回到原文核对，而不是让模型转述成二手结论。

-- CreateTable
CREATE TABLE "editorial_articles" (
    "id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "short_title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "body_chars" INTEGER NOT NULL DEFAULT 0,
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "search_text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "editorial_articles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "editorial_articles_seq_key" ON "editorial_articles"("seq");

-- CreateIndex
CREATE INDEX "editorial_articles_seq_idx" ON "editorial_articles"("seq");
