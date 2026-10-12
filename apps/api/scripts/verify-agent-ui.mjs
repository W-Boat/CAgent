import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
const require=createRequire(import.meta.url),{chromium}=require('playwright'),ts=require('typescript')
const checks=[],pass=s=>{checks.push(s);console.log('PASS '+s)},shots=new URL('../../../storage/shots/runtime/',import.meta.url)
mkdirSync(shots,{recursive:true})
const source=readFileSync(new URL('../../web/src/api/sse.ts',import.meta.url),'utf8'),compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
const {readSse,requestSse}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'))
const response=text=>{const bytes=new TextEncoder().encode(text);return new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=3)controller.enqueue(bytes.slice(i,i+3));controller.close()}}),{headers:{'content-type':'text/event-stream'}})}
const received=[]
await readSse(response(': keepalive\r\nevent: text\r\ndata: {\r\ndata: "text":"你好🐍"\r\ndata: }\r\n\r\nevent: done\r\ndata: {"status":"SUCCESS"}'),frame=>{received.push(frame);return frame.event==='done'})
assert.equal(received[0].data.text,'你好🐍');assert.equal(received[1].event,'done');pass('实际前端解析器处理跨字节 UTF-8、CRLF、多行 data 和末尾未补空行的完成事件')
const realFetch=globalThis.fetch
async function transportCase(fetcher){globalThis.fetch=fetcher;const terminal=[],errors=[],texts=[];const request=requestSse({url:'http://fixture.invalid',body:{},onFrame:f=>{if(f.event==='text')texts.push(f.data.text)},onDone:d=>terminal.push(d),onError:e=>errors.push(e)});return {request,terminal,errors,texts}}
try{
 const unavailable=await transportCase(async()=>{throw new Error('connection unavailable')});await unavailable.request.done;assert.equal(unavailable.terminal.length,1);assert.equal(unavailable.terminal[0].status,'FAILED')
 const interrupted=await transportCase(async()=>response('event: text\ndata: {"text":"部分答案"}\n\n'));await interrupted.request.done;assert.equal(interrupted.terminal[0].status,'FAILED');assert.equal(interrupted.texts[0],'部分答案')
 const invalid=await transportCase(async()=>response('event: text\ndata: invalid\n\n'));await invalid.request.done;assert.equal(invalid.terminal[0].status,'FAILED')
 const duplicated=await transportCase(async()=>response('event: done\ndata: {"status":"SUCCESS"}\n\nevent: done\ndata: {"status":"SUCCESS"}\n\n'));await duplicated.request.done;assert.equal(duplicated.terminal.length,1)
 const stopped=await transportCase((_,options)=>new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('stopped','AbortError')))));stopped.request.abort();await stopped.request.done;assert.equal(stopped.terminal[0].status,'ABORTED');assert.deepEqual(stopped.errors,[])
 pass('连接失败/异常断流/无效数据为 FAILED，用户停止为 ABORTED，所有路径只完成一次')
}finally{globalThis.fetch=realFetch}

for(const line of readFileSync(new URL('../../../.env',import.meta.url),'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2]}
const origin=process.env.RUNTIME_WEB||'http://127.0.0.1:4173',api=process.env.RUNTIME_API||'http://127.0.0.1:3002'
let auth
async function request(path,body,method){const r=await realFetch(api+'/api'+path,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+auth.accessToken}:{})},body:body?JSON.stringify(body):undefined}),j=await r.json();assert.equal(j.code,0,path);return j.data}
auth=await request('/auth/login',{email:process.env.INTEGRATE_EMAIL||process.env.SEED_ADMIN_EMAIL,password:process.env.INTEGRATE_PASSWORD||process.env.SEED_ADMIN_PASSWORD})
const browser=await chromium.launch({headless:true}),errors=[],conversations=[],metrics={modelTurns:2,toolCalls:2,cachedCalls:1,failedTools:1,removedTurns:3,truncatedResults:0,peakInputTokens:1250,latencyMs:900,limitReached:false}
const knowledge={id:'runtime-fixture',title:'验证知识来源',collection:'handbook',source:'隔离 UI 验证',summary:'用于检查来源展示兼容',used:true,citationId:'90001'}
try{
 for(const route of ['/chat','/student','/test']){
  const conversation=await request('/conversations',{title:'隔离 UI 运行验证'});conversations.push(conversation.id)
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();let history=false
  await context.addInitScript(a=>{localStorage.setItem('cagent.accessToken',a.accessToken);localStorage.setItem('cagent.refreshToken',a.refreshToken);localStorage.setItem('cagent-theme','dark');sessionStorage.setItem('cagent-campusnet-answered','1');sessionStorage.setItem('cagent-campusnet-campus','0');if(a.user?.id)localStorage.setItem('cagent-onboarded-'+a.user.id,'1')},auth)
  await context.route('https://api.open-meteo.com/**',r=>r.abort())
  page.on('pageerror',error=>errors.push(error.message))
  await context.route('**/api/**',async handler=>{
   try{
    const req=handler.request(),url=new URL(req.url())
    if((url.pathname.endsWith('/chat/completions')||url.pathname.endsWith('/trial/chat'))&&req.method()==='POST'){
     const frame=(event,data)=>'event: '+event+'\ndata: '+JSON.stringify(data)+'\n\n'
     const body=frame('meta',{conversationId:conversation.id,userMessageId:'ui-user',assistantMessageId:'ui-assistant',title:'运行验证',model:{id:'fixture',key:'fixture',name:'运行验证',provider:'fixture'}})+frame('runtime',{stage:'tools',round:1,maxRounds:5})+frame('kb',{hits:[knowledge]})+frame('tool_start',{id:'first',name:'knowledge_search',arguments:{query:'验证'}})+frame('tool_result',{id:'first',name:'knowledge_search',result:'验证资料',status:'SUCCESS',cached:true,durationMs:12})+frame('tool_start',{id:'second',name:'web_fetch',arguments:{url:'https://example.invalid'}})+frame('tool_result',{id:'second',name:'web_fetch',result:'读取失败',status:'FAILED',isError:true,durationMs:20})+frame('text',{text:'已使用知识资料回答，网页读取失败已明确说明。'})+frame('done',{conversationId:conversation.id,assistantMessageId:'ui-assistant',status:'SUCCESS',runtime:metrics})
     return handler.fulfill({status:200,contentType:'text/event-stream',body})
    }
    if(url.pathname==='/api/trial/quota')return handler.fulfill({json:{code:0,data:{used:0,max:5,left:5}}})
    if(history&&url.pathname.includes('/conversations/'+conversation.id+'/messages'))return handler.fulfill({json:{code:0,data:{items:[{id:'ui-assistant',role:'assistant',content:'历史保留运行指标',createdAt:new Date().toISOString(),status:'SUCCESS',totalTokens:240,latencyMs:900,attachments:{agentRun:metrics,knowledgeSources:[knowledge]},toolCalls:[{id:'first',name:'knowledge_search',arguments:'{}',result:'已查到资料',status:'SUCCESS',cached:true,durationMs:12}]}],total:1,page:1,pageSize:200}}})
    if(api.startsWith('http://127.0.0.1'))await handler.fulfill({response:await handler.fetch({url:api+url.pathname+url.search})})
    else await handler.continue()
   }catch{await handler.abort().catch(()=>undefined)}
  })
  await page.goto(origin+route,{waitUntil:'networkidle'});const input=page.getByRole('textbox',{name:'输入消息'});await input.fill('运行逻辑验证');await page.getByRole('button',{name:'发送',exact:true}).click()
  // Student text animation and metadata can replace an optimistic message DOM.
  // Wait for the completed answer, then expand the current trace rather than an earlier node.
  await page.getByText('已使用知识资料回答，网页读取失败已明确说明。',{exact:false}).last().waitFor()
  const trace=page.locator('.agent-trace').last();await trace.waitFor();if(!await trace.evaluate(element=>element.open))await trace.locator('summary').click();await trace.locator('.agent-tool.is-error').last().waitFor()
  assert((await trace.innerText()).includes('失败'));assert((await trace.innerText()).includes('复用本轮结果'))
  assert(await page.locator('.knowledge-sources').count())
  if(route==='/chat'){assert((await trace.innerText()).includes('峰值输入估算'));history=true;await page.reload({waitUntil:'networkidle'});await page.locator('.agent-trace').last().waitFor();await page.locator('.agent-trace summary').last().click();assert((await page.locator('.agent-trace').last().innerText()).includes('1250'))}
  else assert.equal(await page.locator('.agent-metrics').count(),0)
  await page.screenshot({path:fileURLToPath(new URL((origin.startsWith('https://')?'production-':'local-')+route.slice(1)+'-runtime-dark.png',shots)),fullPage:true})
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  pass(route+' 显示真实工具失败/本轮复用；管理指标与历史、知识来源、夜间和手机兼容（隔离 SSE fixture）')
  await context.unrouteAll({behavior:'wait'});await context.close()
 }
 assert.deepEqual(errors,[])
}finally{
 await browser.close()
 for(const id of conversations)await request('/conversations/'+id,undefined,'DELETE')
 writeFileSync(new URL((origin.startsWith('https://')?'production-':'local-')+'ui-verification.json',shots),JSON.stringify({checkedAt:new Date().toISOString(),origin,checks,errors,transport:'Actual frontend build, shared transport tests and isolated SSE fixtures; temporary blank conversations soft-deleted'},null,2))
}
