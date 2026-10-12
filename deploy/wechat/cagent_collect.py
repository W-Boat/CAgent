"""Bounded, observable collection jobs for the private CAgent collector."""
import json, threading, time, os
from pathlib import Path

class CollectionFailure(RuntimeError):
    def __init__(self, status, message):
        self.status, self.message = status, message

class CollectionManager:
    def __init__(self, path, collect, cooldown=3600):
        self.path, self.collect, self.cooldown = Path(path), collect, cooldown
        self.lock, self.worker_lock = threading.Lock(), threading.Lock()
        self.jobs, self.retry_after = {}, 0
        if self.path.exists():
            try:
                saved=json.loads(self.path.read_text());self.jobs=saved.get('jobs',{});self.retry_after=saved.get('retryAfter',0)
                for job in self.jobs.values():
                    if job['status'] in ('QUEUED','RUNNING'):
                        job.update(status='INTERRUPTED', message='采集器重启中断了任务，请重新采集')
            except (ValueError, OSError): pass
    def save(self):
        self.path.parent.mkdir(parents=True,exist_ok=True)
        temp=self.path.with_suffix('.tmp');temp.write_text(json.dumps({'jobs':self.jobs,'retryAfter':self.retry_after},ensure_ascii=False));os.chmod(temp,0o600);temp.replace(self.path)
    def status(self, mp_id):
        with self.lock:
            return dict(self.jobs.get(mp_id,{'id':mp_id,'status':'NONE','message':'尚未启动采集'}))
    def start(self, mp_id):
        with self.lock:
            old=self.jobs.get(mp_id)
            if old and old['status'] in ('QUEUED','RUNNING'): return dict(old)
            now=time.time()
            if old and old.get('finishedAt',0)>now-60: return dict(old)
            if self.retry_after>now:
                job={'id':mp_id,'status':'RATE_LIMITED','message':'微信限制了文章读取，已暂停重复请求；等待后重新采集','retryAfter':self.retry_after,'collected':0}
                self.jobs[mp_id]=job;self.save();return dict(job)
            job={'id':mp_id,'status':'QUEUED','message':'等待服务器采集','startedAt':now,'collected':0}
            self.jobs[mp_id]=job;self.save()
            threading.Thread(target=self.run,args=(mp_id,),daemon=True).start()
            return dict(job)
    def run(self, mp_id):
        with self.worker_lock:
            with self.lock:
                job=self.jobs[mp_id]
                if self.retry_after>time.time():
                    job.update(status='RATE_LIMITED',message='微信文章读取限流，已暂停重复请求',retryAfter=self.retry_after);self.save();return
                job.update(status='RUNNING',message='正在采集最新一页文章与正文');self.save()
            try:
                count=self.collect(mp_id)
                state='SUCCEEDED' if count else 'EMPTY'
                message='最新文章已进入采集器，可测试正文并同步知识库' if count else '本次未采集到文章，请检查公众号文章可读性'
            except CollectionFailure as exc:
                state,message,count=exc.status,exc.message,0
            except Exception:
                state,message,count='FAILED','文章采集失败，请检查服务器网络与微信授权后重试',0
            with self.lock:
                if state=='RATE_LIMITED':
                    self.retry_after=time.time()+self.cooldown;job['retryAfter']=self.retry_after
                job.update(status=state,message=message,collected=count,finishedAt=time.time());self.save()

def collect(mp_id):
    from core.db import DB
    from core.models.feed import Feed
    from core.wx import WxGather
    from jobs.article import UpdateArticle
    from urllib.parse import urlparse
    session=DB.get_session()
    try:
        feed=session.query(Feed).filter(Feed.id==mp_id).first()
        if feed is None: raise CollectionFailure('NOT_SUBSCRIBED','公众号尚未订阅，请重新读取订阅列表')
        if feed.status!=1: raise CollectionFailure('DISABLED','采集器中的公众号订阅已停用')
        fake_id,name=feed.faker_id,feed.mp_name
    finally: session.close()
    wx=WxGather().Model();original_get=wx.session.get
    def checked_get(url,*args,**kwargs):
        response=original_get(url,*args,**kwargs)
        if urlparse(url).hostname=='mp.weixin.qq.com' and '/cgi-bin/' in urlparse(url).path:
            try: code=response.json().get('base_resp',{}).get('ret')
            except ValueError: code=None
            if code==200013: raise CollectionFailure('RATE_LIMITED','微信返回限流码 200013，已暂停重复请求')
            if code==200003:
                from driver.success import setStatus
                setStatus(False)
                raise CollectionFailure('AUTH_REQUIRED','微信授权已过期，请重新扫码')
            if code not in (None,0): raise CollectionFailure('FAILED','微信暂不允许读取该公众号文章，请稍后重试')
        return response
    wx.session.get=checked_get
    observed=0
    def persist(article):
        nonlocal observed
        observed+=1
        return UpdateArticle(article)
    wx.get_Articles(fake_id,Mps_id=mp_id,Mps_title=name,CallBack=persist,start_page=0,MaxPage=1,interval=0)
    # Existing records may be deduplicated by UpdateArticle; a nonempty fetched page is still usable.
    return observed

manager=CollectionManager('/app/data/cagent-collection-tasks.json',collect)

def register(router):
    from fastapi import Depends
    from core.auth import get_current_user_or_ak
    from apis.base import success_response
    # Scheduled jobs and old subscription tasks share the same authorization limit.
    from core.wx.base import WxGather
    original_start=WxGather.Start
    def guarded_start(self,*args,**kwargs):
        with manager.lock:
            if manager.retry_after>time.time():
                raise CollectionFailure('RATE_LIMITED','微信限流冷却中，后台任务已暂停请求')
        return original_start(self,*args,**kwargs)
    WxGather.Start=guarded_start
    @router.get('/collection/{mp_id}')
    def collection_status(mp_id:str,current_user=Depends(get_current_user_or_ak)):
        return success_response(manager.status(mp_id))
