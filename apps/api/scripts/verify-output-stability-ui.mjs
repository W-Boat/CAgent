import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {chromium} from 'playwright'
const root=new URL('../../../',import.meta.url),site=process.env.UI_WEB||'http://127.0.0.1:4173',api='https://campus.example.org/api',errors=[],checks=[]
for(const line of readFileSync(new URL('.env',root),'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2]}
const auth=await fetch(api+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:process.env.INTEGRATE_EMAIL||process.env.SEED_ADMIN_EMAIL,password:process.env.INTEGRATE_PASSWORD||process.env.SEED_ADMIN_PASSWORD})}).then(r=>r.json());assert.equal(auth.code,0)
const corpus=JSON.parse(readFileSync(new URL('.tmp/output-audit/soak-samples.json',root),'utf8')).filter(s=>s.group!=='incomplete').slice(0,45),browser=await chromium.launch({headless:true})
try{
 for(const path of ['/chat','/student','/test']){
  const ctx=await browser.newContext({viewport:{width:1280,height:960}})
  await ctx.addInitScript(({auth,corpus})=>{
   localStorage.setItem('cagent.accessToken',auth.accessToken);localStorage.setItem('cagent.refreshToken',auth.refreshToken);localStorage.setItem('cagent-onboarded-'+auth.user.id,'1');window.stabilityCalls=[];window.stabilityMessages=[];window.versionSwitches=0
   const original=window.fetch;window.fetch=async(input,init)=>{
    const url=String(input);if(!/\/api\/(?:chat\/(?:completions|regenerate)|trial\/chat)$/.test(url))return original(input,init)
    const req=JSON.parse(init.body),calls=window.stabilityCalls,messages=window.stabilityMessages;calls.push(req);const n=calls.length,revision=req.messageId||req.revisionMessageId,target=revision?messages.find(m=>m.id===revision):{id:'a'+n,role:'assistant',status:'SUCCESS',content:'',createdAt:new Date().toISOString(),attachments:{}}
    if(!revision)messages.push({id:'u'+n,role:'user',content:req.content,createdAt:new Date().toISOString()},target)
    if(revision){target.versions||=[target.content];target.versions.push('新版回答：已经完成。');target.selected=target.versions.length-1;target.content=target.versions.at(-1)}else target.content=corpus[(n-1)%corpus.length].input
    const frame=(event,data)=>'event: '+event+'\ndata: '+JSON.stringify(data)+'\n\n';return new Response(frame('meta',{conversationId:'stability-fixture',model:{id:null,key:'fixture',name:'UI fixture',provider:'fixture'},assistantMessageId:target.id,userMessageId:revision?'u1':'u'+n})+frame('text',{text:target.content})+frame('done',{status:'SUCCESS',runtime:{modelTurns:1}}),{headers:{'Content-Type':'text/event-stream'}})
   }
  },{auth:auth.data,corpus})
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message))
  await ctx.route('**/api/**',async route=>{const req=route.request(),u=new URL(req.url()),ok=data=>route.fulfill({json:{code:0,data}})
   if(u.pathname==='/api/trial/quota')return ok({used:0,max:1000,left:1000})
   if(u.pathname==='/api/conversations')return ok(req.method()==='POST'?{id:'stability-fixture',title:'验证'}:{items:[{id:'stability-fixture',title:'验证',createdAt:new Date().toISOString()}],total:1})
   if(u.pathname==='/api/conversations/stability-fixture')return ok({id:'stability-fixture',title:'验证'})
   if(u.pathname.endsWith('/messages'))return ok({items:await page.evaluate(()=>window.stabilityMessages),total:2})
   if(u.pathname.includes('/versions')){const parts=u.pathname.split('/'),id=parts[5],index=Number(parts[7]);return ok(await page.evaluate(({id,index,method})=>{const msg=window.stabilityMessages.find(m=>m.id===id);if(!msg)return {selected:0,items:[]};if(method==='POST'){window.versionSwitches++;msg.selected=index;msg.content=msg.versions[index];return msg}return {selected:msg.selected||0,items:(msg.versions||[msg.content]).map((_,index)=>({index,status:'SUCCESS'}))}},{id,index,method:req.method()}))}
   if(u.pathname==='/api/campus/activity')return ok({recorded:true})
   return site.startsWith('https:')?route.continue():route.fulfill({response:await route.fetch({url:api+u.pathname.slice(4)+u.search})})
  })
  await page.goto(site+path,{waitUntil:'domcontentloaded'});const input=page.getByRole('textbox',{name:'输入消息'});await input.waitFor()
  const count=path==='/test'?corpus.length:2
  for(let i=0;i<count;i++){await input.fill('隔离排版测试'+i);await page.getByRole('button',{name:'发送',exact:true}).click();await page.waitForFunction(n=>window.stabilityCalls.length===n,i+1);try{await page.getByRole('button',{name:'重新生成',exact:true}).nth(i).waitFor({timeout:8000})}catch(e){console.log(JSON.stringify({path,i,body:(await page.locator('body').innerText()).slice(-1600),state:await page.evaluate(()=>({calls:window.stabilityCalls,messages:window.stabilityMessages.map(m=>({id:m.id,status:m.status,length:m.content.length}))}))}));throw e}assert.equal(await page.locator('.answer-pending,.card-render-failure,[data-ui-fallback]').count(),0);assert(!(await page.locator('body').innerText()).includes('"type":"page"'))}
  const before=await page.evaluate(()=>window.stabilityMessages.filter(m=>m.role==='user').length);await page.getByRole('button',{name:'重新生成',exact:true}).first().click();await page.getByRole('button',{name:'上一版回答'}).first().waitFor();const after=await page.evaluate(()=>window.stabilityCalls.length);assert.equal(await page.evaluate(()=>window.stabilityMessages.filter(m=>m.role==='user').length),before)
  const calls=await page.evaluate(()=>window.stabilityCalls);assert(path==='/test'?calls.at(-1).revisionMessageId==='a1':calls.at(-1).messageId==='a1')
  await page.getByRole('button',{name:'上一版回答'}).first().click();await page.getByRole('button',{name:'下一版回答'}).first().click();assert.equal(await page.evaluate(()=>window.stabilityCalls.length),after,'saved version switches must not call model')
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.classList.add('dark'));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));checks.push({path,renderCases:count,historicalRegeneration:true,duplicateQuestions:0,freeVersionSwitches:true});await ctx.unrouteAll({behavior:'ignoreErrors'});await ctx.close()
 }
 assert.deepEqual(errors,[]);mkdirSync(new URL('storage/shots/presentation/',root),{recursive:true});writeFileSync(new URL('storage/shots/presentation/'+(site.startsWith('https:')?'production':'local')+'-stability-ui.json',root),JSON.stringify({checkedAt:new Date().toISOString(),passed:true,checks,errors,scope:'Actual built UI, isolated replies and version API, production auth/read-only metadata; no billed model calls'},null,2));console.log(JSON.stringify({passed:true,checks}))
}finally{await browser.close()}
