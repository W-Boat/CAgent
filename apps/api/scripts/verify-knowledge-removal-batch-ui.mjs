import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {chromium} from 'playwright'
for(const line of readFileSync(new URL('../../../.env',import.meta.url),'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2]}
const site=process.env.EMBEDDED_WEB || 'http://127.0.0.1:4173',api='https://campus.example.org/api'
const login=await fetch(api+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:process.env.INTEGRATE_EMAIL||process.env.SEED_ADMIN_EMAIL,password:process.env.INTEGRATE_PASSWORD||process.env.SEED_ADMIN_PASSWORD})}).then(r=>r.json());assert.equal(login.code,0)
const browser=await chromium.launch({headless:true}),ctx=await browser.newContext({viewport:{width:1280,height:1000}}),out=new URL('../../../storage/shots/wechat/',import.meta.url);mkdirSync(out,{recursive:true})
await ctx.addInitScript(a=>{localStorage.setItem('cagent.accessToken',a.accessToken);localStorage.setItem('cagent.refreshToken',a.refreshToken)},login.data)
const local={id:'remove-ui-local',name:'完整名称 · 校园资料',kind:'LOCAL',mounted:true,_count:{entries:3}},embedded={id:'remove-ui-embedded',name:'学生手册内嵌资料.json',kind:'EMBEDDED',readOnly:true,mounted:true,_count:{entries:10}}
let bases=[local,embedded],removes=0,status='QUEUED',batchNo=0,attachCalls=0;const submitted=[],errors=[]
const batch=()=>({id:(batchNo===1?'a':'b').repeat(32),status,total:batchNo===1?2:1,items:batchNo===1?[{index:0,id:'MP_WXS_9911',name:'校园公众号甲',status:status==='QUEUED'?'WAITING':'SUCCEEDED',message:'订阅状态'}, {index:1,name:'校园公众号乙',status:status==='QUEUED'?'WAITING':'FAILED',message:'检查链接'}]:[{index:0,id:'MP_WXS_9912',name:'校园公众号乙',status:status==='QUEUED'?'WAITING':'SUCCEEDED',message:'重试成功'}]})
await ctx.route('**/api/**',async route=>{const req=route.request(),u=new URL(req.url()),ok=data=>route.fulfill({json:{code:0,data}})
 if(u.pathname==='/api/knowledge/bases')return ok(bases)
 if(u.pathname==='/api/knowledge/entries')return ok({items:[],total:0})
 if(u.pathname.endsWith('/remove')){removes++;assert.equal(req.postDataJSON().name,local.name);bases=bases.filter(b=>b.id!==local.id);return ok({removed:true,tip:'已移除'})}
 if(u.pathname==='/api/knowledge/wechat/collector/status')return ok({available:true,loggedIn:true,qrReady:false,engine:'WECHRSS'})
 if(u.pathname.includes('/collector/search'))return ok({items:[]})
 if(u.pathname==='/api/knowledge/wechat/collector/batch'){batchNo++;submitted.push(req.postDataJSON().items);status='QUEUED';return ok(batch())}
 if(u.pathname.includes('/collector/batch/')){if(u.pathname.endsWith('/attach')){attachCalls++;return ok({created:1,existing:0,items:[]})}return ok(batch())}
 if(site.startsWith('https:'))return route.continue();return route.fulfill({response:await route.fetch({url:api+u.pathname.slice(4)+u.search})})
})
try{
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(site+'/admin/knowledge')
 const card=page.locator('.base-card').filter({hasText:local.name});await card.getByRole('button',{name:'移除',exact:true}).click()
 let dialog=page.getByRole('dialog').filter({hasText:'移除知识库'}),confirm=dialog.getByRole('button',{name:'确认移除'}),input=dialog.getByRole('textbox',{name:'确认移除的知识库全名'})
 assert(await confirm.isDisabled());await input.fill('完整名称');assert(await confirm.isDisabled());await input.fill(local.name+' ');assert(await confirm.isDisabled());await input.fill(local.name);assert(!(await confirm.isDisabled()));await dialog.getByRole('button',{name:'取消'}).click();assert.equal(removes,0)
 await card.getByRole('button',{name:'移除',exact:true}).click();dialog=page.getByRole('dialog').filter({hasText:'移除知识库'});await dialog.getByRole('textbox',{name:'确认移除的知识库全名'}).fill(local.name);await dialog.getByRole('button',{name:'确认移除'}).click();await card.waitFor({state:'detached'});assert.equal(removes,1)
 await page.locator('.base-card').filter({hasText:embedded.name}).getByRole('button',{name:'移除',exact:true}).click();await page.getByRole('dialog').filter({hasText:'移除知识库'}).getByRole('button',{name:'取消'}).click()
 await page.getByRole('button',{name:'批量订阅',exact:true}).click();const collector=page.getByRole('dialog').filter({hasText:'服务器公众号采集器'})
 await collector.getByRole('textbox',{name:'批量公众号文章链接'}).fill('校园公众号甲 | https://mp.weixin.qq.com/s/fixtureA\n校园公众号乙 | https://mp.weixin.qq.com/s/fixtureB');await collector.getByRole('button',{name:'批量订阅',exact:true}).click()
 await collector.getByText(/等待订阅 ·/).waitFor();assert(await collector.getByRole('textbox',{name:'批量公众号文章链接'}).isDisabled());assert.equal(submitted[0].length,2)
 status='PARTIAL';await collector.getByRole('button',{name:'刷新订阅进度'}).click();await collector.getByText('新建 1 个知识库，复用 0 项已有配置。',{exact:true}).waitFor();assert.equal(attachCalls,1)
 await page.screenshot({path:new URL((site.startsWith('https:')?'production':'local')+'-batch-subscribe.png',out).pathname.replace(/^\/(\w:)/,'$1')})
 await collector.getByRole('button',{name:'重试失败项'}).click();await collector.getByText(/等待订阅 ·/).waitFor();assert.equal(submitted[1].length,1);assert.equal(submitted[1][0].url,'https://mp.weixin.qq.com/s/fixtureB')
 status='SUCCEEDED';await collector.getByRole('button',{name:'刷新订阅进度'}).click();await collector.getByText('新建 1 个知识库，复用 0 项已有配置。',{exact:true}).waitFor();assert.equal(attachCalls,2)
 await page.evaluate(()=>document.documentElement.classList.add('dark'));await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));await page.screenshot({path:new URL((site.startsWith('https:')?'production':'local')+'-batch-mobile-dark.png',out).pathname.replace(/^\/(\w:)/,'$1')});assert.equal(errors.length,0,errors.join('\n'))
 const report={passed:true,checkedAt:new Date().toISOString(),checks:['完整名称逐字符确认、取消零写入','内嵌库提供移除入口','异步批量订阅与重复提交禁用','部分成功自动建立知识库','只重试失败项','夜间模式与手机布局'],scope:'Real authenticated page; isolated mutations and batch fixtures, no production removals or subscriptions'}
 writeFileSync(new URL((site.startsWith('https:')?'production':'local')+'-removal-batch-ui.json',out),JSON.stringify(report,null,2));console.log('PASS fullname removal, asynchronous bulk subscribe, partial retry and mobile dark UI')
}finally{await ctx.unrouteAll({behavior:'ignoreErrors'});await browser.close()}
