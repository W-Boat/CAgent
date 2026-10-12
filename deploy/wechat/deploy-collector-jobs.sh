#!/usr/bin/env bash
set -euo pipefail
umask 077
root=/opt/cagent-wechat
test -s /tmp/cagent_collect.py
test -s /tmp/mps-managed.py
test -s "$root/wx-managed.py"
test -z "$(docker ps -aq --filter name='^cagent-wechat-before-collection-jobs$')"
docker cp cagent-wechat:/app/apis/mps.py "$root/mps-before-jobs.py"
cmp -s "$root/mps-before-jobs.py" /tmp/collector-api-mps.py
install -m 600 /tmp/cagent_collect.py "$root/cagent_collect.py"
install -m 600 /tmp/mps-managed.py "$root/mps-managed.py"
docker exec -i cagent-wechat /app/env_x86_64/bin/python3 - <<'PY'
import sqlite3,time,json,os
from pathlib import Path
db=sqlite3.connect('/app/data/db.db');backup=sqlite3.connect('/app/data/db-before-collection-jobs.db');db.backup(backup);backup.close();db.close()
# A live diagnostic returned ret=200013. Preserve that observation across restart.
path=Path('/app/data/cagent-collection-tasks.json')
if not path.exists():
 until=time.time()+3600
 jobs={id:{'id':id,'status':'RATE_LIMITED','message':'微信返回限流码 200013，已暂停重复请求；等待后重新采集','retryAfter':until,'collected':0} for id in ['MP_WXS_3518809936','MP_WXS_3070420072']}
 path.write_text(json.dumps({'jobs':jobs,'retryAfter':until},ensure_ascii=False));os.chmod(path,0o600)
print('COLLECTOR_DATABASE_BACKUP_READY')
PY
image=$(cat "$root/image.txt")
[[ "$image" =~ ^rachelos/we-mp-rss@sha256:[0-9a-f]{64}$ ]]
docker stop cagent-wechat >/dev/null
docker rename cagent-wechat cagent-wechat-before-collection-jobs
rollback(){ docker rm -f cagent-wechat >/dev/null 2>&1 || true; docker rename cagent-wechat-before-collection-jobs cagent-wechat; docker start cagent-wechat >/dev/null; exit 1; }
trap rollback ERR
docker run -d --name cagent-wechat --network cagent_default --restart unless-stopped \
 --memory 768m --memory-swap 1g --cpus 0.6 --shm-size 128m \
 --log-opt max-size=10m --log-opt max-file=2 \
 --env-file "$root/collector.env" -v "$root/data:/app/data" \
 -v "$root/wx-managed.py:/app/driver/wx.py:ro" \
 -v "$root/mps-managed.py:/app/apis/mps.py:ro" \
 -v "$root/cagent_collect.py:/app/apis/cagent_collect.py:ro" "$image" > "$root/container-id"
ready=false
for attempt in $(seq 1 24); do
 if docker exec cagent-wechat python3 -c 'import urllib.request;urllib.request.urlopen("http://127.0.0.1:8001/",timeout=3)' >/dev/null 2>&1; then ready=true;break;fi
 sleep 3
done
$ready
docker exec cagent-wechat /app/env_x86_64/bin/python3 -c 'from pathlib import Path; compile(Path("/app/apis/cagent_collect.py").read_text(),"cagent_collect.py","exec");compile(Path("/app/apis/mps.py").read_text(),"mps.py","exec")'
trap - ERR
printf 'COLLECTOR_COLLECTION_JOBS_READY\n'
