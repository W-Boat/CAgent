import assert from 'node:assert/strict'
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {chromium} from 'playwright'
const ts=createRequire(import.meta.url)('typescript')
const module=async file=>import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64'))
const {safeAuthRedirect}=await module('../../web/src/utils/auth-redirect.ts')
for(const value of ['//evil.invalid','/\\evil.invalid','https://evil.invalid','/login?redirect=/chat',['/chat'],null])assert.equal(safeAuthRedirect(value,'/student','https://campus.example.org'),'/student')
assert.equal(safeAuthRedirect('/chat/own?mode=1#last','/student','https://campus.example.org'),'/chat/own?mode=1#last')
for(const line of readFileSync(new URL('../../../.env',import.meta.url),'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2]}
const WEB=process.env.EXPERIENCE_WEB||'http://127.0.0.1:4173',API=process.env.EXPERIENCE_API||'http://127.0.0.1:3002',production=WEB.startsWith('https:')
const login=await fetch(API+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:production?(process.env.INTEGRATE_EMAIL||process.env.SEED_ADMIN_EMAIL):process.env.SEED_ADMIN_EMAIL,password:production?(process.env.INTEGRATE_PASSWORD||process.env.SEED_ADMIN_PASSWORD):process.env.SEED_ADMIN_PASSWORD})}).then(r=>r.json());assert.equal(login.code,0)
const auth=login.data,headers={Authorization:'Bearer '+auth.accessToken}
const pub=await fetch(API+'/api/settings/public').then(r=>r.json()).then(r=>r.data)
const browser=await chromium.launch({headless:true}),errors=[],checks=[],out=new URL('../../../storage/shots/experience/',import.meta.url);mkdirSync(out,{recursive:true})
const path=file=>new URL((production?'production-':'local-')+file,out).pathname.replace(/^\/(\w:)/,'$1')
const pass=name=>{checks.push(name);console.log('PASS '+name)}
const wait=ms=>new Promise(r=>setTimeout(r,ms))
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message))
 await context.route('**/api/settings/public',r=>r.fulfill({json:{code:0,data:{...pub,student_default_theme:'light'}}}))
 await page.goto(WEB+'/login');await page.getByRole('heading',{name:'欢迎回来'}).waitFor();assert.equal(await page.getByRole('link',{name:/先体验校园助手/}).count(),2)
 await page.getByRole('button',{name:'登录',exact:true}).click();assert.equal(await page.locator('#login-email').evaluate(el=>document.activeElement===el),true)
 await page.locator('#login-email').fill('bad');await page.locator('#login-password').fill('123');await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByText('邮箱格式不正确',{exact:true}).waitFor()
 await page.locator('#login-email').fill('someone@example.invalid');assert.equal(await page.locator('#login-email-error').count(),0)
 await page.screenshot({path:path('login-desktop.png')});await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.classList.add('dark'));await wait(200);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));await page.screenshot({path:path('login-mobile-dark.png')});await context.close();pass('登录表单校验、无障碍聚焦、站内跳转与明暗移动布局')
 for(const view of ['/chat/a','/student','/test']){
  const ctx=await browser.newContext({viewport:{width:1280,height:900}}),p=await ctx.newPage(),sent=[];let slowA=false,failB=false,failQuota=view==='/test'
  await ctx.addInitScript(a=>{localStorage.setItem('cagent.accessToken',a.accessToken);localStorage.setItem('cagent.refreshToken',a.refreshToken);sessionStorage.setItem('cagent-campusnet-answered','1');localStorage.setItem('cagent-onboarded-'+a.user.id,'1')},auth)
  p.on('pageerror',e=>errors.push(e.message))
  const conversations=['a','b'].map((id,i)=>({id,title:i?'乙对话':'甲对话',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),modelId:null,agentId:null}))
  const message=(id,seq)=>({id:id+'-'+seq,seq,role:'user',content:(id==='a'?'甲':'乙')+'消息'+seq,createdAt:new Date().toISOString(),status:'SUCCESS'})
  await ctx.route('**/api/**',async r=>{const req=r.request(),u=new URL(req.url()),ok=data=>r.fulfill({json:{code:0,data}})
   if(u.pathname==='/api/settings/public')return ok({...pub,student_show_weather:false,student_onboarding_enabled:false})
   if(u.pathname==='/api/conversations'&&req.method()==='GET')return ok({items:conversations,total:2})
   if(u.pathname==='/api/conversations'&&req.method()==='POST')return ok(conversations[0])
   const m=u.pathname.match(/^\/api\/conversations\/([ab])\/messages$/)
   if(m){const id=m[1];if(id==='a'&&slowA)await wait(600);if(id==='b'&&failB)return r.fulfill({status:503,json:{code:503,message:'隔离测试：消息暂时不可用'}});const older=u.searchParams.has('beforeId');return ok({items:Array.from({length:older?2:3},(_,i)=>message(id,(older?1:3)+i)),total:5,page:1,pageSize:100,hasMore:!older,nextBeforeSeq:older?1:3})}
   if(u.pathname==='/api/trial/quota'){if(failQuota){failQuota=false;return r.fulfill({status:503,json:{code:503}})}return ok({used:0,max:50,left:50})}
   if(['/api/chat/completions','/api/trial/chat'].includes(u.pathname)){sent.push(req.postDataJSON().content);const f=(event,data)=>'event: '+event+'\ndata: '+JSON.stringify(data)+'\n\n';return r.fulfill({contentType:'text/event-stream',body:f('meta',{conversationId:'a',userMessageId:'u-test',assistantMessageId:'assistant-test',model:{name:'验证模型'}})+f('text',{text:'隔离验证回答。'})+f('trial',{used:1,max:50,left:49})+f('done',{status:'SUCCESS'})})}
   if(production)return r.continue();return r.fulfill({response:await r.fetch({url:API+u.pathname+u.search})})
  })
  await p.goto(WEB+view);const input=p.getByRole('textbox',{name:'输入消息'});await input.waitFor()
  if(view==='/test'){await p.getByText('无法获取体验额度，请检查网络后重试',{exact:true}).waitFor();assert(await input.isDisabled());await p.getByRole('button',{name:'重试',exact:true}).click();await input.waitFor();await p.waitForFunction(()=>!document.querySelector('textarea[aria-label="输入消息"]').disabled);pass('/test 额度失败禁用输入与重试恢复')}
  else{
   await p.getByText('甲消息5',{exact:true}).waitFor();await p.getByRole('button',{name:'加载更早的消息',exact:true}).click();await p.getByText('甲消息1',{exact:true}).waitFor();assert.equal(await p.getByText('甲消息3',{exact:true}).count(),1)
   await input.fill('甲草稿');const row=id=>p.locator(view.startsWith('/chat')?'.ac-conv':'.st-conv').filter({hasText:id});await row('乙对话').click();await p.getByText('乙消息5',{exact:true}).waitFor();assert.equal(await input.inputValue(),'');await input.fill('乙草稿');slowA=true;await row('甲对话').click();await row('乙对话').click();await wait(800);assert.equal(await p.getByText('甲消息5',{exact:true}).count(),0);assert.equal(await input.inputValue(),'乙草稿');slowA=false;await row('甲对话').click();await p.getByText('甲消息5',{exact:true}).waitFor();assert.equal(await input.inputValue(),'甲草稿')
   failB=true;await row('乙对话').click();await p.getByText('隔离测试：消息暂时不可用',{exact:true}).waitFor();assert(await input.isDisabled());failB=false;await p.getByRole('button',{name:'重试加载',exact:true}).click();await p.getByText('乙消息5',{exact:true}).waitFor();assert.equal(await input.inputValue(),'乙草稿');pass(view+' 历史分页、乱序响应隔离、独立草稿、失败重试')
  }
  await input.fill('中文输入确认');await input.dispatchEvent('compositionstart');await input.dispatchEvent('keydown',{key:'Enter',isComposing:true,keyCode:229});await wait(100);assert.equal(sent.length,0);await input.dispatchEvent('compositionend');await input.press('Shift+Enter');assert.equal(sent.length,0);await input.fill('确定发送');await input.press('Enter');await p.waitForFunction(()=>document.body.innerText.includes('隔离验证回答。'));assert.deepEqual(sent,['确定发送']);pass(view+' 中文输入法不误发、Shift+Enter 换行、Enter 只发送一次');await ctx.close()
 }
 const ctx=await browser.newContext({viewport:{width:1440,height:1000}}),p=await ctx.newPage();let loggedIn=false,qrReady=false,probeFailed=false
 await ctx.addInitScript(a=>{localStorage.setItem('cagent.accessToken',a.accessToken);localStorage.setItem('cagent.refreshToken',a.refreshToken)},auth)
 p.on('pageerror',e=>errors.push(e.message))
 const bases=[{id:'base-a',name:'学生手册资料',kind:'LOCAL',mounted:true,description:'校园生活',_count:{entries:5}},{id:'base-b',name:'外部信息源',kind:'WECHAT',mounted:false,description:'公众号通知',connection:{mode:'API',baseUrl:'https://example.invalid',accountIds:['mp1']},_count:{entries:2}}]
 await ctx.route('**/api/**',async r=>{const req=r.request(),u=new URL(req.url()),ok=data=>r.fulfill({json:{code:0,data}})
  if(u.pathname==='/api/knowledge/bases'&&req.method()==='GET')return ok(bases)
  if(u.pathname==='/api/knowledge/entries'){const key=u.searchParams.get('keyword');if(key==='旧查询')await wait(650);return ok({items:key?[{id:key,title:key+'的唯一结果',question:'',answer:'答案',aliases:[],baseId:'base-a',mode:'RAG',status:'DRAFT',source:'测试'}]:[],total:key?1:0})}
  if(u.pathname==='/api/knowledge/probe'){if(probeFailed)return r.fulfill({status:503,json:{code:503,message:'隔离验证：检索服务暂不可用'}});return ok({hits:[],rules:[],fixed:null,map:null})}
  if(u.pathname==='/api/knowledge/wechat/collector/status')return ok({available:true,loggedIn,qrReady})
  if(u.pathname==='/api/knowledge/wechat/collector/login'){qrReady=true;return ok({started:true})}
  if(u.pathname==='/api/knowledge/wechat/collector/qr')return ok({image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3XcAAAAASUVORK5CYII='})
  if(u.pathname==='/api/knowledge/wechat/collector/search')return ok({items:[{id:'isolated-mp',name:'中国社会科学院大学',alias:'isolated-ui-fixture'}]})
  if(u.pathname==='/api/knowledge/wechat/collector/subscribe')return ok({id:'MP_ISOLATED',name:'中国社会科学院大学'})
  if(production)return r.continue();return r.fulfill({response:await r.fetch({url:API+u.pathname+u.search})})
 })
 await p.goto(WEB+'/admin/knowledge');await p.getByRole('heading',{name:'知识库与固定问答'}).waitFor();await p.getByPlaceholder('查找知识库名称或信息源').fill('学生手册');assert.equal(await p.locator('.base-card').count(),1);await p.getByPlaceholder('查找知识库名称或信息源').fill('')
 await p.getByRole('tab',{name:'条目与固定问答',exact:true}).click();const search=p.getByPlaceholder('搜索标题、问题或答案');await search.fill('旧查询');await wait(350);await search.fill('新查询');await p.getByText('新查询的唯一结果',{exact:true}).waitFor();await wait(700);assert.equal(await p.getByText('旧查询的唯一结果',{exact:true}).count(),0)
 await p.getByRole('tab',{name:'检索试验',exact:true}).click();await p.getByPlaceholder('输入学生会问的问题').fill('没有资料的问题');await p.getByRole('button',{name:'查询',exact:true}).click();await p.getByText(/暂未匹配到内容/).waitFor();probeFailed=true;await p.getByPlaceholder('输入学生会问的问题').fill('失败验证');await p.getByRole('button',{name:'查询',exact:true}).click();await p.getByText('隔离验证：检索服务暂不可用',{exact:true}).waitFor()
 pass('知识库概览、库搜索、条目全文搜索乱序隔离、无匹配提示与检索错误状态')
 await p.getByRole('button',{name:'扫码连接微信',exact:true}).click();const dialog=p.getByRole('dialog').filter({hasText:'服务器公众号采集器'});await dialog.getByRole('button',{name:'生成登录二维码',exact:true}).click();await dialog.getByAltText('微信公众平台登录二维码').waitFor();loggedIn=true;await dialog.getByText('微信授权成功',{exact:true}).waitFor({timeout:10000});await dialog.getByRole('button',{name:'加入知识库',exact:true}).click();const config=p.getByRole('dialog').filter({hasText:'知识库配置'});await config.getByText('使用服务器采集器',{exact:true}).waitFor();assert.equal(await config.locator('.el-form-item').filter({hasText:'名称'}).first().locator('input').inputValue(),'中国社会科学院大学 · 公众号知识库');await config.getByRole('button',{name:'取消',exact:true}).click()
 await p.getByRole('tab',{name:'知识库',exact:true}).click();await p.screenshot({path:path('knowledge-desktop.png')});await p.evaluate(()=>document.documentElement.classList.add('dark'));await p.setViewportSize({width:390,height:844});await wait(200);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));await p.screenshot({path:path('knowledge-mobile-dark.png')});pass('公众号扫码授权、授权后搜索、订阅转为托管知识库配置、明暗手机排版');await ctx.close()
 assert.equal(errors.length,0,errors.join('\n'));writeFileSync(path('verification.json'),JSON.stringify({passed:true,checks,date:new Date().toISOString(),scope:'Real authenticated pages; isolated history/quota/chat/collector responses; no model billing or production content changes'},null,2))
}finally{await browser.close()}
