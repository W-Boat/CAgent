"""Authenticated, scoped WeRead body backfill for already subscribed articles."""
import re
from bs4 import BeautifulSoup
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from core.auth import get_current_user_or_ak
from core.db import DB
from core.models.article import Article
from core.models.feed import Feed
from core.wx.model.weread_mp import MpsWereadMP, WereadMPAPIError
from apis.base import success_response, error_response

router = APIRouter(prefix='/weread', tags=['微信读书正文'])


class ContentRequest(BaseModel):
    mp_id: str = Field(min_length=1, max_length=100)
    article_id: str = Field(min_length=1, max_length=300)

    class Config:
        extra = 'forbid'


def review_identity(mp_id, stored_id):
    if not re.fullmatch(r'MP_WXS_\d{1,20}', mp_id):
        raise ValueError('unsupported feed')
    prefix = mp_id.removeprefix('MP_WXS_') + '-'
    if not stored_id.startswith(prefix):
        raise ValueError('article feed mismatch')
    raw = stored_id[len(prefix):]
    review = raw if raw.startswith('MP_WXS_') else 'MP_WXS_' + raw
    if not review.startswith(mp_id + '_') or not re.fullmatch(r'MP_WXS_\d{1,20}_[A-Za-z0-9_~=-]+', review):
        raise ValueError('invalid article identity')
    return review


def valid_body(value):
    if not isinstance(value, str) or len(value.encode()) > 2*1024*1024:
        return ''
    if any(text in value for text in ('当前环境异常','完成验证后即可继续访问','访问过于频繁','操作频繁')):
        return ''
    soup = BeautifulSoup(value, 'html.parser')
    for element in soup.select('script,style,iframe,object,embed,form,input,button,[hidden]'):
        element.decompose()
    for element in soup.find_all(True):
        if element.attrs is None:
            continue
        for key in list(element.attrs):
            if key.lower().startswith('on') or key in ('src','srcset','data-src'):
                del element.attrs[key]
        if 'javascript:' in str(element.get('href','')).lower():
            del element.attrs['href']
    return str(soup) if len(soup.get_text(strip=True)) >= 20 else ''


@router.post('/article-content', summary='回补已订阅公众号的真实正文')
def article_content(req: ContentRequest, user=Depends(get_current_user_or_ak)):
    try:
        review = review_identity(req.mp_id, req.article_id)
    except ValueError:
        return error_response(400, '文章身份无效', {'code':'INVALID_ARTICLE'})
    session = DB.get_session()
    try:
        article = session.query(Article).filter(Article.id==req.article_id, Article.mp_id==req.mp_id).first()
        feed = session.query(Feed).filter(Feed.id==req.mp_id, Feed.status==1).first()
        if article is None or feed is None:
            return error_response(404, '公众号或文章不存在', {'code':'NOT_SUBSCRIBED'})
        cached = valid_body(article.content or article.content_html or '')
        if cached:
            return success_response({'articleId':article.id,'mpId':article.mp_id,'content':cached,'cached':True})
    finally:
        session.close()
    try:
        wx = MpsWereadMP()
        wx._load_weread_auth()
        if not wx._weread_cookies:
            return error_response(401, '微信读书需要重新授权', {'code':'AUTH_REQUIRED'})
        content = valid_body(wx._get_mp_content(review))
        if not content:
            return error_response(422, '正文需要验证或不可读取', {'code':'CONTENT_BLOCKED'})
    except WereadMPAPIError as exc:
        code = 'AUTH_REQUIRED' if exc.code in (-2012,'missing_cookie') else 'RATE_LIMITED' if exc.code in (-2041,-2010,-2014,429,499) else 'CONTENT_BLOCKED'
        return error_response(400, '微信读书正文暂不可读取', {'code':code})
    except Exception:
        return error_response(503, '微信读书正文请求未完成', {'code':'TEMPORARY_ERROR'})
    session = DB.get_session()
    try:
        article = session.query(Article).filter(Article.id==req.article_id, Article.mp_id==req.mp_id).first()
        if article is None:
            return error_response(404, '文章已不存在', {'code':'NOT_SUBSCRIBED'})
        article.content = content
        article.content_html = content
        article.has_content = True
        session.commit()
        return success_response({'articleId':article.id,'mpId':article.mp_id,'content':content,'cached':False})
    finally:
        session.close()
