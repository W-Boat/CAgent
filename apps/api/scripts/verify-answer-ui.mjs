import assert from 'node:assert/strict'
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
const {chromium}=createRequire(import.meta.url)('playwright'),ts=createRequire(import.meta.url)('typescript')
const compile=file=>ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText
const uri=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64')
const contract=uri(compile('../../web/src/utils/agent-ui.ts'))
const parser=uri(compile('../../web/src/utils/card-segments.ts').replace(/(['"])\.\/agent-ui\1/,JSON.stringify(contract)))
const {answerSegments}=await import(uri(compile('../../web/src/utils/answer-layout.ts').replace(/(['"])\.\/card-segments\1/,JSON.stringify(parser))))
const {ANSWER_CARD_PROTOCOL,supportCardFallback}=await import(uri(compile('../src/chat/answer-card-protocol.ts')))
const {serviceMode,safeServiceUrl}=await import(uri(compile('../../web/src/utils/place-service.ts')))
assert.equal(serviceMode({name:'校园卡服务窗口',location:'教学综合楼3层309',url:'https://example.invalid/window'}),'offline')
assert.equal(serviceMode({name:'一站式服务大厅',location:'线上（两校区通用）'}),'online')
assert.equal(serviceMode({name:'校园卡挂失',body:'在线挂失与补办'}),'online')
assert.equal(serviceMode({name:'服务说明',url:'https://example.invalid/service'}),'unknown')
assert.equal(serviceMode({body:'无法线上办理，请前往线下窗口'}),'offline')
assert.equal(serviceMode({serviceMode:'hybrid'}),'hybrid')
assert.equal(safeServiceUrl('https://private:credential@example.invalid'),'')
const {estimateTokens}=await import(uri(compile('../src/chat/llm/types.ts')))
assert(estimateTokens(ANSWER_CARD_PROTOCOL)<=512,'新增排版规则必须在预留 token 预算内')
const checks=[],pass=s=>{checks.push(s);console.log('PASS '+s)}
const fence=card=>'```card\n'+JSON.stringify(card)+'\n```'
assert(answerSegments(supportCardFallback('我最近作业很多，压力很大，只想找人聊聊。','我愿意听你说。',false)).some(s=>s.card?.type==='care'))
assert.equal(supportCardFallback('我压力很大，想聊聊',fence({type:'care',body:'陪伴'}),false),'')
assert.equal(supportCardFallback('我想知道学校有几家超市','查询结果',false),'')
assert(answerSegments(supportCardFallback('我有伤害自己的念头',fence({type:'care',body:'陪伴'}),true)).some(s=>s.card?.type==='crisis'))
assert.equal(supportCardFallback('我有伤害自己的念头','<card type="crisis">{"type":"crisis","body":"求助"}</card>',true),'')
const sourceCard=fence({type:'sources',title:'重复来源卡',items:[{id:'401',title:'资料依据',source:'学生手册',url:'https://example.invalid/source'}]})
assert.equal(answerSegments(sourceCard,{hasKnowledgeSources:true}).length,0)
assert.equal(answerSegments(sourceCard)[0].card.type,'sources')
assert.equal(answerSegments('```json\n{"type":"crisis","body":"陪伴"}\n```')[0].card.type,'crisis')
assert.equal(answerSegments('```json\n{"type":"care","body":"倾听"}\n```')[0].card.type,'care')
assert.equal(answerSegments('陪伴。<card type="crisis">\n{"type":"crisis","body":"求助"}\n</card>')[1].card.type,'crisis')
assert.equal(answerSegments('<card type="care">{"type":"notice","body":"不匹配"}</card>')[0].kind,'markdown')
assert.equal(answerSegments('```text\n<card type="care">{"type":"care","body":"示例"}</card>\n```')[0].kind,'markdown')
for(const code of ['```json\n{"type":"custom-data","body":"数据"}\n```','```json\n{"type":"care","value":1}\n```','```json\ninvalid\n```'])assert.equal(answerSegments(code)[0].kind,'markdown')
const prose='说明在这里。\n\n## 开放时间\n2026-10-08，仅工作日。\n\n## 申请条件\n须本人携带证件。'
assert.equal(answerSegments(prose)[0].kind,'markdown');assert.equal(answerSegments(prose)[0].text,prose)
for(const plain of ['- 条件一\n- 条件二\n- 条件三','| 项目 | 内容 |\n| --- | --- |\n| 校区 | 良乡 |','长段落。'.repeat(150)+'\n说明。\n条件。'])assert.equal(answerSegments(plain)[0].kind,'markdown','普通列表、表格和长文不套整理框')
assert.equal(answerSegments('## 主题一\n### 子主题\n正文\n## 主题二\n内容')[0].kind,'markdown')
assert.equal(answerSegments(prose,{streaming:true})[0].kind,'markdown')
assert.equal(answerSegments('```text\n## 代码中的标题\n## 不应该变卡片\n```')[0].kind,'markdown')
assert.equal(answerSegments('```card\ninvalid\n```')[0].kind,'broken')
pass('真实主题排版、列表与长文无整理框、子标题/条件保留，流式与代码安全、来源去重')
for(const line of readFileSync(new URL('../../../.env',import.meta.url),'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2]}
const origin=process.env.CARDS_WEB||'http://127.0.0.1:4173',api=process.env.CARDS_API||'http://127.0.0.1:3002',production=origin.startsWith('https://'),out=new URL('../../../storage/shots/cards/',import.meta.url);mkdirSync(out,{recursive:true})
let auth,browser;const conversations=[],errors=[],clicks=[]
async function request(path,body,method){const r=await fetch(api+'/api'+path,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+auth.accessToken}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});const j=await r.json();assert.equal(j.code,0,path+': '+j.message);return j.data}
const facts={type:'facts',title:'办理信息',items:[{label:'日期',value:'2026-10-08'},{label:'完整条件',value:'说明条件。'.repeat(110)+'条件末尾完整保留'}]}
const faq={type:'faq',title:'办理问答',items:[{question:'在哪里办理？',answer:'请使用[办理入口](https://example.invalid/service)。'},{question:'要带哪些材料？',answer:'须本人携带证件，**不可委托**。'}]}
const notice={type:'notice',title:'截止时间提示',tone:'warning',body:'截止日期为 **2026-10-31**，请保留原文中的附加条件。'}
const guide={type:'guide',title:'继续了解',items:[{label:'查看办理条件',action:'请继续查询办理条件'}]}
const compare={type:'compare',title:'完整比较表',columns:['项目','安排'],rows:Array.from({length:22},(_,i)=>['第'+(i+1)+'项','安排'+(i+1)])}
const care={type:'care',title:'最近压力很大，我们慢慢说',body:'先不急着做决定，可以说说最让你难受的事。',actions:[{label:'我想继续聊聊',action:'我想继续说说现在的压力'}]}
const crisis={type:'crisis',title:'先让自己安全下来',body:'找一个信任的人陪着你。',hotline:{number:'000-0000'}}
const places={type:'places',title:'校园卡办理相关入口',items:[{name:'校园卡服务窗口',campus:'良乡校区',location:'教学综合楼3层309',body:'校园卡补办、挂失解挂线下办理点；电话 010-52576021。',url:'https://example.invalid/window',linkLabel:'查看详情'},{name:'一站式服务大厅',campus:'两校区通用',location:'线上',body:'校园卡挂失、解挂与补办、退卡在线入口。',url:'https://example.invalid/service',linkLabel:'查看详情'},{name:'阅览室',campus:'望京校区',body:'请查询当前安排。',url:'javascript:alert(1)',action:'查询阅览室开放安排'}]}
const legacy=[{type:'options',title:'先聊哪个',options:[{label:'课程压力',action:'课程压力'}]},{type:'steps',title:'办理流程',steps:[{title:'本人办理',desc:'携带证件'}]},{type:'poem',title:'赠言',body:'慢慢走\n也会到达',vertical:false},{type:'article',title:'校园说明',sections:[{heading:'准备事项',paragraphs:['须本人办理。']}]},{type:'agents',title:'其他助手',agents:[{id:'fixture',name:'验证助手'}]},{type:'map',campus:'liangxiang'},{type:'effect',effect:'cat'}]
const codeFixture='const demo = "<img src=x onerror=alert(1)>";'
const answer=[prose,fence({type:"sections",layout:"grid",sections:[{heading:"开放时间",body:"2026-10-08，仅工作日。"},{heading:"申请条件",body:"须本人携带证件。"}]}),fence(faq),'- 证件须由本人携带。\n- 原文日期为 2026-10-08。\n- 不可委托办理。',fence(facts),'| 项目 | 说明 |\n| --- | --- |\n| 校区 | 良乡 |\n| 条件 | 本人办理 |',fence(notice),fence(compare),fence(places),fence(care),fence(crisis).replace('```card','```json'),...legacy.map(fence),fence(guide),sourceCard,'```javascript\n'+codeFixture+'\n```'].join('\n\n')
const source={id:'cards-fixture',citationId:'401',title:'学生手册 / 办理说明',summary:'办理时间、条件与入口。',collection:'handbook',source:'学生手册',used:true,trust:'handbook',url:'https://example.invalid/source'}
try{
 auth=await request('/auth/login',{email:production?(process.env.INTEGRATE_EMAIL||process.env.SEED_ADMIN_EMAIL):process.env.SEED_ADMIN_EMAIL||'admin@cagent.local',password:production?(process.env.INTEGRATE_PASSWORD||process.env.SEED_ADMIN_PASSWORD):process.env.SEED_ADMIN_PASSWORD||'CHANGE_ME_SEED_ADMIN_PASSWORD'})
 const pub=await request('/settings/public');browser=await chromium.launch({headless:true})
 for(const route of ['/chat','/student','/test']){
  const conversation=await request('/conversations',{title:'卡片排版隔离验证'});conversations.push(conversation.id)
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),submitted=[]
  await context.addInitScript(a=>{localStorage.setItem('cagent.accessToken',a.accessToken);localStorage.setItem('cagent.refreshToken',a.refreshToken);sessionStorage.setItem('cagent-campusnet-answered','1');if(a.user?.id)localStorage.setItem('cagent-onboarded-'+a.user.id,'1')},auth)
  page.on('pageerror',e=>errors.push(e.message))
  await context.route('https://example.invalid/**',r=>r.fulfill({contentType:'text/html',body:'<p>隔离链接验证</p>'}))
  await context.route('https://api.open-meteo.com/**',r=>r.abort())
  await context.route('**/api/**',async handler=>{
   try{
   const req=handler.request(),url=new URL(req.url())
   if(url.pathname==='/api/settings/public')return handler.fulfill({json:{code:0,data:{...pub,student_default_theme:'light',student_allow_theme_toggle:true,student_show_knowledge_sources:true,student_show_weather:false,student_onboarding_enabled:false}}})
   if(url.pathname==='/api/campus/activity'){clicks.push(req.postDataJSON());return handler.fulfill({json:{code:0,data:{recorded:true}}})}
   if(url.pathname==='/api/conversations'&&req.method()==='POST')return handler.fulfill({json:{code:0,data:conversation}})
   if(url.pathname==='/api/trial/quota')return handler.fulfill({json:{code:0,data:{used:0,max:50,left:50}}})
   if(['/api/chat/completions','/api/trial/chat'].includes(url.pathname)&&req.method()==='POST'){
    submitted.push(req.postDataJSON().content)
    const frame=(e,p)=>'event: '+e+'\ndata: '+JSON.stringify(p)+'\n\n'
    return handler.fulfill({contentType:'text/event-stream',body:frame('meta',{conversationId:conversation.id,userMessageId:'u-'+submitted.length,assistantMessageId:'a-'+submitted.length,model:{id:'fixture',name:'排版验证'}})+frame('kb',{hits:[source]})+frame('text',{text:answer})+frame('trial',{roundId:'r-'+submitted.length,used:1,max:50,left:49})+frame('done',{status:'SUCCESS',conversationId:conversation.id})})
   }
   if(!production)return handler.fulfill({response:await handler.fetch({url:api+url.pathname+url.search})})
   return handler.continue()
   }catch{await handler.abort().catch(()=>undefined)}
  })
  await page.goto(origin+(route==='/chat'?'/chat/'+conversation.id:route),{waitUntil:'networkidle'});const input=page.getByRole('textbox',{name:'输入消息'})
  assert.equal(await page.evaluate(()=>performance.getEntriesByType('resource').filter(r=>r.name.includes('syntax-highlight-')).length),0,'没有代码时不加载高亮模块')
  await input.fill('卡片排版验证');await page.getByRole('button',{name:'发送',exact:true}).click()
  await page.locator('[data-card="sections"]').last().waitFor({timeout:45000})
  await page.locator('[data-card="compare"] table tbody tr').last().waitFor({timeout:45000})
  await page.locator('[data-card="guide"]').last().waitFor({timeout:45000})
  const message=page.locator('.nx-msg-ai').last()
  await message.locator('.md-code .hljs-keyword').waitFor({timeout:20000})
  assert.equal((await message.locator('.md-code code').innerText()).trim(),codeFixture);assert.equal(await message.locator('.md-code img').count(),0)
  for(const kind of ['sections','faq','facts','notice','compare','guide','care','crisis','places',...legacy.map(c=>c.type)])assert(await message.locator(`[data-card="${kind}"]`).count(),route+': '+kind)
  assert.equal(await message.locator('[data-card="reading"]').count(),0)
  assert(!(await message.innerText()).includes('要点整理'));assert(!(await message.innerText()).includes('答复要点'))
  assert.equal(await message.locator('.mc-crisis a[href="tel:12356"]').count(),1);assert.equal(await message.locator('a[href="tel:000-0000"]').count(),0)
  await message.getByRole('button',{name:'标记第 1 步',exact:true}).click();assert.equal(await message.getByRole('button',{name:'标记第 1 步（已完成）',exact:true}).getAttribute('aria-pressed'),'true')
  assert.equal(await message.locator('[data-card="sources"]').count(),0);assert.equal(await message.locator('.knowledge-sources').count(),1)
  assert((await message.innerText()).includes('条件末尾完整保留'));assert.equal(await message.locator('[data-card="compare"] tbody tr').count(),22)
  await message.locator('.faq-list summary').nth(1).click();assert((await message.innerText()).includes('不可委托'))
  assert.equal(await page.locator('a[href^="javascript:"]').count(),0)
  const placeCard=message.locator('[data-card="places"]'),offline=placeCard.locator('[data-service-mode="offline"]'),online=placeCard.locator('[data-service-mode="online"]')
  assert.equal(await offline.count(),1);assert.equal(await online.count(),1);assert((await offline.innerText()).includes('教学综合楼3层309'));assert((await offline.innerText()).includes('010-52576021'));assert.equal(await offline.locator('.place-icon svg circle').count(),1);assert.equal(await online.locator('.place-icon svg rect').count(),1)
  assert.equal(await offline.getByRole('link',{name:'查看窗口详情：校园卡服务窗口'}).count(),1);assert.equal(await online.getByRole('link',{name:'前往线上办理：一站式服务大厅'}).count(),1);assert.equal(await online.locator('dt').filter({hasText:'办理地址'}).count(),0)
  assert((await message.innerText()).includes('慢慢走'))
  await message.locator('.layout-body a,.faq-list a').first().click();await page.waitForTimeout(150);assert(clicks.some(c=>c.eventType==='LINK_CLICK'&&c.url==='https://example.invalid/service'),route+' 链接统计')
  for(const theme of ['light','dark']){
   await page.evaluate(theme=>document.documentElement.classList.toggle('dark',theme==='dark'),theme)
   await placeCard.scrollIntoViewIfNeeded();await page.screenshot({path:fileURLToPath(new URL((production?'production-':'local-')+route.slice(1)+'-places-'+theme+'.png',out)),fullPage:true})
   await message.locator('[data-card="sections"]').scrollIntoViewIfNeeded();await page.screenshot({path:fileURLToPath(new URL((production?'production-':'local-')+route.slice(1)+'-overview-'+theme+'.png',out)),fullPage:true})
   await message.locator('[data-card="notice"]').scrollIntoViewIfNeeded();await page.screenshot({path:fileURLToPath(new URL((production?'production-':'local-')+route.slice(1)+'-'+theme+'.png',out)),fullPage:true})
   const colors=await message.locator('.answer-section').first().evaluate(el=>{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');const rgb=color=>{ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3)}
    const lum=color=>rgb(color).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0)
    const bg=getComputedStyle(el).backgroundColor,fg=getComputedStyle(el.querySelector('.markdown-body')).color,a=lum(bg),b=lum(fg);return {rgb:rgb(bg),contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)}
   })
   assert(theme==='dark'?colors.rgb.every(v=>v<70):colors.rgb.every(v=>v>180),route+' 卡片主题背景');assert(colors.contrast>=4.5,route+' 卡片正文对比度')
  }
  await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth+2&&[...document.querySelectorAll('.st-side,.nx-sidebar,.ac-side')].every(el=>el.getBoundingClientRect().right<=2),{},{timeout:5000})
  await message.locator('[data-card="sections"]').scrollIntoViewIfNeeded();assert.equal(await message.locator('.section-grid').first().evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),1)
  await page.screenshot({path:fileURLToPath(new URL((production?'production-':'local-')+route.slice(1)+'-mobile.png',out)),fullPage:true})
  await placeCard.scrollIntoViewIfNeeded();assert.equal(await placeCard.locator('.place-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),1);await page.screenshot({path:fileURLToPath(new URL((production?'production-':'local-')+route.slice(1)+'-places-mobile.png',out)),fullPage:true})
  await message.locator('[data-card="care"]').scrollIntoViewIfNeeded();await page.screenshot({path:fileURLToPath(new URL((production?'production-':'local-')+route.slice(1)+'-care-mobile.png',out)),fullPage:true})
  await page.setViewportSize({width:1440,height:1000});await message.getByRole('button',{name:/^我想继续聊聊/}).click()
  if(route==='/chat')assert.equal(await input.inputValue(),'我想继续说说现在的压力')
  else{await page.waitForFunction(()=>document.querySelectorAll('.nx-msg-ai').length>=2);assert.equal(submitted.at(-1),'我想继续说说现在的压力')}
  pass(route+' 真实主题分区、关怀/求助与七类原卡、固定热线、步骤交互、无整理框、全文来源、链接与追问、按需高亮与代码安全、明暗手机布局')
  await context.unrouteAll({behavior:'wait'});await context.close()
 }
 assert.deepEqual(errors,[])
}finally{
 await browser?.close();for(const id of conversations)await request('/conversations/'+id,undefined,'DELETE')
 writeFileSync(new URL((production?'production-':'local-')+'verification.json',out),JSON.stringify({origin,checkedAt:new Date().toISOString(),checks,errors,transport:'Actual browser UI + isolated SSE; temporary blank conversations soft-deleted, no model billing'},null,2))
}
