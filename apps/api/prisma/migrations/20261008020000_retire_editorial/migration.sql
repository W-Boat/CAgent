-- Keep historical data, but permanently retire the old capability family.
UPDATE "agents" SET "enabled" = false WHERE "key" ILIKE '%editorial%' OR "name" LIKE '%人文之光%';
UPDATE "skills" SET "enabled" = false WHERE "key" ILIKE '%editorial%' OR "name" LIKE '%人文之光%';
