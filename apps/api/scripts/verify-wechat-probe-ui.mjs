import assert from 'node:assert/strict'
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {chromium} from 'playwright'
for(const line of readFileSync(new URL('../../../.env',import.meta.url),'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2]}
const WEB=process.env.WECHAT_WEB||'http://127.0.0.1:4173',API=process.env.WECHAT_API||'http://127.0.0.1:3002',production=WEB.startsWith('https:'),errors=[]
const auth=await fetch(API+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:production?(process.env.INTEGRATE_EMAIL||process.env.SEED_ADMIN_EMAIL):process.env.SEED_ADMIN_EMAIL,password:production?(process.env.INTEGRATE_PASSWORD||process.env.SEED_ADMIN_PASSWORD):process.env.SEED_ADMIN_PASSWORD})}).then(r=>r.json());assert.equal(auth.code,0)
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();let saved,tests=0
await context.addInitScript(a=>{localStorage.setItem('cagent.accessToken',a.accessToken);localStorage.setItem('cagent.refreshToken',a.refreshToken)},auth.data)
const items=[{id:'MP_1',name:'校园通知'},{id:'MP_2',name:'社团动态'}],fixture={id:'probe-ui-fixture',name:'公众号列表验证',kind:'WECHAT',connection:{mode:'API',baseUrl:'https://collector.example.invalid',apiPath:'/api/v1/wx',accountIds:['MP_1'],accountNames:{MP_1:'校园通知'},maxArticles:30},hasPassword:true,mounted:false}
await page.route('**/api/**',async route=>{const u=new URL(route.request().url()),path=u.pathname;const ok=data=>route.fulfill({json:{code:0,data}})
  if(path==='/api/knowledge/bases'&&route.request().method()==='GET')return ok([fixture])
  if(path==='/api/knowledge/wechat/accounts')return ok({items,total:2})
  if(path==='/api/knowledge/wechat/test'){tests++;const body=route.request().postDataJSON();assert.deepEqual(body.connection.accountIds,['MP_1','MP_MANUAL']);return ok({connected:true,mode:'API',totalAccounts:2,testedAccounts:2,ready:1,elapsedMs:300,tip:'测试只读取，不保存',accounts:[{id:'MP_1',name:'校园通知',status:'READY',message:'原文链接和正文可读取',sample:{title:'最新校园通知',url:'https://mp.weixin.qq.com/s/test',published:'2026-10-08',excerpt:'校园正文测试样例。'}},{id:'MP_MANUAL',name:'手动公众号',status:'NO_BODY',message:'最新文章缺少完整正文'}]})}
  if(path==='/api/knowledge/bases/'+fixture.id){saved=route.request().postDataJSON();Object.assign(fixture,saved);return ok(fixture)}
  if(!production)return route.continue({url:API+path+u.search});return route.continue()
})
page.on('pageerror',e=>errors.push(e.message))
try{
 await page.goto(WEB+'/admin/knowledge');await page.getByRole('heading',{name:'知识库与固定问答'}).waitFor();await page.locator('.base-card').filter({hasText:fixture.name}).getByRole('button',{name:'配置',exact:true}).click();const dialog=page.locator('.el-dialog').filter({hasText:'知识库配置'})
 await dialog.getByRole('button',{name:'读取已订阅公众号'}).click();await page.getByText('读取 2 个公众号，共 2 个',{exact:true}).waitFor()
 await dialog.getByPlaceholder('采集器公众号 ID').fill('MP_MANUAL');await dialog.getByPlaceholder('显示名称').fill('手动公众号');await dialog.getByRole('button',{name:'添加到列表'}).click();await dialog.locator('.wechat-selected').getByText('手动公众号 · MP_MANUAL').waitFor()
 await dialog.getByRole('button',{name:'测试正文'}).click();await dialog.locator('.wechat-test-result').getByText('正文可读取',{exact:true}).waitFor();assert.equal(tests,1);await dialog.getByText('缺少完整正文',{exact:true}).waitFor()
 const out=new URL('../../../storage/shots/wechat/',import.meta.url);mkdirSync(out,{recursive:true});await page.screenshot({path:new URL((production?'production':'local')+'-probe-light.png',out).pathname.replace(/^\/(\w:)/,'$1')})
 await page.evaluate(()=>document.documentElement.classList.add('dark'));await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'手机横向溢出');await page.screenshot({path:new URL((production?'production':'local')+'-probe-mobile-dark.png',out).pathname.replace(/^\/(\w:)/,'$1')})
 await dialog.locator('.el-form-item').filter({hasText:'API 路径'}).locator('input').fill('/api/v1/custom');await page.waitForFunction(()=>!document.querySelector('.wechat-test-result'))
 await dialog.getByRole('button',{name:'保存配置'}).click();await page.getByText('知识库配置已保存',{exact:true}).waitFor();assert.deepEqual(saved.connection.accountIds,['MP_1','MP_MANUAL']);assert.equal(saved.connection.accountNames.MP_MANUAL,'手动公众号');assert.equal(errors.length,0,errors.join('\n'))
 writeFileSync(new URL((production?'production':'local')+'-probe-ui.json',out),JSON.stringify({passed:true,checks:['读取与保留列表','手动配置公众号 ID','逐公众号正文测试结果','编辑配置清除旧结果','保存列表与显示名称','夜间与手机布局'],scope:'Isolated mocked source/config requests; real authenticated page; no production data writes',date:new Date().toISOString()},null,2));console.log('PASS 公众号配置与测试 UI，夜间和手机布局，零生产配置写入')
}finally{await context.unrouteAll({behavior:'wait'});await browser.close()}
