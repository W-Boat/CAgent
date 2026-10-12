import io
import json
import os
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path[:0] = [str(Path(__file__).parent), str(Path(__file__).parent / 'upstream')]
from bridge import Bridge, article_address, public_body
from service import SyncResult
from wechat_mp_fetcher import Article, save_article

class Tests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.app = Bridge(Path(self.tmp.name))
        self.source = self.app.db.add_source(source_value='MP_WXS_1', name='测试公众号')
        self.app.credentials.status = lambda: {'configured': True}

    def tearDown(self):
        self.tmp.cleanup()

    def request(self, path, method='GET', data=None, token=True):
        raw = json.dumps(data or {}).encode() if method != 'GET' else b''
        path, _, query = path.partition('?')
        return self.app.route({'PATH_INFO': '/api/v1/wx' + path, 'REQUEST_METHOD': method,
                               'QUERY_STRING': query,
                               'CONTENT_LENGTH': str(len(raw)), 'wsgi.input': io.BytesIO(raw),
                               'HTTP_AUTHORIZATION': 'Bearer ' + self.app.token if token else ''})

    def seed_article(self, body=''):
        article = Article('review-1', 'MP_WXS_1', '通知', '', '', 'https://mp.weixin.qq.com/s/test', 10, 'origin', 0, 0, content_html=body)
        with self.app.db.connect() as conn:
            save_article(conn, article)
            conn.commit()

    def test_readonly_auth_and_no_credentials(self):
        self.assertEqual(self.request('/mps', token=False)[0], 401)
        with patch.object(self.app.service, 'sync_source', side_effect=AssertionError('GET must not harvest')):
            self.request('/mps')
            self.request('/mps/collection/MP_WXS_1')
        _, result = self.request('/auth/qr/status')
        self.assertEqual(result['data']['engine'], 'WECHRSS')
        self.assertNotIn(self.app.token, json.dumps(result))
        self.assertEqual(self.request('/mps/automation/MP_WXS_1','PATCH',{'enabled':False,'intervalMinutes':360})[0],200)
        self.assertFalse(self.app.source('MP_WXS_1').enabled)
        self.assertFalse(self.app.db.due_sources())

    def test_body_cache_survives_metadata_refresh_and_restart(self):
        self.seed_article('<div>已采集正文</div>')
        def metadata(_):
            self.seed_article('')
            return SyncResult(self.source.id, 1, 0, 0, 'ok')
        with patch.object(self.app.service, 'sync_source', side_effect=metadata), patch('bridge.public_body', side_effect=AssertionError('must use cache')):
            job = self.app.collect('MP_WXS_1')
        self.assertEqual(job['status'], 'SUCCEEDED')
        self.assertEqual(job['collected'], 1)
        self.assertEqual(Bridge(Path(self.tmp.name)).job('MP_WXS_1')['status'], 'SUCCEEDED')
        self.assertTrue(self.app.db.article_by_review('review-1').content_html)

    def test_blocked_body_not_replaced_with_summary(self):
        self.seed_article()
        with patch.object(self.app.service, 'sync_source', return_value=SyncResult(self.source.id,1,0,0,'ok')), patch('bridge.public_body', side_effect=ValueError('blocked')):
            job = self.app.collect('MP_WXS_1')
        self.assertEqual(job['status'], 'CONTENT_BLOCKED')
        self.assertEqual(job['collected'], 0)
        self.assertFalse(self.app.db.article_by_review('review-1').content_html)

    def test_shared_cooldown_stops_queued_and_persists(self):
        second = self.app.db.add_source(source_value='MP_WXS_2', name='第二个公众号')
        with patch.object(self.app.service, 'sync_source', return_value=SyncResult(self.source.id,0,0,0,'risk_control')) as gather:
            self.app.collect('MP_WXS_1')
            self.assertEqual(self.app.start(second.book_id)['status'], 'RATE_LIMITED')
            self.app.collect(second.book_id)
            self.assertEqual(gather.call_count, 1)
        reloaded = Bridge(Path(self.tmp.name))
        reloaded.credentials.status = lambda: {'configured': True}
        self.assertEqual(reloaded.start(second.book_id)['status'], 'RATE_LIMITED')

    def test_auth_expiry_blocks_all_sources_without_retry(self):
        with patch.object(self.app.service,'sync_source',return_value=SyncResult(self.source.id,0,0,0,'auth_expired')) as gather:
            self.app.collect(self.source.book_id)
            self.assertEqual(self.app.start(self.source.book_id)['status'], 'AUTH_REQUIRED')
            second = self.app.db.add_source(source_value='MP_WXS_2', name='第二个公众号')
            self.app.collect(second.book_id)
            self.assertEqual(gather.call_count,1)

    def test_single_worker_and_duplicate_start(self):
        entered, release = threading.Event(), threading.Event()
        def collect(book_id):
            entered.set()
            release.wait(2)
            self.app.set_job(book_id, {'id':book_id,'status':'SUCCEEDED','collected':1})
        with patch.object(self.app,'collect',side_effect=collect) as gather:
            self.app.start(self.source.book_id)
            entered.wait(1)
            for _ in range(10):self.app.start(self.source.book_id)
            self.assertEqual(gather.call_count,1)
            release.set()
            for _ in range(20):
                if not self.app.active:break
                time.sleep(.01)

    def test_no_external_article_requests(self):
        for url in ('http://mp.weixin.qq.com/s/x','https://127.0.0.1/s/x','https://mp.weixin.qq.com.evil/s/x','https://u:p@mp.weixin.qq.com/s/x'):
            with self.assertRaises(ValueError):article_address(url)

    def test_chinese_subscription_search_over_wsgi(self):
        value = '/mps/search/测试公众号'.encode('utf-8').decode('latin1')
        status, result = self.request(value)
        self.assertEqual(status, 200)
        self.assertEqual(result['data']['list'][0]['id'], 'MP_WXS_1')

    def test_article_list_is_small_and_detail_preserves_fulltext(self):
        self.seed_article('<div>' + '正文' * 50000 + '</div>')
        _, result = self.request('/articles?mp_id=MP_WXS_1&limit=20')
        self.assertNotIn('content', result['data']['list'][0])
        self.assertLess(len(json.dumps(result)), 1000)
        _, detail = self.request('/articles/review-1')
        self.assertGreater(len(detail['data']['content']), 100000)

    def test_bulk_subscribe_partial_deduplicated_and_durable(self):
        rows=[{'id':'MP_WXS_1','name':'既有公众号'},{'id':'MP_WXS_2','name':'新公众号'},
              {'url':'https://mp.weixin.qq.com/s/unreadable','name':'失败示例'}]
        with patch('bridge.public_page',side_effect=ValueError('blocked')), patch('bridge.time.sleep',return_value=None):
            job=self.app.start_batch(rows)
            for _ in range(200):
                if not self.app.batch_active:break
                threading.Event().wait(.01)
        result=self.app.batch(job['id'])
        self.assertEqual(result['status'],'PARTIAL')
        self.assertEqual([i['status'] for i in result['items']],['EXISTING','SUCCEEDED','FAILED'])
        self.assertEqual(len(self.app.db.list_sources()),2)
        self.assertNotIn('input',json.dumps(result))
        self.assertNotIn('https:',json.dumps(result))
        self.assertEqual(Bridge(Path(self.tmp.name)).batch(job['id'])['status'],'PARTIAL')

    def test_bulk_validation_and_50_item_limit(self):
        with self.assertRaises(ValueError):self.app.start_batch([])
        with self.assertRaises(ValueError):self.app.start_batch([{'id':'MP_WXS_1'}]*51)
        with self.assertRaises(ValueError):self.app.start_batch([{'url':'https://127.0.0.1/s/x'}])

if __name__ == '__main__':
    unittest.main()
