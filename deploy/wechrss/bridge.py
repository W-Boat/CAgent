"""CAgent adapter for pinned WechRss. No credential relay or browser required.

Directory/authentication are upstream WechRss; body caching, shared backoff and
the authenticated compatibility API are CAgent additions. GETs never harvest.
"""
from __future__ import annotations

import hmac
import base64
import json
import os
import re
import secrets
import sqlite3
import struct
import threading
import time
import zlib
from pathlib import Path
from socketserver import ThreadingMixIn
from urllib.parse import parse_qs, unquote, urljoin, urlparse
from wsgiref.simple_server import WSGIServer, WSGIRequestHandler, make_server

import requests
import qrcode
import weread_auth
from bs4 import BeautifulSoup
from service import AppDB, CredentialStore, SyncService, APP_SCHEMA
from weread_auth import LoginManager, WeReadAuthClient
from wechat_mp_fetcher import AuthExpiredError, RiskControlError, BROWSER_UA, ARTICLE_SCHEMA
from article_identity import biz_from_url, decode_biz, extract_identity_from_html

def qr_png(text):
    """PNG QR output without a native imaging dependency or browser."""
    qr = qrcode.QRCode(box_size=8, border=3)
    qr.add_data(text)
    qr.make(fit=True)
    matrix = qr.get_matrix()
    rows = []
    for row in matrix:
        pixels = bytes(pixel for cell in row for pixel in [0 if cell else 255] * 8)
        rows.extend([b'\0' + pixels] * 8)
    width = len(matrix) * 8
    def chunk(kind, value):
        return struct.pack('!I', len(value)) + kind + value + struct.pack('!I', zlib.crc32(kind + value) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!IIBBBBB', width, width, 8, 0, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(b''.join(rows))) + chunk(b'IEND', b'')
    return 'data:image/png;base64,' + base64.b64encode(png).decode()

weread_auth.qr_data_uri = qr_png

class BodyVerification(ValueError):
    pass

def article_address(value):
    p = urlparse(value)
    if (p.scheme != 'https' or p.hostname != 'mp.weixin.qq.com' or p.port
        or p.username or p.password or not re.fullmatch(r'/s(?:/[\w-]+)?/?', p.path)):
        raise ValueError('unsupported article address')
    return value

def public_page(url):
    """No credentials, bounded streaming, validate each redirect before sending."""
    for _ in range(4):
        article_address(url)
        with requests.get(url, headers={'User-Agent': BROWSER_UA}, timeout=15,
                          allow_redirects=False, stream=True) as response:
            if response.is_redirect:
                url = urljoin(url, response.headers.get('Location', ''))
                continue
            if response.status_code == 429:
                raise BodyVerification('article rate limited')
            response.raise_for_status()
            chunks, size = [], 0
            for chunk in response.iter_content(16384):
                size += len(chunk)
                if size > 2 * 1024 * 1024:
                    raise ValueError('article too large')
                chunks.append(chunk)
            text = b''.join(chunks).decode('utf-8', errors='replace')
        if any(s in text for s in ['当前环境异常', '完成验证后即可继续访问', '访问过于频繁', '操作频繁']):
            raise BodyVerification('article requires manual verification')
        return text, url
    raise ValueError('too many redirects')

def public_body(url):
    text, _ = public_page(url)
    soup = BeautifulSoup(text, 'html.parser')
    content = soup.select_one('#js_content')
    if content is None:
        raise ValueError('article body unavailable')
    for node in content.select('script,style,iframe,object,embed,form,input,button,[hidden]'):
        node.decompose()
    for node in content.find_all(True):
        if node.attrs is None:
            continue
        for attr in list(node.attrs):
            if attr.lower().startswith('on') or attr in ('src', 'srcset', 'data-src'):
                del node.attrs[attr]
        if re.search(r'display\s*:\s*none|visibility\s*:\s*hidden', str(node.get('style', '')), re.I):
            node.decompose()
    if len(content.get_text(strip=True)) < 20:
        raise ValueError('article body too short')
    return str(content)

class ClosingConnection(sqlite3.Connection):
    def __exit__(self, *args):
        try:
            return super().__exit__(*args)
        finally:
            self.close()

class ManagedDB(AppDB):
    def connect(self):
        conn = sqlite3.connect(self.path, timeout=30, factory=ClosingConnection)
        conn.row_factory = sqlite3.Row
        conn.execute('PRAGMA journal_mode=WAL')
        conn.execute('PRAGMA foreign_keys=ON')
        conn.executescript(ARTICLE_SCHEMA + APP_SCHEMA)
        return conn

class Bridge:
    def __init__(self, directory: Path):
        directory.mkdir(parents=True, exist_ok=True)
        self.db = ManagedDB(directory / 'wechrss.db')
        self.credentials = CredentialStore(directory / 'credentials.json')
        self.service = SyncService(self.db, self.credentials, request_interval=3, timeout=15)
        self.login = LoginManager(WeReadAuthClient(timeout=15), self.persist_login)
        self.token = secrets.token_urlsafe(40)
        self.lock = threading.RLock()
        self.queue = []
        self.active = False
        self.batch_active = ''
        with self.db.connect() as conn:
            conn.execute('CREATE TABLE IF NOT EXISTS body_attempts (review_id TEXT PRIMARY KEY, retry_at INTEGER NOT NULL)')
            conn.execute("UPDATE sources SET last_status='error' WHERE last_status='running'")
            conn.commit()
        for source in self.db.list_sources():
            job = self.job(source.book_id)
            if job['status'] in ('RUNNING', 'QUEUED'):
                self.set_job(source.book_id, {**job, 'status': 'INTERRUPTED'})
        pending = self.db.get_setting('active_batch', '')
        if pending:
            try:
                batch = json.loads(self.db.get_setting('batch:' + pending))
                batch['status'] = 'INTERRUPTED'
                for item in batch['items']:
                    if item['status'] in ('WAITING', 'RUNNING'):
                        item.update(status='FAILED', message='服务器重启中断，请重试此项')
                self.db.set_setting('batch:' + pending, json.dumps(batch))
            except (ValueError, KeyError):
                pass
            self.db.set_setting('active_batch', '')

    def persist_login(self, record):
        self.credentials.save_record(record)
        self.db.set_setting('auth_required', '0')

    def source(self, book_id):
        return next((s for s in self.db.list_sources() if s.book_id == book_id), None)

    def job(self, book_id):
        try:
            job = json.loads(self.db.get_setting('job:' + book_id, '{}'))
        except ValueError:
            job = {}
        return {'id': book_id, 'status': 'NONE', 'collected': 0, **job}

    def set_job(self, book_id, job):
        self.db.set_setting('job:' + book_id, json.dumps(job))
        return job

    def start(self, book_id):
        with self.lock:
            source = self.source(book_id)
            if not source:
                return {'id': book_id, 'status': 'NOT_SUBSCRIBED', 'collected': 0}
            now = time.time()
            until = float(self.db.get_setting('cooldown_until', '0'))
            old = self.job(book_id)
            if old['status'] in ('QUEUED', 'RUNNING'):
                return old
            if until > now:
                return {'id': book_id, 'status': 'RATE_LIMITED', 'collected': 0, 'retryAfter': until}
            if not self.credentials.status()['configured'] or self.db.get_setting('auth_required') == '1':
                return {'id': book_id, 'status': 'AUTH_REQUIRED', 'collected': 0}
            if old.get('retryAfter', 0) > now and old['status'] != 'AUTH_REQUIRED':
                return old
            job = self.set_job(book_id, {'id': book_id, 'status': 'QUEUED', 'collected': 0, 'startedAt': now})
            self.queue.append(book_id)
            if not self.active:
                self.active = True
                threading.Thread(target=self.worker, daemon=True).start()
            return job

    def worker(self):
        while True:
            with self.lock:
                if not self.queue:
                    self.active = False
                    return
                book_id = self.queue.pop(0)
            try:
                self.collect(book_id)
            except Exception:
                self.set_job(book_id, {'id': book_id, 'status': 'FAILED', 'collected': 0,
                                      'finishedAt': time.time(), 'retryAfter': time.time() + 3600})

    body_cooldown_key = 'body_cooldown_until'

    def body_attempt_key(self, article):
        return article.review_id

    def fetch_body(self, article):
        return public_body(article.url or self.service.resolve_article_url(article.review_id))

    def collect(self, book_id):
        source = self.source(book_id)
        now = time.time()
        if float(self.db.get_setting('cooldown_until', '0')) > now:
            return self.set_job(book_id, {'id': book_id, 'status': 'RATE_LIMITED', 'collected': 0,
                                         'retryAfter': float(self.db.get_setting('cooldown_until'))})
        if self.db.get_setting('auth_required') == '1':
            return self.set_job(book_id, {'id': book_id, 'status': 'AUTH_REQUIRED', 'collected': 0, 'finishedAt': now})
        self.set_job(book_id, {'id': book_id, 'status': 'RUNNING', 'collected': 0, 'startedAt': now})
        previous = {a.review_id: a for a in self.db.get_articles(book_id, limit=100)}
        result = self.service.sync_source(source.id)
        # Upstream is metadata-only and writes an empty content_html on refresh.
        # Restore our cache only for unchanged article metadata.
        with self.db.connect() as conn:
            for article in self.db.get_articles(book_id, limit=100):
                old = previous.get(article.review_id)
                if old and old.content_html and old.title == article.title and old.publish_at == article.publish_at:
                    conn.execute('UPDATE articles SET content_html=? WHERE review_id=?', (old.content_html, article.review_id))
            conn.commit()
        status = {'ok': 'SUCCEEDED', 'risk_control': 'RATE_LIMITED', 'auth_expired': 'AUTH_REQUIRED'}.get(result.status, 'FAILED')
        if status == 'RATE_LIMITED':
            self.db.set_setting('cooldown_until', str(time.time() + 3600))
        if status == 'AUTH_REQUIRED':
            self.db.set_setting('auth_required', '1')
        count, blocked = 0, 0
        if status == 'SUCCEEDED':
            articles = self.db.get_articles(book_id, limit=20)
            for article in articles:
                if article.content_html:
                    count += 1
                    continue
                if float(self.db.get_setting(self.body_cooldown_key, '0')) > time.time():
                    blocked += 1
                    continue
                with self.db.connect() as conn:
                    attempt = conn.execute('SELECT retry_at FROM body_attempts WHERE review_id=?', (self.body_attempt_key(article),)).fetchone()
                if attempt and attempt[0] > time.time():
                    blocked += 1
                    continue
                try:
                    body = self.fetch_body(article)
                    with self.db.connect() as conn:
                        conn.execute('UPDATE articles SET content_html=? WHERE review_id=?', (body, article.review_id))
                        conn.execute('DELETE FROM body_attempts WHERE review_id=?', (self.body_attempt_key(article),))
                        conn.commit()
                    count += 1
                except AuthExpiredError:
                    self.db.set_setting('auth_required', '1')
                    status = 'AUTH_REQUIRED'
                    break
                except RiskControlError:
                    self.db.set_setting('cooldown_until', str(time.time() + 3600))
                    status = 'RATE_LIMITED'
                    break
                except BodyVerification:
                    self.db.set_setting(self.body_cooldown_key, str(time.time() + 21600))
                    blocked += 1
                except Exception:
                    blocked += 1
                    with self.db.connect() as conn:
                        conn.execute('INSERT INTO body_attempts VALUES(?,?) ON CONFLICT(review_id) DO UPDATE SET retry_at=excluded.retry_at',
                                     (self.body_attempt_key(article), int(time.time()) + 21600))
                        conn.commit()
                time.sleep(3)
            if status == 'SUCCEEDED':
                status = 'PARTIAL' if count and blocked else 'CONTENT_BLOCKED' if blocked else 'SUCCEEDED' if count else 'EMPTY'
        finished = time.time()
        job = {'id': book_id, 'status': status, 'collected': count, 'metadataCount': result.received,
               'blocked': blocked, 'startedAt': now, 'finishedAt': finished, 'retryAfter': finished + (3600 if status == 'RATE_LIMITED' else 60 if status == 'SUCCEEDED' else 21600)}
        self.set_job(book_id, job)
        # Schedule from completion, rather than the metadata request, including failures.
        with self.db.connect() as conn:
            conn.execute('UPDATE sources SET next_sync_at=? WHERE id=?', (int(finished) + source.sync_interval_minutes * 60, source.id))
            conn.commit()
        return job

    def scheduler(self):
        while True:
            try:
                if self.credentials.status()['configured'] and self.db.get_setting('auth_required') != '1':
                    for source in self.db.due_sources():
                        self.start(source.book_id)
            except Exception:
                pass
            time.sleep(30)

    def account(self, source):
        return {'id': source.book_id, 'mp_name': source.name or source.book_id, 'status': 1,
                'autoCollect': source.enabled, 'intervalMinutes': source.sync_interval_minutes,
                'articleCount': source.article_count, 'nextCollectAt': source.next_sync_at}

    def subscribe(self, data):
        name = str(data.get('name', ''))[:120]
        if data.get('id'):
            book_id = str(data['id'])
            if not re.fullmatch(r'MP_WXS_\d{1,20}', book_id):
                raise ValueError('invalid account id')
        else:
            url = article_address(str(data.get('url', '')))
            biz = biz_from_url(url)
            if biz and name:
                book_id = 'MP_WXS_' + decode_biz(biz)
            else:
                text, resolved = public_page(url)
                identity = extract_identity_from_html(text, url, resolved)
                if not identity:
                    raise ValueError('account identity unavailable')
                book_id = identity.book_id
                name = name or identity.account_name
        source = self.source(book_id)
        if source:
            return source, False
        if not name:
            raise ValueError('account name required')
        try:
            return self.db.add_source(source_value=book_id, name=name), True
        except Exception:
            existing = self.source(book_id)
            if existing:
                return existing, False
            raise

    def batch(self, batch_id):
        if not re.fullmatch(r'[a-f0-9]{32}', batch_id):
            raise ValueError('invalid batch id')
        value = self.db.get_setting('batch:' + batch_id)
        if not value:
            raise ValueError('batch not found')
        job = json.loads(value)
        return {**job, 'items': [{k:v for k,v in item.items() if k!='input'} for item in job['items']]}

    def start_batch(self, items):
        if not isinstance(items, list) or not 1 <= len(items) <= 50:
            raise ValueError('batch size invalid')
        for item in items:
            if not isinstance(item, dict) or len(str(item.get('name', ''))) > 120:
                raise ValueError('invalid item')
            if item.get('id'):
                if not re.fullmatch(r'MP_WXS_\d{1,20}', str(item['id'])):
                    raise ValueError('invalid account id')
            else:
                article_address(str(item.get('url', '')))
        with self.lock:
            if self.batch_active:
                active = json.loads(self.db.get_setting('batch:' + self.batch_active))
                if [item['input'] for item in active['items']] == items:
                    return self.batch(self.batch_active)
                raise ValueError('another batch is active')
            batch_id = secrets.token_hex(16)
            job = {'id': batch_id, 'status': 'QUEUED', 'total': len(items), 'items': [
                {'index':i, 'name':str(item.get('name') or item.get('id') or '待识别公众号'), 'status':'WAITING', 'message':'等待识别', 'input':item}
                for i,item in enumerate(items)]}
            self.db.set_setting('batch:' + batch_id, json.dumps(job))
            self.db.set_setting('active_batch', batch_id)
            self.batch_active = batch_id
            threading.Thread(target=self.batch_worker, args=(batch_id,), daemon=True).start()
            return {**job, 'items': [{k:v for k,v in item.items() if k!='input'} for item in job['items']]}

    def batch_worker(self, batch_id):
        try:
            job = json.loads(self.db.get_setting('batch:' + batch_id))
            job['status'] = 'RUNNING'
            for item in job['items']:
                item.update(status='RUNNING', message='正在识别并订阅')
                self.db.set_setting('batch:' + batch_id, json.dumps(job))
                try:
                    source, created = self.subscribe(item['input'])
                    item.update(id=source.book_id, name=source.name, status='SUCCEEDED' if created else 'EXISTING',
                                message='已订阅，按计划自动采集' if created else '已经订阅，保留原有采集设置')
                except Exception:
                    item.update(status='FAILED', message='无法识别公众号，请检查文章链接；长链接可补填公众号名称')
                self.db.set_setting('batch:' + batch_id, json.dumps(job))
                if item.get('input', {}).get('url'):
                    time.sleep(3)
            successes = sum(item['status'] in ('SUCCEEDED','EXISTING') for item in job['items'])
            job['status'] = 'SUCCEEDED' if successes==len(job['items']) else 'PARTIAL' if successes else 'FAILED'
            job['finishedAt'] = time.time()
            self.db.set_setting('batch:' + batch_id, json.dumps(job))
        except Exception:
            job = json.loads(self.db.get_setting('batch:' + batch_id))
            job['status'] = 'FAILED'
            for item in job['items']:
                if item['status'] in ('WAITING','RUNNING'):
                    item.update(status='FAILED',message='任务中断，请重试此项')
            self.db.set_setting('batch:' + batch_id, json.dumps(job))
        finally:
            with self.lock:
                self.batch_active = ''
                self.db.set_setting('active_batch', '')

    def route(self, env):
        path, method = env.get('PATH_INFO', ''), env.get('REQUEST_METHOD', 'GET')
        # PEP 3333 transports decoded path bytes as Latin-1, including Chinese names.
        try:
            path = path.encode('latin1').decode('utf-8')
        except (UnicodeEncodeError, UnicodeDecodeError):
            pass
        query = parse_qs(env.get('QUERY_STRING', ''))
        length = int(env.get('CONTENT_LENGTH') or 0)
        if length > 65536:
            return 413, {'code': 1}
        raw = env['wsgi.input'].read(length)
        if path == '/api/health':
            return 200, {'ok': True, 'engine': 'WECHRSS'}
        if path == '/api/v1/wx/auth/login' and method == 'POST':
            form = parse_qs(raw.decode())
            if not os.getenv('CAgent_PASSWORD') or not hmac.compare_digest(form.get('password', [''])[0], os.getenv('CAgent_PASSWORD')) or form.get('username', [''])[0] != os.getenv('CAgent_USER', 'cagent'):
                return 401, {'code': 1}
            return 200, {'code': 0, 'data': {'access_token': self.token, 'expires_in': 3600}}
        if not hmac.compare_digest(env.get('HTTP_AUTHORIZATION', ''), 'Bearer ' + self.token):
            return 401, {'code': 1}
        data = json.loads(raw) if raw else {}
        suffix = path.removeprefix('/api/v1/wx')
        if suffix == '/auth/qr/status':
            login = self.login.status()
            result = {'login_status': self.credentials.status()['configured'] and self.db.get_setting('auth_required') != '1',
                      'qr_code': bool(login.get('qr')), 'engine': 'WECHRSS', 'login_state': login['status']}
        elif suffix == '/auth/qr/code':
            self.login.start()
            result = {'started': True}
        elif suffix == '/auth/qr/image':
            result = {'image': self.login.status().get('qr', '')}
        elif suffix.startswith('/mps/search/'):
            keyword = unquote(suffix.removeprefix('/mps/search/'))
            result = {'list': [self.account(s) for s in self.db.list_sources() if keyword in s.name or keyword == s.book_id]}
        elif suffix == '/mps' and method == 'POST':
            book_id = str(data.get('mp_id', ''))
            source = self.source(book_id)
            if not source:
                source = self.db.add_source(source_value=book_id, name=str(data.get('mp_name', ''))[:120])
            result = self.account(source)
        elif suffix == '/mps' and method == 'GET':
            keyword = query.get('kw', [''])[0]
            sources = [s for s in self.db.list_sources() if not keyword or keyword in s.name or keyword in s.book_id]
            result = {'list': [self.account(s) for s in sources], 'total': len(sources)}
        elif suffix == '/mps/from-article' and method == 'POST':
            source, _ = self.subscribe(data)
            result = self.account(source)
        elif suffix == '/mps/batch' and method == 'POST':
            result = self.start_batch(data.get('items'))
        elif suffix.startswith('/mps/batch/') and method == 'GET':
            result = self.batch(suffix.removeprefix('/mps/batch/'))
        elif suffix.startswith('/mps/automation/') and method == 'PATCH':
            source = self.source(suffix.removeprefix('/mps/automation/'))
            if not source or not isinstance(data.get('enabled'), bool) or not isinstance(data.get('intervalMinutes'), int) or not 60 <= data['intervalMinutes'] <= 10080:
                return 400, {'code': 1}
            self.db.update_source(source.id, name=source.name, interval_minutes=data['intervalMinutes'], fetch_content=False,
                                  rss_limit=source.rss_limit, enabled=data['enabled'])
            next_at = max(int(time.time()), source.last_sync_at + data['intervalMinutes'] * 60) if data['enabled'] else 0
            with self.db.connect() as conn:
                conn.execute('UPDATE sources SET next_sync_at=? WHERE id=?', (next_at, source.id))
                conn.commit()
            result = self.account(self.db.get_source(source.id))
        elif suffix.startswith('/mps/collection/'):
            book_id = suffix.removeprefix('/mps/collection/')
            result = self.job(book_id)
            source = self.source(book_id)
            if source:
                result = {**result, 'autoCollect': source.enabled, 'intervalMinutes': source.sync_interval_minutes, 'nextCollectAt': source.next_sync_at}
        elif suffix.startswith('/mps/update/'):
            result = self.start(suffix.removeprefix('/mps/update/'))
        elif suffix == '/articles':
            source = self.source(query.get('mp_id', [''])[0])
            if not source:
                return 404, {'code': 1}
            limit = max(1, min(int(query.get('limit', ['30'])[0]), 100))
            result = {'list': [self.article(a, include_content=False) for a in self.db.get_articles(source.book_id, limit=limit)], 'total': source.article_count}
        elif suffix.startswith('/articles/'):
            article = self.db.article_by_review(unquote(suffix.removeprefix('/articles/')))
            if not article:
                return 404, {'code': 1}
            result = self.article(article)
        else:
            return 404, {'code': 1}
        return 200, {'code': 0, 'data': result}

    @staticmethod
    def article(a, include_content=True):
        return {'id': a.review_id, 'mp_id': a.book_id, 'title': a.title, 'url': a.url,
                **({'content': a.content_html} if include_content else {}), 'publish_time': a.publish_at}

    def __call__(self, env, respond):
        try:
            status, result = self.route(env)
        except Exception:
            status, result = 400, {'code': 1, 'message': '操作失败，请检查参数、文章链接与授权状态'}
        body = json.dumps(result, ensure_ascii=False).encode()
        respond(str(status) + ' ' + {200: 'OK', 400: 'Bad Request', 401: 'Unauthorized', 404: 'Not Found', 413: 'Too Large'}[status],
                [('Content-Type', 'application/json; charset=utf-8'), ('Content-Length', str(len(body))), ('Cache-Control', 'no-store')])
        return [body]

class Server(ThreadingMixIn, WSGIServer):
    daemon_threads = True

class Quiet(WSGIRequestHandler):
    def log_message(self, *_):
        pass

if __name__ == '__main__':
    app = Bridge(Path(os.getenv('WECHAT_MP_DATA', '/app/data')))
    threading.Thread(target=app.scheduler, daemon=True).start()
    make_server('0.0.0.0', 8001, app, server_class=Server, handler_class=Quiet).serve_forever()
