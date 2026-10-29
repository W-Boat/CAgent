"""Run inside the pinned native image, without network or production volumes."""
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import cagent_content as c


BODY = '<p>学校公众号文章的隔离测试正文，必须完整可读，摘要和验证页面不能代替。</p>'


class Session:
    def __init__(self, article, subscribed=True):
        self.article, self.subscribed, self.kind = article, subscribed, None
        self.committed = False

    def query(self, kind):
        self.kind = kind
        return self

    def filter(self, *args):
        return self

    def first(self):
        return self.article if self.kind is c.Article else object() if self.subscribed else None

    def close(self):
        pass

    def commit(self):
        self.committed = True


class Tests(unittest.TestCase):
    def setUp(self):
        self.article = SimpleNamespace(id='123-123_token', mp_id='MP_WXS_123', content='', content_html='', has_content=False)
        self.session = Session(self.article)
        self.req = c.ContentRequest(mp_id='MP_WXS_123', article_id=self.article.id)

    def invoke(self, body=BODY, cookie=True):
        wx = SimpleNamespace(_load_weread_auth=lambda:None, _weread_cookies={'fixture':'private'} if cookie else {}, _get_mp_content=lambda _:body)
        with patch.object(c.DB, 'get_session', return_value=self.session), patch.object(c, 'MpsWereadMP', return_value=wx):
            return c.article_content(self.req, user=object())

    def test_identity_scope(self):
        self.assertEqual(c.review_identity('MP_WXS_123','123-123_token'), 'MP_WXS_123_token')
        for mp, article in [('MP_WXS_123','456-123_token'),('MP_WXS_123','123-456_token'),('evil','123-123_token')]:
            with self.assertRaises(ValueError):
                c.review_identity(mp,article)

    def test_backfill_and_native_rss_cache(self):
        result = self.invoke()
        self.assertEqual(result['code'],0)
        self.assertEqual(result['data']['articleId'],self.article.id)
        self.assertTrue(self.session.committed)
        self.assertTrue(self.article.has_content)
        self.assertIn('完整可读',self.article.content_html)

    def test_good_cache_needs_no_upstream(self):
        self.article.content = BODY
        with patch.object(c.DB,'get_session',return_value=self.session), patch.object(c,'MpsWereadMP',side_effect=AssertionError('no network')):
            self.assertTrue(c.article_content(self.req,user=object())['data']['cached'])

    def test_challenge_not_persisted(self):
        result = self.invoke('当前环境异常，完成验证后即可继续访问。去验证 微信公众平台')
        self.assertNotEqual(result['code'],0)
        self.assertFalse(self.session.committed)

    def test_missing_auth_and_subscription(self):
        self.assertEqual(self.invoke(cookie=False)['data']['code'],'AUTH_REQUIRED')
        self.session.subscribed=False
        self.assertEqual(self.invoke()['data']['code'],'NOT_SUBSCRIBED')

    def test_sanitization(self):
        result=c.valid_body(BODY+'<script>private</script><img src="https://invalid"><a onclick="x()" href="javascript:x()">链接</a>')
        for bad in ['script','onclick','javascript:','https://invalid']:
            self.assertNotIn(bad,result)


if __name__ == '__main__':
    unittest.main(verbosity=2)
