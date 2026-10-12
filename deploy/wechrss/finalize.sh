#!/usr/bin/env bash
set -euo pipefail
umask 077
directory=/opt/cagent-releases/cagent-wechrss-20261009-194810
mkdir -p "$directory/final"
install -m 0644 /tmp/bridge.py /tmp/verify-bridge.py /tmp/migrate-sources.py "$directory/final/"
cat > "$directory/final/Dockerfile" <<'EOF'
FROM cagent-wechrss:cagent-wechrss-20261009-194810
COPY bridge.py verify-bridge.py migrate-sources.py /app/
EOF
docker build -q -t cagent-wechrss:20261009-final "$directory/final" >/dev/null
docker run --rm --network none --entrypoint python cagent-wechrss:20261009-final /app/verify-bridge.py
docker stop cagent-wechrss >/dev/null
docker rename cagent-wechrss cagent-wechrss-before-adapter-final
docker run -d --name cagent-wechrss --network cagent_default --restart unless-stopped \
 --memory 256m --memory-swap 384m --cpus 0.5 --pids-limit 64 \
 --env-file /opt/cagent-wechrss/collector.env -v /opt/cagent-wechrss/data:/app/data \
 cagent-wechrss:20261009-final >/dev/null
sleep 2
docker exec cagent-wechat /app/env_x86_64/bin/python3 -c 'import sqlite3; src=sqlite3.connect("/app/data/db.db"); dst=sqlite3.connect("/app/data/db-before-wechrss.db"); src.backup(dst);dst.close();src.close()'
docker cp cagent-wechat:/app/data/db-before-wechrss.db /tmp/wechrss-legacy.db
docker cp /tmp/wechrss-legacy.db cagent-wechrss:/tmp/legacy.db
docker exec cagent-wechrss python /app/migrate-sources.py
docker exec cagent-wechrss python -c 'import urllib.request; urllib.request.urlopen("http://127.0.0.1:8001/api/health",timeout=5); print("FINAL_COLLECTOR_READY")'
