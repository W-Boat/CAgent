#!/usr/bin/env bash
set -euo pipefail
umask 077
stamp=${1:?release stamp}
[[ "$stamp" =~ ^[0-9]{8}-[0-9]{6}$ ]]
directory=/opt/cagent-releases/cagent-wechrss-20261009-194810/final
install -m 0644 /tmp/bridge.py /tmp/verify-bridge.py "$directory/"
docker build -q -t "cagent-wechrss:$stamp" "$directory" >/dev/null
docker run --rm --network none --entrypoint python "cagent-wechrss:$stamp" /app/verify-bridge.py
old="cagent-wechat-before-$stamp"
docker stop cagent-wechat >/dev/null
docker rename cagent-wechat "$old"
rollback(){ trap - ERR; docker stop cagent-wechat >/dev/null 2>&1 || true; docker rename cagent-wechat "cagent-wechat-failed-$stamp"; docker rename "$old" cagent-wechat; docker start cagent-wechat >/dev/null; exit 1; }
trap rollback ERR
docker run -d --name cagent-wechat --network cagent_default --restart unless-stopped \
 --memory 256m --memory-swap 384m --cpus 0.5 --pids-limit 64 \
 --env-file /opt/cagent-wechrss/collector.env -v /opt/cagent-wechrss/data:/app/data \
 "cagent-wechrss:$stamp" >/dev/null
ready=false
for i in $(seq 1 30); do
 if docker exec cagent-wechat python -c 'import urllib.request; urllib.request.urlopen("http://127.0.0.1:8001/api/health", timeout=3)' >/dev/null 2>&1; then ready=true; break; fi
 sleep 2
done
[[ "$ready" == true ]]
trap - ERR
printf 'ACTIVE_COLLECTOR_IMAGE='; docker inspect cagent-wechat --format '{{.Image}}'
