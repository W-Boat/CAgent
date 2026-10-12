CREATE TABLE "campus_activities" (
 "id" TEXT NOT NULL, "request_id" TEXT, "user_id" TEXT, "event_type" TEXT NOT NULL,
 "origin" TEXT NOT NULL, "entry_id" TEXT, "collection" TEXT NOT NULL DEFAULT '',
 "title" TEXT NOT NULL DEFAULT '', "url" TEXT NOT NULL DEFAULT '', "query" TEXT NOT NULL DEFAULT '',
 "result_count" INTEGER NOT NULL DEFAULT 0, "references" JSONB NOT NULL DEFAULT '[]',
 "success" BOOLEAN NOT NULL DEFAULT true, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "campus_activities_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "campus_activities_request_id_key" ON "campus_activities"("request_id");
CREATE INDEX "campus_activities_event_type_created_at_idx" ON "campus_activities"("event_type","created_at");
CREATE INDEX "campus_activities_origin_created_at_idx" ON "campus_activities"("origin","created_at");
CREATE INDEX "campus_activities_created_at_idx" ON "campus_activities"("created_at");
ALTER TABLE "campus_activities" ADD CONSTRAINT "campus_activities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
