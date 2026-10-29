"""Authenticated CAgent adapter for WeRSS's WeRead Web collector.

Reuse the existing queue, schedules, batch subscription, body cache and backoff.
Only the upstream authentication and metadata transport change. No cookies are
returned to CAgent clients. The native collector has no public port.
"""
import base64
import os
import threading
import time
from pathlib import Path
from urllib.parse import quote, urlparse

import requests
from bs4 import BeautifulSoup
from bridge import Bridge, Server, Quiet, article_address, BodyVerification
from service import SyncResult
from wechat_mp_fetcher import Article, save_article, article_exists, AuthExpiredError, RiskControlError
from wsgiref.simple_server import make_server


def clean_body(value):
    if not isinstance(value, str) or len(value) > 2 * 1024 * 1024:
        return ''
    if any(s in value for s in ('当前环境异常', '完成验证后即可继续访问', '访问过于频繁', '操作频繁')):
        return ''
    soup = BeautifulSoup(value, 'html.parser')
    for node in soup.select('script,style,iframe,object,embed,form,input,button,[hidden]'):
        node.decompose()
    for node in soup.find_all(True):
        if node.attrs is None:
            continue
        for attr in list(node.attrs):
            if attr.lower().startswith('on') or attr in ('src', 'srcset', 'data-src'):
                del node.attrs[attr]
        if 'javascript:' in str(node.get('href', '')).lower():
            del node.attrs['href']
    return str(soup) if len(soup.get_text(strip=True)) >= 20 else ''


class NativeFailure(ValueError):
    def __init__(self, code):
        self.code = code
        super().__init__('Native operation unavailable')


class NativeClient:
    def __init__(self, origin=None):
        self.origin = origin or os.environ['WERSS_NATIVE_URL']
        p = urlparse(self.origin)
        if p.scheme not in ('http', 'https') or not p.hostname or p.username or p.password or p.path not in ('', '/') or p.query or p.fragment:
            raise ValueError('invalid native origin')
        self.token, self.expires = '', 0
        self.lock = threading.RLock()

    def request(self, path, method='GET', data=None, timeout=20, _retry=True):
        # One native administrative login; never retry a harvest automatically.
        with self.lock:
            if self.expires <= time.monotonic():
                r = requests.post(self.origin + '/api/v1/wx/auth/login',
                                  data={'username': os.getenv('CAgent_USER', 'cagent'), 'password': os.environ['CAgent_PASSWORD']},
                                  timeout=15, allow_redirects=False)
                r.raise_for_status()
                body = r.json()
                if body.get('code') != 0 or not body.get('data', {}).get('access_token'):
                    raise ValueError('native authentication failed')
                self.token = body['data']['access_token']
                self.expires = time.monotonic() + 600
            token = self.token
        r = requests.request(method, self.origin + '/api/v1/wx' + path,
                             headers={'Authorization': 'Bearer ' + token}, json=data,
                             timeout=timeout, allow_redirects=False)
        try:
            result = r.json()
        except ValueError:
            raise ValueError('native response is not JSON') from None
        auth_required = isinstance(result, dict) and isinstance(result.get('data'), dict) and result['data'].get('code') == 'AUTH_REQUIRED'
        if r.status_code == 401 and not auth_required:
            self.expires = 0
            if _retry and (method == 'GET' or path == '/weread/article-content'):
                return self.request(path, method=method, data=data, timeout=timeout, _retry=False)
        if isinstance(result, dict) and result.get('code') not in (None, 0):
            return result
        r.raise_for_status()
        return result

    def data(self, path, **kwargs):
        body = self.request(path, **kwargs)
        if body.get('code') != 0:
            raise NativeFailure((body.get('data') or {}).get('code', body.get('code')))
        return body.get('data') or {}

    def image(self):
        r = requests.get(self.origin + '/static/weread_qrcode.png', timeout=10, allow_redirects=False)
        r.raise_for_status()
        if len(r.content) > 300000 or not r.content.startswith(b'\x89PNG\r\n\x1a\n'):
            raise ValueError('invalid native QR image')
        return r.content


class WebCredentials:
    def __init__(self, client):
        self.client = client
        self.cached, self.until = False, 0

    def status(self):
        if time.monotonic() >= self.until:
            # Native /weread also contains credentials. Only retain this boolean.
            self.cached = self.client.data('/weread').get('configured') is True
            self.until = time.monotonic() + 5
        return {'configured': self.cached}


class WebLogin:
    def __init__(self, client, credentials, db):
        self.client, self.credentials, self.db = client, credentials, db

    def start(self):
        self.client.data('/weread/qr/code')
        self.credentials.until = 0
        self.db.set_setting('web_login_pending', '1')

    def status(self):
        native = self.client.data('/weread/qr/status')
        if native.get('login_status') is True and self.db.get_setting('web_login_pending') == '1':
            self.credentials.until = 0
            if self.credentials.status()['configured']:
                self.db.set_setting('auth_required', '0')
                self.db.set_setting('web_login_pending', '0')
        message = str(native.get('msg', ''))
        pending = self.db.get_setting('web_login_pending') == '1'
        failed = self.db.get_setting('auth_required') == '1'
        status = 'expired' if '过期' in message else 'error' if native.get('data', {}).get('logicCode') == 'COOKIE_INVALID' else 'waiting' if pending else 'expired' if failed else 'authorized' if self.credentials.status()['configured'] else 'waiting'
        qr = ''
        if status == 'waiting' and native.get('code_url'):
            try:
                qr = 'data:image/png;base64,' + base64.b64encode(self.client.image()).decode()
            except (requests.RequestException, ValueError):
                pass
        return {'status': status, 'qr': qr}


class WebService:
    def __init__(self, db, client):
        self.db, self.client = db, client

    def resolve_article_url(self, review_id):
        article = self.db.article_by_review(review_id)
        if not article or not article.url:
            raise ValueError('article URL unavailable')
        return article.url

    def sync_source(self, source_id):
        source = self.db.get_source(source_id)
        run = self.db.mark_sync_start(source.id)
        try:
            response = self.client.request('/weread/collect', method='POST', timeout=150,
                data={'mp_id': source.book_id, 'faker_id': source.book_id, 'mp_name': source.name, 'gather_content': False})
            if response.get('code') != 0:
                code = (response.get('data') or {}).get('code')
                status = 'auth_expired' if code in (-2012, 'missing_cookie') else 'risk_control' if code in (-2041, -2010, -2014, 429, 499) else 'error'
                result = SyncResult(source.id, 0, 0, 0, status, 'WeRSS upstream error: ' + str(code))
            else:
                rows = self.client.data('/articles?mp_id=' + quote(source.book_id) + '&limit=20').get('list', [])
                count, new_count = 0, 0
                for row in rows[:20]:
                    if row.get('mp_id') != source.book_id or not row.get('id') or not row.get('title'):
                        continue
                    try:
                        address = article_address(row.get('url', ''))
                    except ValueError:
                        continue
                    detail = self.client.data('/articles/' + quote(str(row['id']), safe=''))
                    if detail.get('mp_id') != source.book_id:
                        continue
                    body = clean_body(detail.get('content') or detail.get('content_html') or '')
                    article = Article(review_id='WERSS:' + str(row['id']), book_id=source.book_id,
                        title=str(row['title']), url=address, publish_at=int(row.get('publish_time') or 0), content_html=body)
                    with self.db.connect() as conn:
                        old = self.db.article_by_review(article.review_id)
                        if not old:
                            new_count += 1
                        if old and old.content_html and old.title == article.title and old.publish_at == article.publish_at:
                            article.content_html = old.content_html
                        save_article(conn, article)
                        conn.commit()
                    count += 1
                result = SyncResult(source.id, count, new_count, 0, 'ok', '')
        except Exception:
            result = SyncResult(source.id, 0, 0, 0, 'error', 'WeRSS connection or response invalid')
        self.db.mark_sync_finish(source, run, result)
        return result


class WeRSSBridge(Bridge):
    body_cooldown_key = 'weread_web_body_cooldown_until'
    def __init__(self, directory, client=None):
        super().__init__(directory)
        token_file = Path(directory) / 'api-token.txt'
        if token_file.exists():
            saved = token_file.read_text().strip()
            if len(saved) < 32 or not all(c.isalnum() or c in '-_' for c in saved):
                raise ValueError('invalid saved API token')
            self.token = saved
        else:
            token_file.write_text(self.token)
        token_file.chmod(0o600)
        self.native = client or NativeClient()
        self.credentials = WebCredentials(self.native)
        self.login = WebLogin(self.native, self.credentials, self.db)
        self.service = WebService(self.db, self.native)
        if self.db.get_setting('body_transport_version') != 'weread-web-v1':
            for source in self.db.list_sources():
                job = self.job(source.book_id)
                if job.get('status') == 'CONTENT_BLOCKED':
                    self.set_job(source.book_id, {**job, 'status':'INTERRUPTED', 'retryAfter':0})
            self.db.set_setting('body_transport_version', 'weread-web-v1')

    def body_attempt_key(self, article):
        return 'weread-web:' + article.review_id

    def fetch_body(self, article):
        stored_id = article.review_id.removeprefix('WERSS:')
        try:
            result = self.native.data('/weread/article-content', method='POST',
                data={'mp_id':article.book_id, 'article_id':stored_id}, timeout=45)
            if result.get('mpId') != article.book_id or result.get('articleId') != stored_id:
                raise ValueError('article identity mismatch')
            body = clean_body(result.get('content', ''))
            if not body:
                raise BodyVerification('verified article body unavailable')
            return body
        except NativeFailure as exc:
            if exc.code in ('AUTH_REQUIRED', -2012, 'missing_cookie'):
                raise AuthExpiredError('WeRead login expired') from None
            if exc.code in ('RATE_LIMITED', -2041, -2010, -2014, 429, 499):
                raise RiskControlError('WeRead request limited') from None
            raise BodyVerification('WeRead body unavailable') from None

    def collect(self, book_id):
        result = super().collect(book_id)
        if result['status'] == 'CONTENT_BLOCKED' and result.get('metadataCount', 0):
            self.db.set_setting(self.body_cooldown_key, str(time.time()+21600))
        return result

    def route(self, env):
        status, result = super().route(env)
        if env.get('PATH_INFO') == '/api/health' and status == 200:
            result['engine'] = 'WEMP'
        if env.get('PATH_INFO') == '/api/v1/wx/auth/qr/status' and status == 200:
            result['data']['engine'] = 'WEMP'
            if result['data'].get('login_state') in ('waiting','expired','error'):
                result['data']['login_status'] = False
        return status, result

    def __call__(self, env, respond):
        if env.get('PATH_INFO') == '/static/wx_qrcode.png' and env.get('REQUEST_METHOD') == 'GET':
            try:
                body = self.native.image()
            except Exception:
                respond('404 Not Found', [('Content-Type', 'text/plain'), ('Cache-Control', 'no-store')])
                return [b'QR unavailable']
            respond('200 OK', [('Content-Type', 'image/png'), ('Content-Length', str(len(body))), ('Cache-Control', 'no-store')])
            return [body]
        return super().__call__(env, respond)


if __name__ == '__main__':
    app = WeRSSBridge(Path(os.getenv('WECHAT_MP_DATA', '/app/data')))
    threading.Thread(target=app.scheduler, daemon=True).start()
    make_server('0.0.0.0', 8001, app, server_class=Server, handler_class=Quiet).serve_forever()
