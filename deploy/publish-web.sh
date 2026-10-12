#!/usr/bin/env bash
# Publish a verified frontend archive while preserving the nginx bind mount.
# Keep old hashed assets available for tabs that were opened before the release.
set -euo pipefail
archive=${1:?archive path required}
expected=${2:?SHA-256 required}
[[ "$archive" =~ ^/tmp/cagent-web-[0-9]{8}-[0-9]{6}\.tgz$ ]]
[[ "$expected" =~ ^[0-9a-f]{64}$ ]]
actual=$(sha256sum "$archive" | cut -d ' ' -f 1)
[[ "$actual" == "$expected" ]]
dist=/opt/cagent/apps/web/dist
[[ "$(readlink -f "$dist")" == "$dist" ]]
inode=$(stat -c %i "$dist")
release=$(basename "$archive" .tgz)
backup=/opt/cagent-backups/dist-$release
stage=$(mktemp -d /tmp/cagent-web.XXXXXX)
tar -xzf "$archive" -C "$stage"
# mktemp starts at 0700; rsync -a also copies the source directory mode.
# The public nginx worker must be able to traverse the published root.
chmod 0755 "$stage"
find "$stage" -type d -exec chmod 0755 {} +
find "$stage" -type f -exec chmod 0644 {} +
test -s "$stage/index.html"
test -d "$stage/assets"
mkdir -p /opt/cagent-backups
mkdir "$backup"
cp -a "$dist/." "$backup/"
rollback() {
  trap - ERR
  rsync -a --delete "$backup/" "$dist/"
  printf 'ROLLBACK=%s\n' "$backup" >&2
  exit 1
}
trap rollback ERR
rsync -a --delay-updates "$stage/assets/" "$dist/assets/"
rsync -a --delay-updates --exclude='/assets/' "$stage/" "$dist/"
[[ "$(stat -c %i "$dist")" == "$inode" ]]
cmp -s "$stage/index.html" "$dist/index.html"
while IFS= read -r entry; do
  curl -fsS "http://127.0.0.1:8080$entry" -o /dev/null
done < <(grep -oE '/assets/[^" ]+\.(js|css)' "$stage/index.html" | sort -u)
curl -fsS http://127.0.0.1:8080/test -o "$stage/served.html"
cmp -s "$stage/index.html" "$stage/served.html"
trap - ERR
printf 'BACKUP=%s\nINODE=%s\nINDEX_SHA256=' "$backup" "$inode"
sha256sum "$dist/index.html" | cut -d ' ' -f 1
# stage is our mktemp directory, never the mounted dist directory.
[[ "$stage" =~ ^/tmp/cagent-web\.[a-zA-Z0-9]+$ ]] && rm -rf -- "$stage"
