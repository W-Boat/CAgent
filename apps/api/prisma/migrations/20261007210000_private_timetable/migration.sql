CREATE TABLE "user_timetables" (
  "user_id" TEXT NOT NULL,
  "semester" TEXT NOT NULL,
  "courses" JSONB NOT NULL,
  "warnings" JSONB NOT NULL,
  "semester_start" TEXT,
  "campus" TEXT NOT NULL DEFAULT 'liangxiang',
  "use_in_chat" BOOLEAN NOT NULL DEFAULT false,
  "reminders_enabled" BOOLEAN NOT NULL DEFAULT false,
  "reminder_lead_minutes" INTEGER NOT NULL DEFAULT 15,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_timetables_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "user_timetables_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
