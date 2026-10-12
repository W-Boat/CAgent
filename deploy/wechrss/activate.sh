#!/usr/bin/env bash
set -euo pipefail
umask 077
directory=/opt/cagent-releases/cagent-wechrss-20261009-194810/final
install -m 0644 /tmp/bridge.py /tmp/verify-bridge.py "$directory/"
docker build -q -t cagent-wechrss:20261009-final "$directory" >/dev/null
docker run --rm --network none --entrypoint python cagent-wechrss:20261009-final /app/verify-bridge.py
docker stop cagent-wechrss >/dev/null
docker rename cagent-wechrss cagent-wechrss-before-final2
docker run -d --name cagent-wechrss --network cagent_default --restart unless-stopped \
 --memory 256m --memory-swap 384m --cpus 0.5 --pids-limit 64 \
 --env-file /opt/cagent-wechrss/collector.env -v /opt/cagent-wechrss/data:/app/data \
 cagent-wechrss:20261009-final >/dev/null
sleep 2
docker exec cagent-wechrss python -c 'import urllib.request; urllib.request.urlopen("http://127.0.0.1:8001/api/health",timeout=5)'
docker stop cagent-wechat >/dev/null
docker rename cagent-wechat cagent-wechat-before-wechrss
docker rename cagent-wechrss cagent-wechat
docker exec cagent-api node -e 'fetch("http://cagent-wechat:8001/api/health").then(r=>r.json()).then(v=>{if(v.engine!=="WECHRSS")process.exit(1);console.log("ACTIVE_ENGINE="+v.engine)})'
printf 'ACTIVE_COLLECTOR_IMAGE='; docker inspect cagent-wechat --format '{{.Image}}'
