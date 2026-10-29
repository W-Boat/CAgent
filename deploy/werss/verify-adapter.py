import io
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path[:0] = [str(Path(__file__).parent), str(Path(__file__).parent.parent/'wechrss'), str(Path(__file__).parent.parent/'wechrss/upstream')]
from adapter import WeRSSBridge, clean_body, NativeFailure
from wechat_mp_fetcher import Article, save_article
from bridge import BodyVerification


class Native:
    def __init__(self):
        self.calls = []
        self.code = 0
        self.body = '<p>这是学校公众号的真实正文内容，仅作为隔离验证的测试数据。</p>'
        self.configured = True
        self.body_error = None
        self.confirmed = False

    def request(self, path, **kwargs):
        self.calls.append((path, kwargs))
        return {'code': self.code, 'data': {'code': -2041} if self.code else {}}

    def data(self, path, **kwargs):
        self.calls.append((path, kwargs))
        if path == '/weread':
            return {'configured': self.configured, 'cookie': 'PRIVATE_TEST_COOKIE', 'ticket': 'PRIVATE_TEST_TICKET'}
        if path == '/weread/qr/status':
            return {'login_status': self.confirmed, 'code_url': '/static/weread_qrcode.png', 'data': {'cookie': 'PRIVATE_TEST_COOKIE'}, 'msg': '等待扫码' if not self.confirmed else '登录成功'}
        if path == '/weread/article-content':
            if self.body_error:
                raise NativeFailure(self.body_error)
            return {'mpId':kwargs['data']['mp_id'], 'articleId':kwargs['data']['article_id'], 'content':self.body}
        if path.startswith('/articles?'):
            return {'list': [{'id': 'one', 'mp_id': 'MP_WXS_1', 'title': '学校通知', 'url': 'https://mp.weixin.qq.com/s/test', 'publish_time': 10}]}
        if path == '/articles/one':
            return {'mp_id': 'MP_WXS_1', 'content': getattr(self, 'metadata_body', self.body), 'description': '摘要不等于正文'}
        return {}

    def image(self):
        return b'\x89PNG\r\n\x1a\n' + b'test'


class Tests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.native = Native()
        self.app = WeRSSBridge(Path(self.tmp.name), self.native)
        self.source = self.app.db.add_source(source_value='MP_WXS_1', name='测试公众号')

    def tearDown(self):
        for _ in range(200):
            with self.app.lock:
                finished = not self.app.active and not self.app.db.get_setting('active_batch', '')
            if finished:
                break
            time.sleep(.01)
        self.tmp.cleanup()

    def call(self, path, method='GET', data=None, authorized=True):
        body = json.dumps(data or {}).encode() if method != 'GET' else b''
        return self.app.route({'PATH_INFO': '/api/v1/wx'+path, 'REQUEST_METHOD': method, 'QUERY_STRING':'',
            'CONTENT_LENGTH':str(len(body)), 'wsgi.input':io.BytesIO(body), 'HTTP_AUTHORIZATION':'Bearer '+self.app.token if authorized else ''})

    def test_readonly_and_private_credentials(self):
        self.assertEqual(self.call('/auth/qr/status', authorized=False)[0], 401)
        status, result = self.call('/auth/qr/status')
        self.assertEqual(result['data']['engine'], 'WEMP')
        self.assertTrue(result['data']['login_status'])
        self.assertNotIn('PRIVATE_TEST', json.dumps(result))
        self.call('/mps'); self.call('/mps/collection/MP_WXS_1')
        self.assertFalse(any(p == '/weread/collect' for p,_ in self.native.calls))

    def test_real_body_cache_and_dedup(self):
        with patch('bridge.public_body', side_effect=AssertionError('body already cached')):
            result = self.app.collect('MP_WXS_1')
            self.assertEqual(result['status'], 'SUCCEEDED')
            self.assertEqual(result['collected'], 1)
            self.app.collect('MP_WXS_1')
        self.assertEqual(len(self.app.db.get_articles('MP_WXS_1')), 1)
        self.assertEqual(sorted(r['new_count'] for r in self.app.db.recent_runs()), [0, 1])

    def test_metadata_not_misreported_as_body(self):
        self.native.body = ''
        with patch('bridge.public_body', side_effect=BodyVerification('manual verification')):
            result = self.app.collect('MP_WXS_1')
        self.assertEqual(result['status'], 'CONTENT_BLOCKED')
        self.assertEqual(result['collected'], 0)
        self.assertEqual(result['metadataCount'], 1)
        self.assertFalse(self.app.db.get_articles('MP_WXS_1')[0].content_html)
        self.assertGreater(float(self.app.db.get_setting(self.app.body_cooldown_key)), time.time())

    def test_backfill_metadata_uses_authenticated_body_not_public_url(self):
        self.native.body = ''
        self.app.service.sync_source(self.source.id)
        self.native.metadata_body = ''
        self.native.body = '<p>认证后的微信读书正文回补，既有文章目录也能获取真实完整内容。</p>'
        self.app.db.set_setting('body_cooldown_until', str(time.time()+21600))
        with patch('bridge.public_body', side_effect=AssertionError('must use authenticated transport')):
            result = self.app.collect('MP_WXS_1')
        self.assertEqual(result['status'], 'SUCCEEDED')
        self.assertTrue(any(path == '/weread/article-content' for path,_ in self.native.calls))
        self.assertIn('认证后的', self.app.db.get_articles('MP_WXS_1')[0].content_html)

    def test_expired_body_auth_stops_and_is_not_reported_authorized(self):
        self.native.body = ''
        self.native.body_error = 'AUTH_REQUIRED'
        result = self.app.collect('MP_WXS_1')
        self.assertEqual(result['status'], 'AUTH_REQUIRED')
        self.assertFalse(self.call('/auth/qr/status')[1]['data']['login_status'])
        self.assertEqual(sum(path == '/weread/article-content' for path,_ in self.native.calls), 1)

    def test_pending_qr_visible_even_with_old_cookie(self):
        self.app.login.start()
        result = self.call('/auth/qr/status')[1]['data']
        self.assertFalse(result['login_status'])
        self.assertTrue(result['qr_code'])
        self.native.confirmed = True
        self.assertTrue(self.call('/auth/qr/status')[1]['data']['login_status'])

    def test_risk_backoff_no_second_harvest(self):
        self.native.code = 400
        self.assertEqual(self.app.collect('MP_WXS_1')['status'], 'RATE_LIMITED')
        count = len(self.native.calls)
        self.assertEqual(self.app.start('MP_WXS_1')['status'], 'RATE_LIMITED')
        self.assertEqual(len(self.native.calls), count)

    def test_schedule_disabled_persists(self):
        self.call('/mps/automation/MP_WXS_1', 'PATCH', {'enabled':False, 'intervalMinutes':720})
        again = WeRSSBridge(Path(self.tmp.name), self.native)
        self.assertFalse(again.source('MP_WXS_1').enabled)
        self.assertEqual(again.source('MP_WXS_1').sync_interval_minutes, 720)
        self.assertFalse(again.db.due_sources())
        self.assertEqual(again.token, self.app.token)

    def test_batch_existing_and_new_no_overwrite(self):
        self.app.db.set_enabled(self.source.id, False)
        job = self.app.start_batch([{'id':'MP_WXS_1','name':'改名'}, {'id':'MP_WXS_2','name':'新公众号'}])
        for _ in range(100):
            status = self.app.batch(job['id'])
            if status['status'] not in ('RUNNING', 'QUEUED'):
                break
            time.sleep(.01)
        self.assertEqual(status['status'], 'SUCCEEDED')
        self.assertFalse(self.app.source('MP_WXS_1').enabled)
        self.assertEqual(self.app.source('MP_WXS_1').name, '测试公众号')
        self.assertIsNotNone(self.app.source('MP_WXS_2'))

    def test_body_sanitization(self):
        html = '<p onclick="alert(1)">足够长度的正确正文测试内容，只有真实正文能够进入知识库。</p><script>PRIVATE</script><a href="javascript:alert(1)">链接</a>'
        body = clean_body(html)
        self.assertNotIn('onclick',body);self.assertNotIn('script',body);self.assertNotIn('javascript:',body)
        self.assertEqual(clean_body('当前环境异常，请完成验证后即可继续访问'), '')

    def test_native_failure_sanitized_and_not_retried(self):
        with patch.object(self.native, 'request', side_effect=ValueError('PRIVATE_TEST_COOKIE')) as request:
            result = self.app.collect('MP_WXS_1')
        self.assertEqual(result['status'], 'FAILED')
        self.assertEqual(request.call_count, 1)
        self.assertNotIn('PRIVATE_TEST_COOKIE',json.dumps(self.app.db.recent_runs()))


if __name__ == '__main__':
    unittest.main(verbosity=2)
