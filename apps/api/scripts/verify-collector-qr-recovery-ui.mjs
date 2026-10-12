import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {chromium} from 'playwright'
for(const line of readFileSync(new URL('../../../.env',import.meta.url),'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2]}
const WEB=process.env.QR_WEB||'http://127.0.0.1:4173',API='https://campus.example.org'
const login=await fetch(API+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:process.env.INTEGRATE_EMAIL||process.env.SEED_ADMIN_EMAIL,password:process.env.INTEGRATE_PASSWORD||process.env.SEED_ADMIN_PASSWORD})}).then(r=>r.json());assert.equal(login.code,0)
const browser=await chromium.launch({headless:true})
try{
 const ctx=await browser.newContext({viewport:{width:1100,height:950}})
 await ctx.addInitScript(a=>{localStorage.setItem('cagent.accessToken',a.accessToken);localStorage.setItem('cagent.refreshToken',a.refreshToken)},login.data)
 let ready=false,failed=false,starts=0
 const page=await ctx.newPage();await page.clock.install()
 await ctx.route('**/api/**',async route=>{
  const u=new URL(route.request().url()),ok=data=>route.fulfill({json:{code:0,data}})
  if(u.pathname.endsWith('/collector/status'))return failed?route.fulfill({status:503,json:{code:503,message:'二维码测试：采集器暂时不可用'}}):ok({available:true,loggedIn:false,qrReady:ready})
  if(u.pathname.endsWith('/collector/login')){starts++;return ok({started:true})}
  if(u.pathname.endsWith('/collector/qr'))return ok({image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3XcAAAAASUVORK5CYII='})
  if(WEB.startsWith('https:'))return route.continue()
  return route.fulfill({response:await route.fetch({url:API+u.pathname+u.search})})
 })
 await page.goto(WEB+'/admin/knowledge');await page.getByRole('button',{name:'扫码连接微信',exact:true}).click()
 const dialog=page.getByRole('dialog').filter({hasText:'服务器公众号采集器'}),button=()=>dialog.getByRole('button',{name:/生成.*二维码/}),image=dialog.getByAltText('微信公众平台登录二维码')
 await button().click();await page.waitForFunction(()=>document.querySelector('.collector-login button')?.disabled)
 assert.equal(starts,1);assert.equal(await image.count(),0)
 await page.clock.runFor(61000);await dialog.getByText(/二维码生成超时/).waitFor()
 assert.equal(await button().isEnabled(),true)
 console.log('PASS 异步生成期间保持加载并禁止重复请求；超时解除加载并允许重试')
 await button().click();failed=true;await page.clock.runFor(3000);await dialog.getByText('二维码测试：采集器暂时不可用',{exact:true}).waitFor()
 assert.equal(await button().isEnabled(),true)
 console.log('PASS 轮询失败展示真实错误，不再无限加载')
 failed=false;ready=true;await button().click();await page.clock.runFor(3000);await image.waitFor()
 assert.equal(await dialog.getByText(/二维码测试：采集器暂时不可用/).count(),0)
 console.log('PASS 失败重试恢复二维码，并清除过期错误')
 ready=false;await page.clock.runFor(3000);await dialog.getByText('二维码已失效，请重新生成。',{exact:true}).waitFor();assert.equal(await image.count(),0)
 console.log('PASS 服务器二维码失效时移除旧图片并提示重试')
 const out=new URL('../../../storage/shots/experience/',import.meta.url);mkdirSync(out,{recursive:true});writeFileSync(new URL((WEB.startsWith('https:')?'production':'local')+'-qr-recovery.json',out),JSON.stringify({passed:true,checkedAt:new Date().toISOString(),scope:'Real page; delayed/failed/expired collector fixtures only; production knowledge and settings unchanged'},null,2));await ctx.unrouteAll({behavior:'ignoreErrors'})
}finally{await browser.close()}
