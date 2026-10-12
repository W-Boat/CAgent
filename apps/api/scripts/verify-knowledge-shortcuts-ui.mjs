import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {chromium} from 'playwright'
const root=new URL('../../../',import.meta.url),site=process.env.SHORTCUT_WEB||'http://127.0.0.1:4173',api='https://campus.example.org/api'
for(const line of readFileSync(new URL('.env',root),'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2]}
const auth=await fetch(api+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:process.env.INTEGRATE_EMAIL||process.env.SEED_ADMIN_EMAIL,password:process.env.INTEGRATE_PASSWORD||process.env.SEED_ADMIN_PASSWORD})}).then(r=>r.json());assert.equal(auth.code,0)
const browser=await chromium.launch({headless:true}),ctx=await browser.newContext({viewport:{width:1360,height:1000}}),errors=[],checks=[]
await ctx.addInitScript(a=>{localStorage.setItem('cagent.accessToken',a.accessToken);localStorage.setItem('cagent.refreshToken',a.refreshToken);localStorage.setItem('cagent-onboarded-'+a.user.id,'1')},auth.data)
let mounted=true,bindings=[{label:'原入口',question:'原预设问题',enabled:true,dependencies:[]}],sent='',saves=0,failRead=false
await ctx.route('**/api/**',async route=>{
 const req=route.request(),u=new URL(req.url()),ok=data=>route.fulfill({json:{code:0,data}})
 if(u.pathname==='/api/campus/shortcuts')return ok(mounted?bindings.filter(b=>b.enabled).map((b,i)=>({id:'fixture:'+i,label:b.label,question:b.question})):[])
 if(u.pathname==='/api/knowledge/bases')return ok([{id:'shortcut-fixture',name:'快捷入口测试库',description:'隔离 UI 夹具',kind:'LOCAL',mounted,_count:{entries:1}}])
 if(u.pathname==='/api/knowledge/bases/shortcut-fixture/shortcuts'){if(req.method()==='PUT'){bindings=JSON.parse(req.postData());saves++;return ok(bindings)}if(failRead)return route.fulfill({status:500,json:{code:1,message:'测试读取失败'}});return ok(bindings)}
 if(u.pathname==='/api/knowledge/bases/shortcut-fixture/mount'){mounted=JSON.parse(req.postData()).mounted;return ok({mounted})}
 if(u.pathname==='/api/knowledge/entries')return ok({items:[],total:0})
 if(u.pathname.startsWith('/api/knowledge/')&&req.method()!=='GET')return route.fulfill({status:400,json:{code:1,message:'Unexpected fixture mutation'}})
 if(u.pathname==='/api/trial/quota')return ok({used:0,max:5,left:5})
 if(u.pathname==='/api/campus/activity')return ok({recorded:true})
 if(u.pathname.endsWith('/trial/chat')){sent=JSON.parse(req.postData()).content;const frame=(e,d)=>'event: '+e+'\ndata: '+JSON.stringify(d)+'\n\n';return route.fulfill({contentType:'text/event-stream',body:frame('meta',{conversationId:'shortcut-ui',assistantMessageId:'answer',model:{key:'keyword-rule',name:'知识库'}})+frame('text',{text:'快捷按钮已收到。'})+frame('done',{status:'SUCCESS'})})}
 if(site.startsWith('https:'))return route.continue();return route.fulfill({response:await route.fetch({url:api+u.pathname.slice(4)+u.search})})
})
try{
 const admin=await ctx.newPage(),student=await ctx.newPage();for(const p of [admin,student])p.on('pageerror',e=>errors.push(e.message))
 await admin.goto(site+'/admin/knowledge',{waitUntil:'domcontentloaded'});await admin.locator('.base-card').filter({hasText:'快捷入口测试库'}).getByRole('button',{name:'快捷按钮',exact:true}).click()
 const dialog=admin.getByRole('dialog').filter({hasText:'快捷入口测试库 · 快捷按钮'});await dialog.getByRole('textbox',{name:'快捷按钮名称'}).fill('新按钮');await dialog.getByRole('textbox',{name:'快捷按钮问题'}).fill('查询这个测试库的办事流程');await dialog.getByRole('button',{name:'保存按钮',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.equal(saves,1);assert.equal(bindings[0].label,'新按钮')
 await student.goto(site+'/test',{waitUntil:'domcontentloaded'});const button=student.locator('.knowledge-shortcuts').getByRole('button',{name:'新按钮',exact:true});await button.waitFor();await button.click();assert.equal(await student.getByRole('textbox',{name:'输入消息'}).inputValue(),bindings[0].question);await student.getByRole('button',{name:'发送',exact:true}).click();await student.getByText('快捷按钮已收到。',{exact:true}).waitFor();assert.equal(sent,bindings[0].question)
 checks.push('后台绑定新按钮、公共聊天显示、点击回传完整问题')
 await admin.bringToFront();await admin.locator('.base-card').filter({hasText:'快捷入口测试库'}).locator('.el-switch').click();await admin.getByText('已关闭，查询与导览同步停用',{exact:true}).waitFor();await student.bringToFront();await student.evaluate(()=>window.dispatchEvent(new Event('focus')));await button.waitFor({state:'hidden'});assert.equal(await student.locator('.knowledge-shortcuts').count(),0)
 await admin.bringToFront();await admin.locator('.base-card').locator('.el-switch').click();await admin.getByText('已启用，可参与查询与导览',{exact:true}).waitFor();await student.bringToFront();await student.evaluate(()=>window.dispatchEvent(new Event('focus')));await button.waitFor();checks.push('主库关闭隐藏整个入口，跨页重新启用恢复')
 await student.evaluate(()=>document.documentElement.classList.add('dark'));await student.setViewportSize({width:390,height:844});assert(await student.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2))
 const out=new URL('storage/shots/shortcuts/',root);mkdirSync(out,{recursive:true});const prefix=site.startsWith('https:')?'production':'local';await student.screenshot({path:fileURLToPath(new URL(prefix+'-mobile-dark.png',out)),fullPage:true})
 await admin.bringToFront();failRead=true;await admin.locator('.base-card').getByRole('button',{name:'快捷按钮',exact:true}).click();await dialog.getByText('测试读取失败',{exact:true}).waitFor();assert(await dialog.getByRole('button',{name:'保存按钮',exact:true}).isDisabled());checks.push('读取失败禁用保存，避免空列表覆盖；手机夜间布局')
 assert.deepEqual(errors,[]);writeFileSync(new URL(prefix+'-ui.json',out),JSON.stringify({passed:true,checkedAt:new Date().toISOString(),checks,scope:'Actual built frontend and production auth/read-only APIs; isolated shortcut/base/chat requests; no model calls or production writes'},null,2));console.log('PASS shortcut editor, disabled-source synchronization, click question, dark mobile and read failure')
}finally{await ctx.unrouteAll({behavior:'ignoreErrors'});await browser.close()}
