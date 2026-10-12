"""Safe real protocol/QR check. Never print session identifiers or credentials."""
import base64
import json
import os
import time
import urllib.request
import urllib.parse

def request(path, data=None, token=''):
    body = None if data is None else data if isinstance(data, bytes) else json.dumps(data).encode()
    headers = {'Content-Type': 'application/json'} if body else {}
    if token:headers['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request('http://127.0.0.1:8001/api/v1/wx'+path,data=body,headers=headers)
    return json.load(urllib.request.urlopen(req,timeout=20))['data']

form = urllib.parse.urlencode({'username':os.getenv('CAgent_USER'),'password':os.getenv('CAgent_PASSWORD')}).encode()
token = request('/auth/login',form)['access_token']
status = request('/auth/qr/status',token=token)
assert status['engine'] == 'WECHRSS'
accounts = request('/mps',token=token)
print('ENGINE',status['engine'],'LOGGED_IN',status['login_status'],'SUBSCRIPTIONS',[(s['id'],s['mp_name'],s['autoCollect'])for s in accounts['list']])
request('/auth/qr/code',token=token)
for _ in range(25):
    status = request('/auth/qr/status',token=token)
    if status['qr_code']:
        image = request('/auth/qr/image',token=token)['image']
        png = base64.b64decode(image.split(',',1)[1]);assert png[:8] == b'\x89PNG\r\n\x1a\n'
        print('REAL_QR_READY',len(png),'bytes')
        break
    if status.get('login_state') in ('error','expired','declined'):
        print('REAL_QR_STATE',status['login_state']);raise SystemExit(1)
    time.sleep(2)
else:raise SystemExit('QR generation timeout')
