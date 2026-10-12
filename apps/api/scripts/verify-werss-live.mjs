import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {chromium} from 'playwright'
for(const line of readFileSync(new URL('../../../.env',import.meta.url),'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2]}
const site=process.env.SITE_ORIGIN||'http://localhost:5173',api=site+'/api'
const login=await fetch(api+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:process.env.INTEGRATE_EMAIL||process.env.SEED_ADMIN_EMAIL,password:process.env.INTEGRATE_PASSWORD||process.env.SEED_ADMIN_PASSWORD})}).then(r=>r.json());assert.equal(login.code,0)
const headers={Authorization:'Bearer '+login.data.accessToken,'Content-Type':'application/json'}
async function call(path){const r=await fetch(api+path,{headers});const value=await r.json();assert.equal(value.code,0);return value.data}
let state;for(let i=0;i<3;i++){try{state=await call('/knowledge/wechat/collector/status');if(state.engine==='WEMP')break}catch{}await new Promise(r=>setTimeout(r,500))}
assert.equal(state.engine,'WEMP')
const bases=await call('/knowledge/bases'),base=bases.find(b=>b.kind==='WECHAT'&&b.connection?.accountIds?.includes('MP_WXS_3518809936'));assert(base)
const accounts=await call('/knowledge/wechat/collector/search?q='+encodeURIComponent('中国社会科学院大学'));assert(accounts.items.some(a=>a.id==='MP_WXS_3518809936'))
const before={mounted:base.mounted,entries:base._count.entries,connection:JSON.stringify(base.connection),aiReview:base.aiReviewEnabled,aiSummary:base.aiSummaryEnabled}
assert.equal((await fetch(api+'/knowledge/wechat/collector/status')).status,401)
assert.equal((await fetch(api+'/knowledge/wechat/collector/article',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401)
const browser=await chromium.launch({headless:true}),out=new URL('../../../storage/shots/werss/',import.meta.url);mkdirSync(out,{recursive:true})
try{
 const ctx=await browser.newContext({viewport:{width:1280,height:1000}});await ctx.addInitScript(a=>{localStorage.setItem('cagent.accessToken',a.accessToken);localStorage.setItem('cagent.refreshToken',a.refreshToken)},login.data)
 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(site+'/admin/knowledge')
 await page.getByText('微信读书自动采集 · WeRSS',{exact:true}).waitFor()
 let generatedQr=false
 if(!state.loggedIn){
  await page.getByRole('button',{name:'扫码连接微信',exact:true}).click()
  const dialog=page.getByRole('dialog').filter({hasText:'服务器公众号采集器'})
  if(!(await dialog.locator('.collector-qr img').count()))await dialog.getByRole('button',{name:'生成登录二维码',exact:true}).click()
  await dialog.locator('.collector-qr img').waitFor({timeout:65000})
  await page.waitForFunction(()=>{const img=document.querySelector('.collector-qr img');return img?.complete&&img.naturalWidth>100})
  generatedQr=true
  await page.screenshot({path:new URL('production-werss-login.png',out).pathname.replace(/^\/(\w:)/,'$1')})
  await dialog.locator('.el-dialog__headerbtn').click()
 }
 await page.locator('.base-card').filter({hasText:base.name}).getByRole('button',{name:'配置',exact:true}).click()
 const config=page.getByRole('dialog').filter({hasText:'知识库配置'})
 await config.locator('.collector-schedule').first().waitFor()
 await config.getByText('自动同步到知识库',{exact:true}).waitFor();assert.equal(base.connection.autoSync,true)
 await page.evaluate(()=>document.documentElement.classList.add('dark'));await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300)
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));await page.screenshot({path:new URL('production-werss-mobile-dark.png',out).pathname.replace(/^\/(\w:)/,'$1')})
 const after=(await call('/knowledge/bases')).find(b=>b.id===base.id);assert.equal(after._count.entries,before.entries);assert.equal(after.mounted,before.mounted);assert.equal(JSON.stringify(after.connection),before.connection);assert.equal(after.aiReviewEnabled,before.aiReview);assert.equal(after.aiSummaryEnabled,before.aiSummary);assert.equal(errors.length,0,errors.join('\n'))
 const report={passed:true,checkedAt:new Date().toISOString(),engine:'WEMP',realQrGenerated:generatedQr,authorized:state.loggedIn,awaitingNewWeReadLogin:!state.loggedIn,subscriptions:accounts.items.map(a=>a.name),autoSync:base.connection.autoSync,checks:['真实新采集器与订阅迁移',state.loggedIn?'真实微信读书授权已保存':'真实微信读书二维码生成及浏览器解码','自动采集计划与增量同步控件','暗色手机布局','匿名接口拒绝','历史知识、挂载与 AI 设置保留'],scope:'Production read-only state and UI, generates QR only if logged out; no article harvest, model calls or knowledge modifications by this test'}
 writeFileSync(new URL('production-werss-live.json',out),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}finally{await browser.close()}
