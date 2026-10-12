#!/usr/bin/env bash
set -euo pipefail
umask 077
install -d -m 700 /opt/cagent-wechat /opt/cagent-wechat/data
python3 - <<'PY'
from pathlib import Path
import secrets,shutil
directory=Path('/opt/cagent-wechat');config=directory/'collector.env'
if not config.exists():
 config.write_text('SECRET_KEY='+secrets.token_hex(32)+'\nCAGENT_COLLECTOR_PASSWORD='+secrets.token_urlsafe(32)+'\nMAX_PAGE=1\nTHREADS=1\nGATHER.CONTENT=True\nGATHER.MODEL=web\nGATHER.CONTENT_BATCH_SIZE=2\nGATHER.CONTENT_FETCH_TIMEOUT=60\nREDIS_SERVER_MAX_MEMORY=32\nENABLE_JOB=True\nTOKEN_EXPIRE_MINUTES=4320\nLOG_LEVEL=WARNING\n')
values=dict(line.split('=',1) for line in config.read_text().splitlines() if '=' in line)
env=Path('/opt/cagent/.env');text=env.read_text();before=directory/'cagent-env-before'
if not before.exists():shutil.copy2(env,before)
desired={'WECHAT_COLLECTOR_URL':'http://cagent-wechat:8001','WECHAT_COLLECTOR_USER':'cagent','WECHAT_COLLECTOR_PASSWORD':values['CAGENT_COLLECTOR_PASSWORD']}
existing=dict(line.split('=',1) for line in text.splitlines() if '=' in line and not line.startswith('#'))
for key,value in desired.items():
 if key in existing:assert existing[key]==value,'Collector configuration already exists with different values'
 else:text+='\n'+key+'='+value
env.write_text(text+'\n');env.chmod(0o600);config.chmod(0o600)
print('COLLECTOR_CREDENTIALS_CONFIGURED')
PY
for attempt in $(seq 1 120); do
  if docker image inspect rachelos/we-mp-rss:latest >/dev/null 2>&1; then break; fi
  sleep 10
done
image=$(docker image inspect rachelos/we-mp-rss:latest --format '{{index .RepoDigests 0}}')
docker image inspect "$image" >/dev/null
printf '%s\n' "$image" > /opt/cagent-wechat/image.txt
test -z "$(docker ps -aq --filter name='^cagent-wechat$')"
extra_mount=()
if [[ -s /opt/cagent-wechat/wx-managed.py ]]; then extra_mount=(-v /opt/cagent-wechat/wx-managed.py:/app/driver/wx.py:ro); fi
if [[ -s /opt/cagent-wechat/mps-managed.py && -s /opt/cagent-wechat/cagent_collect.py ]]; then extra_mount+=(-v /opt/cagent-wechat/mps-managed.py:/app/apis/mps.py:ro -v /opt/cagent-wechat/cagent_collect.py:/app/apis/cagent_collect.py:ro); fi
docker run -d --name cagent-wechat --network cagent_default --restart unless-stopped \
  --memory 768m --memory-swap 1g --cpus 0.6 --shm-size 128m \
  --log-opt max-size=10m --log-opt max-file=2 \
  --env-file /opt/cagent-wechat/collector.env -v /opt/cagent-wechat/data:/app/data "${extra_mount[@]}" "$image" > /opt/cagent-wechat/container-id
for attempt in $(seq 1 36); do
  if docker exec cagent-wechat python3 -c 'import urllib.request; urllib.request.urlopen("http://127.0.0.1:8001/",timeout=3)' >/dev/null 2>&1; then break; fi
  sleep 5
done
docker exec -i cagent-wechat /app/env_x86_64/bin/python3 - <<'PY'
import os,sqlite3,bcrypt
db=sqlite3.connect('/app/data/db.db')
assert db.execute("select count(*) from users where username='admin'").fetchone()[0]==1
password=bcrypt.hashpw(os.environ['CAGENT_COLLECTOR_PASSWORD'].encode(),bcrypt.gensalt()).decode()
db.execute("update users set username=?,password_hash=? where username='admin'",('cagent',password));db.commit();db.close()
print('PRIVATE_COLLECTOR_USER_READY')
PY
# Clear the collector's in-memory user cache after updating its own newly created admin.
docker restart cagent-wechat >/dev/null
printf 'COLLECTOR_IMAGE=%s\n' "$image"
printf 'COLLECTOR_DEPLOYED_PRIVATE_NETWORK_ONLY\n'
