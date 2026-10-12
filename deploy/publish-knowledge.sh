#!/usr/bin/env bash
# Build in an isolated release directory, then migrate and activate the API.
set -euo pipefail
umask 077
archive=${1:?archive required}
expected=${2:?SHA-256 required}
[[ "$archive" =~ ^/tmp/cagent-knowledge-[0-9]{8}-[0-9]{6}\.tgz$ ]]
[[ "$expected" =~ ^[0-9a-f]{64}$ ]]
[[ "$(sha256sum "$archive" | cut -d ' ' -f 1)" == "$expected" ]]
release=$(basename "$archive" .tgz)
release_dir=/opt/cagent-releases/$release
backup=/opt/cagent-backups/$release
mkdir -p /opt/cagent-releases /opt/cagent-backups
mkdir "$release_dir" "$backup"
tar -xzf "$archive" -C "$release_dir"
# File modes affect COPY cache keys. Windows archives may normalize modes;
# preserve the existing dependency-file modes without changing their contents.
for file in package.json tsconfig.json tsconfig.build.json; do
  chmod --reference="/opt/cagent/apps/api/$file" "$release_dir/apps/api/$file"
done
cd /opt/cagent
sha256sum -c "$release_dir/baseline-sha256.txt" > "$backup/source-check.log"
while IFS= read -r file; do test ! -e "$file"; done < "$release_dir/new-files.txt"
docker logs --tail 100 cagent-api > "$backup/api-before.log" 2>&1
old_image=$(docker inspect cagent-api --format '{{.Image}}')
image_tag=$(docker inspect cagent-api --format '{{.Config.Image}}')
docker tag "$old_image" "cagent-api:before-$release"
printf '%s\n' "$old_image" > "$backup/old-image.txt"
printf '%s\n' "$image_tag" > "$backup/image-tag.txt"
docker exec cagent-db pg_dump -U cagent -d cagent -Fc > "$backup/db-before.dump"
test -s "$backup/db-before.dump"
docker exec -i cagent-db pg_restore -l < "$backup/db-before.dump" > "$backup/db-contents.txt"
tar -czf "$backup/api-source.tgz" apps/api/src apps/api/prisma apps/api/scripts apps/api/package.json apps/api/Dockerfile
printf 'BACKUP=%s\nBUILDING=%s\n' "$backup" "$release"
docker build --progress=plain -f "$release_dir/apps/api/Dockerfile" -t "cagent-api:$release" "$release_dir" 2>&1 | tee "$backup/build.log"
docker tag "cagent-api:$release" "$image_tag"
rollback() {
  trap - ERR
  docker tag "$old_image" "$image_tag"
  docker compose up -d --no-build --force-recreate api
  printf 'IMAGE_ROLLBACK=%s\nBACKUP=%s\n' "$old_image" "$backup" >&2
  exit 1
}
trap rollback ERR
docker compose run --rm --no-deps api npx prisma migrate deploy
docker compose up -d --no-build --force-recreate api
ready=false
for i in $(seq 1 45); do
  if curl -fsS http://127.0.0.1:8080/api/trial/quota > "$backup/quota-after.json"; then ready=true; break; fi
  sleep 2
done
[[ "$ready" == true ]]
docker exec cagent-api test -f dist/src/knowledge/knowledge-admin.service.js
docker exec cagent-api node -e 'require("pg");require("mysql2/promise");console.log("EXTERNAL_DRIVERS=READY")'
docker cp "$release_dir/knowledge/dist/campus-kb.json" cagent-api:/tmp/campus-kb.json
docker exec cagent-api node scripts/import-campus-guide.mjs /tmp/campus-kb.json
# Persist the audited release files for the next ordinary Docker build.
rsync -a "$release_dir/apps/api/" /opt/cagent/apps/api/
mkdir -p /opt/cagent/knowledge/dist
rsync -a "$release_dir/knowledge/" /opt/cagent/knowledge/
trap - ERR
printf 'ACTIVE_IMAGE='; docker inspect cagent-api --format '{{.Image}}'
printf 'RELEASE=%s\nBACKUP=%s\n' "$release_dir" "$backup"
