#!/usr/bin/env bash
set -euo pipefail
umask 077
archive=${1:?archive required}
expected=${2:?sha required}
[[ "$archive" =~ ^/tmp/cagent-wechrss-[0-9]{8}-[0-9]{6}\.tgz$ ]]
[[ "$(sha256sum "$archive" | cut -d ' ' -f 1)" == "$expected" ]]
release=$(basename "$archive" .tgz)
directory=/opt/cagent-releases/$release
mkdir "$directory"
tar -xzf "$archive" -C "$directory"
mkdir -p /opt/cagent-wechrss/data
chmod 700 /opt/cagent-wechrss /opt/cagent-wechrss/data
# The adapter uses the existing private CAgent-to-collector credential, never
# the former platform session. It must obtain a separate WeRead QR session.
python3 - <<'PY'
from pathlib import Path
values={}
for line in Path('/opt/cagent/.env').read_text().splitlines():
 if '=' in line:
  key,value=line.split('=',1);values[key]=value.strip().strip('"').strip("'")
password=values.get('WECHAT_COLLECTOR_PASSWORD','')
assert password and '\n' not in password
path=Path('/opt/cagent-wechrss/collector.env')
path.write_text('CAgent_USER='+values.get('WECHAT_COLLECTOR_USER','cagent')+'\nCAgent_PASSWORD='+password+'\n')
path.chmod(0o600)
PY
docker build --progress=plain -t "cagent-wechrss:$release" "$directory" > "$directory/build.log" 2>&1
docker run -d --name cagent-wechrss --network cagent_default --restart unless-stopped \
  --memory 256m --memory-swap 384m --cpus 0.5 --pids-limit 64 \
  --env-file /opt/cagent-wechrss/collector.env \
  -v /opt/cagent-wechrss/data:/app/data "cagent-wechrss:$release" >/dev/null
ready=false
for i in $(seq 1 30); do
 if docker exec cagent-wechrss python -c 'import urllib.request; urllib.request.urlopen("http://127.0.0.1:8001/api/health", timeout=3)' >/dev/null 2>&1; then ready=true; break; fi
 sleep 2
done
[[ "$ready" == true ]]
printf 'NEW_COLLECTOR_READY=%s\n' "$release"
