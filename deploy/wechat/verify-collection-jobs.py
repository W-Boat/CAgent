from pathlib import Path
import tempfile,time,json
from cagent_collect import CollectionManager,CollectionFailure

with tempfile.TemporaryDirectory() as directory:
 calls=[]
 def collect(id):
  calls.append(id);time.sleep(.05)
  if id=='limited':raise CollectionFailure('RATE_LIMITED','限流')
  return 3
 m=CollectionManager(Path(directory)/'tasks.json',collect,60)
 assert m.start('ok')['status']=='QUEUED'
 m.start('ok')
 for _ in range(100):
  if m.status('ok')['status']=='SUCCEEDED':break
  time.sleep(.01)
 assert calls==['ok'] and m.status('ok')['collected']==3
 m.start('limited')
 for _ in range(100):
  if m.status('limited')['status']=='RATE_LIMITED':break
  time.sleep(.01)
 assert m.start('later')['status']=='RATE_LIMITED' and calls==['ok','limited']
 saved=CollectionManager(m.path,collect,60)
 assert saved.start('another')['status']=='RATE_LIMITED'
 assert not any(s in m.path.read_text() for s in ['cookie','token','password'])
 assert saved.status('none')['status']=='NONE'
 print('PASS 单任务去重、限流停止、跨公众号冷却、状态持久化、无授权凭据写入')
 # Scheduled/native jobs must honor the same cooldown before touching the network.
 import sys,types,cagent_collect
 class Gather:
  def Start(self):raise AssertionError('冷却期间不能发起采集')
 class Router:
  def get(self,path):return lambda fn:fn
 sys.modules['fastapi']=types.SimpleNamespace(Depends=lambda fn:None)
 sys.modules['core.auth']=types.SimpleNamespace(get_current_user_or_ak=lambda:None)
 sys.modules['apis.base']=types.SimpleNamespace(success_response=lambda value:value)
 sys.modules['core.wx.base']=types.SimpleNamespace(WxGather=Gather)
 cagent_collect.manager=m;cagent_collect.register(Router())
 try:Gather().Start();raise AssertionError('应当拦截冷却中的后台任务')
 except CollectionFailure as exc:assert exc.status=='RATE_LIMITED'
 print('PASS 定时采集与原生任务共用限流冷却，不绕过暂停状态')
