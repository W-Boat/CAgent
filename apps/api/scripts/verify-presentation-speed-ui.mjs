import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {mkdirSync,writeFileSync} from 'node:fs'
const site=process.env.UI_WEB||'http://127.0.0.1:4173',out=new URL('../../../storage/shots/presentation-speed/',import.meta.url),results=[];mkdirSync(out,{recursive:true})
const browser=await chromium.launch({headless:true})
try{for(const path of ['/chat','/student','/test']){
 const ctx=await browser.newContext({viewport:{width:1100,height:800}}),errors=[]
 await ctx.addInitScript(()=>{
  localStorage.setItem('cagent.accessToken','speed-fixture');localStorage.removeItem('cagent.trial.sessions.v2')
  const original=window.fetch;window.fetch=async(input,init)=>{
   if(!/\/api\/(?:chat\/(?:completions|regenerate)|trial\/chat)$/.test(String(input)))return original(input,init)
   window.speedRequests=(window.speedRequests||0)+1
   const frame=(event,data)=>'event: '+event+'\ndata: '+JSON.stringify(data)+'\n\n',encoder=new TextEncoder(),mark=String.fromCharCode(96).repeat(3),doc={type:'page',version:'0.1',id:'speed_ui',layout:'stack',children:[{type:'text',id:'summary',content:'携带学生证原件前往服务窗口。'},{type:'steps',id:'procedure',title:'办理步骤',steps:[{title:'准备材料',desc:'核对学生证和个人信息。'},{title:'前往窗口',desc:'按照现场指引办理。'}]}]},raw=JSON.stringify(doc),source={id:'speed-source',citationId:'S1',title:'窗口指引',collection:'handbook',source:'模拟资料',used:false}
   return new Response(new ReadableStream({start(c){const send=(e,d)=>c.enqueue(encoder.encode(frame(e,d)));send('runtime',{stage:'preparing',round:0,maxRounds:3});send('meta',{conversationId:'speed-fixture',assistantMessageId:'speed-a',userMessageId:'speed-u',model:{id:'fixture',key:'fixture',name:'模拟助手',provider:'fixture'}})
    setTimeout(()=>send('runtime',{stage:'context',round:0,maxRounds:3}),250)
    setTimeout(()=>{send('runtime',{stage:'model',round:1,maxRounds:3});send('kb',{hits:[source]});send('text',{text:'先准备学生证。\n\n'})},850)
    setTimeout(()=>send('text',{text:mark+'card\n'+raw.slice(0,100)}),1250)
    setTimeout(()=>send('text',{text:raw.slice(100)+'\n'+mark+'\n\n'}),2200)
    for(let i=0;i<18;i++)setTimeout(()=>send('text',{text:'补充说明。'}),2400+i*55)
    setTimeout(()=>{send('kb',{hits:[{...source,used:true,summary:'最终来源摘要'}]});send('done',{status:'SUCCESS',runtime:{modelTurns:1,toolCalls:0,cachedCalls:0,failedTools:0,removedTurns:0,truncatedResults:0,peakInputTokens:100,latencyMs:3500,limitReached:false}});c.close()},3550)
   }}),{headers:{'Content-Type':'text/event-stream'}})
  }
 })
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message))
 await ctx.route('**/api/**',route=>{const request=route.request(),p=new URL(request.url()).pathname,ok=data=>route.fulfill({json:{code:0,data}})
  if(p==='/api/auth/me')return ok({id:'speed-user',email:'fixture@example.invalid',name:'测试',roles:[],permissions:['*']})
  if(p==='/api/settings/public')return ok({site_name:'CAgent',memory_enabled:false,onboarding_enabled:false,student_tool_activity:true,student_show_weather:false})
  if(p==='/api/models/available')return ok([{id:'fixture',key:'fixture',name:'模拟模型',isDefault:true,provider:{name:'fixture'}}])
  if(p==='/api/agents/available')return ok([])
  if(p==='/api/trial/quota')return ok({used:0,max:100,left:100})
  if(p==='/api/conversations')return ok(request.method()==='POST'?{id:'speed-fixture',title:'测试'}:{items:[],total:0})
  if(p==='/api/conversations/speed-fixture')return ok({id:'speed-fixture',title:'测试'})
  if(p.endsWith('/messages'))return ok({items:[],total:0})
  return ok([])
 })
 await page.goto(site+path,{waitUntil:'domcontentloaded'});const input=page.getByRole('textbox',{name:'输入消息'});await input.waitFor();await input.fill('如何补办校园卡');const start=Date.now();await input.press('Enter')
 await page.locator('.answer-pending').first().waitFor({timeout:8000}).catch(async e=>{console.log(JSON.stringify({path,requests:await page.evaluate(()=>window.speedRequests||0),body:(await page.locator('body').innerText()).slice(-1200)}));throw e});const placeholderMs=Date.now()-start
 await page.getByText('正在整理问题和资料',{exact:true}).waitFor();await page.getByText('先准备学生证。',{exact:true}).waitFor()
 await page.locator('.answer-pending').first().waitFor();assert(!await page.locator('.nx-msg-body').last().innerText().then(t=>t.includes('"children"')))
 await page.locator('[data-ui-id="speed_ui"]').waitFor();await page.evaluate(()=>window.firstSpeedCard=document.querySelector('[data-ui-id="speed_ui"]'))
 await page.getByRole('button',{name:'发送',exact:true}).waitFor();await page.waitForTimeout(180)
 assert(await page.evaluate(()=>window.firstSpeedCard===document.querySelector('[data-ui-id="speed_ui"]')),'完整卡片被追加文本或终态替换')
 assert.equal(await page.locator('[data-ui-id="speed_ui"]').count(),1);assert.equal(await page.locator('.answer-pending').count(),0);assert.equal(await page.locator('.agent-phase-wrap').count(),0);assert.deepEqual(errors,[])
 if(path==='/test'){await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.classList.add('dark'));await page.screenshot({path:new URL(site.startsWith('https:')?'production-mobile.png':'local-mobile.png',out).pathname.replace(/^\/([A-Za-z]:)/,'$1'),fullPage:true})}
 results.push({path,placeholderMs,stableCardNode:true,noRawJson:true,noStuckLoading:true});await ctx.close()
 }
 writeFileSync(new URL(site.startsWith('https:')?'production-ui.json':'local-ui.json',out),JSON.stringify({passed:true,results,externalModelCalls:0,scope:'Real built interface; all APIs and model responses are synthetic.'},null,2));console.log(JSON.stringify({passed:true,results}))
}finally{await browser.close()}
