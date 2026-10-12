import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
const require=createRequire(import.meta.url),{chromium}=require('playwright'),{PrismaClient}=require('@prisma/client'),bcrypt=require('bcryptjs')
for(const line of readFileSync(new URL('../../../.env',import.meta.url),'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2]}
const api=process.env.DISPLAY_API||'http://127.0.0.1:3002',web=process.env.DISPLAY_WEB||'http://127.0.0.1:4173',readOnly=process.env.DISPLAY_READ_ONLY==='1'
assert(readOnly||(['127.0.0.1','localhost'].includes(new URL(api).hostname)&&['127.0.0.1','localhost'].includes(new URL(process.env.DATABASE_URL).hostname)),'Fixture writes must remain local')
const checks=[],errors=[],actors=[],shots=new URL('../../../storage/shots/display/',import.meta.url),pass=s=>{checks.push(s);console.log('PASS '+s)}
mkdirSync(shots,{recursive:true})
const prisma=readOnly?null:new PrismaClient(),browser=await chromium.launch({headless:true})
let before=[],keys=[],publicFixture=null,admin,student
async function request(path,auth,body,method){const res=await fetch(api+'/api'+path,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+auth.accessToken}:{})},body:body?JSON.stringify(body):undefined}),json=await res.json();assert.equal(json.code,0,path);return json.data}
async function open(auth,path){
 const context=await browser.newContext({viewport:{width:1440,height:1000}})
 await context.addInitScript(a=>{localStorage.setItem('cagent-theme','light');localStorage.setItem('cagent-accent','#e11d48');sessionStorage.setItem('cagent-campusnet-answered','1');sessionStorage.setItem('cagent-campusnet-campus','0');if(a){localStorage.setItem('cagent.accessToken',a.accessToken);localStorage.setItem('cagent.refreshToken',a.refreshToken);localStorage.setItem('cagent-onboarded-'+a.user.id,'1')}},auth||null)
 await context.route('https://api.open-meteo.com/**',r=>r.abort())
 await context.route('**/api/**',async handler=>{try{
  const req=handler.request(),url=new URL(req.url())
  if(publicFixture&&url.pathname==='/api/settings/public')return handler.fulfill({json:{code:0,data:publicFixture}})
  if(url.pathname==='/api/campus/runs/stats')return handler.fulfill({json:{code:0,data:{total:5,completed:2,completionRate:40,trend:[{date:'2026-10-05',runs:1},{date:'2026-10-06',runs:3},{date:'2026-10-07',runs:1}],byAccess:[{access:'验证分类',count:5}],topItems:[]}}})
  if(url.pathname==='/api/trial/quota')return handler.fulfill({json:{code:0,data:{used:0,max:5,left:5}}})
  if((url.pathname.endsWith('/chat/completions')||url.pathname.endsWith('/trial/chat'))&&req.method()==='POST'){
   const frame=(event,data)=>`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
   const knowledge={id:'display-fixture',title:'统一显示验证资料',collection:'handbook',source:'隔离 UI fixture',summary:'来源面板验证',used:true,citationId:'90001'}
   return handler.fulfill({contentType:'text/event-stream',body:frame('kb',{hits:[knowledge]})+frame('tool_start',{id:'lookup',name:'knowledge_search',arguments:{query:'显示验证'}})+frame('tool_result',{id:'lookup',name:'knowledge_search',result:'验证资料',status:'SUCCESS'})+frame('text',{text:'统一显示验证完成，回答内容保留。'})+frame('done',{status:'SUCCESS'})})
  }
  if(readOnly)return handler.continue()
  await handler.fulfill({response:await handler.fetch({url:api+url.pathname+url.search})})
 }catch{await handler.abort().catch(()=>undefined)}})
 const page=await context.newPage();page.setDefaultTimeout(readOnly?60000:30000);page.on('pageerror',e=>errors.push(e.message));await page.goto(web+path,{waitUntil:'domcontentloaded',timeout:60000});return {context,page}
}
async function refresh(page){await page.bringToFront();await page.evaluate(()=>window.dispatchEvent(new Event('focus')))}
async function palette(page,selector,token){return page.locator(selector).first().evaluate((el,key)=>{
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');ctx.fillStyle=getComputedStyle(el).getPropertyValue(key).trim();ctx.fillRect(0,0,1,1);return Array.from(ctx.getImageData(0,0,1,1).data).slice(0,3)
 },token)}
try{
 if(readOnly){admin=await request('/auth/login',null,{email:process.env.INTEGRATE_EMAIL||process.env.SEED_ADMIN_EMAIL,password:process.env.INTEGRATE_PASSWORD||process.env.SEED_ADMIN_PASSWORD})}
 else{
  for(const roleKey of ['super_admin','user']){
   const role=await prisma.role.findUniqueOrThrow({where:{key:roleKey}}),password='Display-fixture-'+Date.now()+'-'+Math.random()
   const user=await prisma.user.create({data:{email:roleKey+'-display-'+Date.now()+'@example.invalid',name:'统一显示验证',passwordHash:await bcrypt.hash(password,10),roles:{create:{roleId:role.id}}}});actors.push(user.id)
   const auth=await request('/auth/login',null,{email:user.email,password});if(roleKey==='super_admin')admin=auth;else student=auth
  }
 }
 const groups=await request('/settings',admin),pub=await request('/settings/public');assert(groups.student.some(d=>d.key==='student_show_knowledge_sources'));assert('unified_theme_enabled' in pub);pass('实际 API 提供完整管理分组与公开页面策略')
 if(!readOnly){keys=groups.student.map(d=>d.key);before=await prisma.setting.findMany({where:{key:{in:keys}}});await request('/settings',admin,{unified_theme_enabled:true,default_accent_color:'#4f46e5',student_default_theme:'light',student_allow_theme_toggle:true,student_welcome_title:'',student_welcome_description:'',student_recommended_questions:[],student_show_knowledge_sources:true,student_show_tool_activity:true,student_show_map_entry:true,student_show_knowledge_shortcuts:true,student_feedback_enabled:true,student_show_weather:false,student_onboarding_enabled:false},'PUT')}
 const {page:settings}=await open(admin,'/admin/settings');await settings.getByRole('tab',{name:'学生端与主题',exact:true}).click()
 const previous=await request('/settings/public');await settings.getByRole('textbox',{name:'统一主题色',exact:true}).fill('#0d9488');await settings.getByRole('textbox',{name:'欢迎标题',exact:true}).fill('统一欢迎 · 验证')
 await settings.locator('.display-preview').getByRole('heading',{name:'统一欢迎 · 验证'}).waitFor();assert.deepEqual(await request('/settings/public'),previous);pass('后台实时预览草稿，保存前不修改公开页面或全局主题')
 if(readOnly){await settings.screenshot({path:fileURLToPath(new URL('production-admin-preview.png',shots)),fullPage:true});publicFixture={...pub,default_accent_color:'#0d9488',unified_theme_enabled:true,student_default_theme:'dark',student_allow_theme_toggle:false,student_welcome_title:'统一欢迎 · 验证',student_show_weather:false,student_onboarding_enabled:false}}
 else{
  await settings.getByRole('textbox',{name:'底部说明',exact:true}).fill('统一底部说明 · 验证');await settings.getByRole('button',{name:'添加推荐问题',exact:true}).click();await settings.getByRole('textbox',{name:'推荐问题 1',exact:true}).fill('图书馆在哪里？')
  for(const label of ['知识来源面板','查询与处理过程','校园地图入口','知识库快捷查询','回答评价与反馈']){const toggle=settings.getByRole('switch',{name:label,exact:true});if(await toggle.getAttribute('aria-checked')==='true')await toggle.locator("..").click()}
  await settings.getByRole('combobox',{name:'默认明暗模式',exact:true}).locator('xpath=ancestor::div[contains(@class,"el-select__wrapper")]').click();await settings.getByRole('option',{name:'深色',exact:true}).click();await settings.getByRole('switch',{name:'允许个人切换明暗',exact:true}).locator('..').click()
 }
 const pages=[];if(student)pages.push((await open(student,'/student')).page);pages.push((await open(null,'/test')).page)
 if(!readOnly){await settings.getByRole('button',{name:'保存全部修改',exact:false}).click();await settings.getByText(/已保存 \d+ 项设置/).waitFor();assert.equal((await request('/settings/public')).default_accent_color,'#0d9488');pass('实际后台表单保存到本地 PostgreSQL，包括推荐问题、文案、明暗与显示开关')}
 else await refresh(settings)
 for(const page of pages){
  await refresh(page);await page.getByRole('heading',{name:'统一欢迎 · 验证',exact:true}).waitFor();assert(await page.evaluate(()=>document.documentElement.classList.contains('dark')));assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--nx-accent-raw').trim()),'#0d9488')
  if(!readOnly){assert.equal(await page.locator('.knowledge-shortcuts').count(),0);assert.equal(await page.getByRole('button',{name:'切换主题',exact:true}).count(),0)}
  await page.getByRole('textbox',{name:'输入消息',exact:true}).fill('统一显示测试');await page.getByRole('button',{name:'发送',exact:true}).click();await page.getByText('统一显示验证完成，回答内容保留。',{exact:false}).last().waitFor()
  if(!readOnly){assert.equal(await page.locator('.knowledge-sources').count(),0);assert.equal(await page.locator('.agent-run').count(),0);assert.equal(await page.getByRole('button',{name:'回答有帮助',exact:true}).count(),0)}
  await page.setViewportSize({width:390,height:844});if(await page.locator('.st-backdrop').count())await page.locator('.st-backdrop').dispatchEvent('click');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:fileURLToPath(new URL((readOnly?'production-':'local-')+new URL(page.url()).pathname.slice(1)+'-display-dark.png',shots)),fullPage:true})
 }
 pass((student?'学生/体验页':'生产体验页')+'即时应用后台策略，覆盖旧缓存配色；夜间和手机布局无横向溢出（聊天为隔离 SSE）')
 if(!readOnly){
  await settings.bringToFront();for(const label of ['知识来源面板','查询与处理过程','校园地图入口','知识库快捷查询','回答评价与反馈'])await settings.getByRole('switch',{name:label,exact:true}).locator('..').click()
  await settings.getByRole('button',{name:'保存全部修改',exact:false}).click();await settings.getByText(/已保存 \d+ 项设置/).waitFor()
  for(const page of pages){await refresh(page);await page.locator('.knowledge-sources').waitFor();await page.locator('.agent-run').waitFor();await page.locator('.knowledge-shortcuts').waitFor()}
  const forbidden=await fetch(api+'/api/settings',{method:'PUT',headers:{'Content-Type':'application/json',Authorization:'Bearer '+student.accessToken},body:JSON.stringify({default_accent_color:'#ffffff'})});assert.equal(forbidden.status,403);pass('恢复显示后已有来源和查询过程重新出现，学生无法修改后台配置')
 }
 // Fixture public policies affect this isolated browser only, never production settings.
 const livePublic=await request('/settings/public')
 for(const mode of ['light','dark'])for(const color of ['#0d9488','#facc15']){
  publicFixture={...livePublic,default_accent_color:color,unified_theme_enabled:true,student_default_theme:mode,student_allow_theme_toggle:false}
  await refresh(settings);await settings.waitForFunction(({color,mode})=>getComputedStyle(document.documentElement).getPropertyValue('--nx-accent-raw').trim()===color&&document.documentElement.classList.contains('dark')===(mode==='dark'),{color,mode})
  const nx=await palette(settings,'.nx-root','--nx-accent'),ep=await palette(settings,'html','--el-color-primary'),cg=await palette(settings,'html','--cg-brand');assert.deepEqual(ep,nx);assert.deepEqual(cg,nx)
  await settings.mouse.move(0,0);await settings.waitForTimeout(250)
  assert.deepEqual(await palette(settings,'.page-actions .el-button--primary','background-color'),nx);assert.deepEqual(await palette(settings,'.el-tabs__item.is-active','color'),nx);assert.deepEqual(await palette(settings,'.el-radio-button.is-active .el-radio-button__inner','background-color'),nx)
  const foreground=await palette(settings,'.page-actions .el-button--primary','color'),luminance=rgb=>rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);assert((Math.max(luminance(foreground),luminance(nx))+.05)/(Math.min(luminance(foreground),luminance(nx))+.05)>=4.5,'主按钮文本对比度')
  const toggle=settings.getByRole('switch',{name:'全站统一配色',exact:true});assert.deepEqual(await toggle.locator('..').locator('.el-switch__core').evaluate(el=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');ctx.fillStyle=getComputedStyle(el).backgroundColor;ctx.fillRect(0,0,1,1);return Array.from(ctx.getImageData(0,0,1,1).data).slice(0,3)}),nx)
  await settings.getByRole('combobox',{name:'默认明暗模式',exact:true}).locator('xpath=ancestor::div[contains(@class,"el-select__wrapper")]').click();const selected=settings.locator('body .el-select-dropdown__item.is-selected:visible').last();await selected.waitFor();assert.deepEqual(await selected.evaluate(el=>{const c=document.createElement('canvas');c.width=c.height=1;const x=c.getContext('2d');x.fillStyle=getComputedStyle(el).color;x.fillRect(0,0,1,1);return Array.from(x.getImageData(0,0,1,1).data).slice(0,3)}),nx);await settings.keyboard.press('Escape')
 }
 pass('青绿/亮黄两种自定义色在明暗模式下统一作用于 Element 开关、弹出选项、新界面和旧界面令牌')
 const chart=(await open(admin,'/admin/campus-stats')).page;await chart.locator('.chart-holder canvas').first().waitFor()
 for(const mode of ['light','dark']){publicFixture={...livePublic,default_accent_color:'#0d9488',unified_theme_enabled:true,student_default_theme:mode,student_allow_theme_toggle:false};await refresh(chart);await chart.waitForFunction(mode=>document.documentElement.classList.contains('dark')===(mode==='dark'),mode);const expected=await palette(chart,'html','--cg-brand');await chart.waitForFunction(rgb=>Array.from(document.querySelectorAll('.chart-holder canvas')).some(canvas=>{const ctx=canvas.getContext('2d');if(!ctx)return false;const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;let count=0;for(let i=0;i<pixels.length;i+=4)if(Math.abs(pixels[i]-rgb[0])<2&&Math.abs(pixels[i+1]-rgb[1])<2&&Math.abs(pixels[i+2]-rgb[2])<2&&pixels[i+3]>200)count++;return count>20}),expected);await chart.screenshot({path:fileURLToPath(new URL((readOnly?'production-':'local-')+'chart-'+mode+'.png',shots)),fullPage:true})}
 pass('导览统计实际 ECharts 画布包含主题色像素，明暗切换实时重绘（统计数据为浏览器 fixture）')
 assert.deepEqual(errors,[])
}catch(error){
 for(const [index,context] of browser.contexts().entries())for(const page of context.pages())await page.screenshot({path:fileURLToPath(new URL('failure-'+index+'.png',shots)),fullPage:true}).catch(()=>undefined)
 throw error
}finally{
 await browser.close()
 if(prisma){
  if(keys.length)await prisma.$transaction([...before.map(row=>prisma.setting.update({where:{key:row.key},data:{value:row.value}})),prisma.setting.deleteMany({where:{key:{in:keys.filter(key=>!before.some(row=>row.key===key))}}})])
  await prisma.auditLog.deleteMany({where:{userId:{in:actors}}});await prisma.user.deleteMany({where:{id:{in:actors}}});await prisma.$disconnect()
 }
 writeFileSync(new URL((readOnly?'production-':'local-')+'display-ui.json',shots),JSON.stringify({checkedAt:new Date().toISOString(),checks,errors,scope:readOnly?'Actual production settings read, unsaved draft preview; browser-only policy and SSE fixtures; no production settings changed':'Actual local API and PostgreSQL form saves; settings restored and fixture users removed; isolated SSE'},null,2))
}
