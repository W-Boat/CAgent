import 'reflect-metadata'
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createRequire} from 'node:module'
import ts from 'typescript'
import {ToolMarkupStream,stripToolMarkup} from '../src/presentation/output-boundary'
import {validateUiDocument} from '../src/presentation/agent-ui'
import {presentationPrompt,inspectPresentation} from '../src/presentation/presentation-engine'
import {ResponseCacheService,cacheHistory,cacheEligible,cacheableAnswer} from '../src/chat/response-cache.service'
import {parseCardJson} from '../src/presentation/card-json'
import {AnswerPresentationStream,formatAnswerPresentation} from '../src/presentation/answer-presentation'
const root=resolve(__dirname,'../../..'),checks:string[]=[],pass=(s:string)=>{checks.push(s);console.log('PASS '+s)}
function frontend(path:string,deps:Record<string,any>={}){const module={exports:{} as any};new Function('module','exports','require',ts.transpileModule(readFileSync(resolve(root,path),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(module,module.exports,(n:string)=>deps[n]);return module.exports}
async function main(){
 for(const bars of ['｜','|','||'])for(const wrapper of ['function_calls','tool_calls','invoke']){
  const input=`说明<${bars}DSML${bars}${wrapper}><${bars}DSML${bars}invoke name="delete"><${bars}DSML${bars}parameter name="secret">不可见</${bars}DSML${bars}parameter></${bars}DSML${bars}invoke></${bars}DSML${bars}${wrapper}>结论`
  for(let width=1;width<=31;width++){const f=new ToolMarkupStream();let visible='';for(let i=0;i<input.length;i+=width)visible+=f.push(input.slice(i,i+width));visible+=f.finish();assert.equal(visible,'说明结论');assert(f.removed)}
 }
 for(const input of ['正常 < 3','<b>普通HTML</b>','```js\nx < y\n```','末尾<'])assert.equal(stripToolMarkup(input),input)
 for(const input of ['说明<｜D','说明<｜DSML｜invoke name="x">隐藏','说明<DSML tool_calls>隐藏'])assert.equal(stripToolMarkup(input),'说明')
 pass('DSML 全角/半角、任意分段、嵌套与未闭合调用隐藏；普通数学和代码保留')
 const webRequire=createRequire(resolve(root,'apps/web/package.json')),MarkdownIt=webRequire('markdown-it'),{cjkStrong}=frontend('apps/web/src/utils/cjk-strong.ts'),md=new MarkdownIt({html:false}).use(cjkStrong)
 for(const input of ['请阅读**《青春社科大》**第一期','**《学生手册》**中的内容','请阅读**《书名》**，再提问'])assert(md.render(input).includes('<strong>《'))
 assert(md.render('**普通加粗**').includes('<strong>普通加粗</strong>'));assert(!md.render('`**《书名》**`').includes('<strong>'));assert(!md.render('\\*\\*《书名》\\*\\*').includes('<strong>'));assert(!md.render('**《<img src=x onerror=alert(1)>》**').includes('<img'))
 pass('中文邻接书名号加粗、普通加粗、代码和转义边界及 HTML 安全')
 const page={type:'page',children:[{type:'info_card',title:'信息',children:[{type:'button',label:'继续',action:{kind:'ask',message:'继续说明'}}]},{type:'text',id:'duplicate',content:'甲'},{type:'text',id:'duplicate',content:'乙'}]}
 const repaired=validateUiDocument(page);assert(repaired.ok);assert.equal(repaired.page?.version,'0.1');assert.equal(repaired.page?.layout,'stack');assert(repaired.page?.fallback)
 assert(!validateUiDocument({...page,version:'99'}).ok);assert(!validateUiDocument({...page,sourceRefs:['unapproved']},{sourceIds:new Set()}).ok);assert(!validateUiDocument({...page,children:[{type:'button',label:'危险',action:{kind:'execute',code:'alert(1)'}}]}).ok)
 assert(validateUiDocument({type:'page',id:'duplicate',children:[14,14,15].map(n=>({type:'card_group',id:'duplicate',children:Array.from({length:n},()=>({type:'text',id:'duplicate',content:'保留全部节点'}))}))}).ok,'Duplicate ID repair must not consume extra node budget')
 assert(presentationPrompt('材料是什么',new Set(),{outputPreference:'text'}).includes('文字为主'));assert(!presentationPrompt('材料是什么',new Set(),{outputPreference:'text'}).includes('注册表'));assert(presentationPrompt('材料是什么',new Set(),{outputPreference:'cards'}).includes('固定卡片'));assert(!inspectPresentation('```card\n{"type":"checklist","items":[{"title":"证件"}]}\n```',new Set(),'材料是什么',{outputPreference:'cards'}).selectionWarning)
 pass('仅补布局/版本/ID；未知版本、未授权来源和操作仍拒绝，三种输出策略互不冲突')
 const boundary=frontend('apps/web/src/utils/output-boundary.ts'),ui=frontend('apps/web/src/utils/agent-ui.ts'),json=frontend('apps/web/src/utils/card-json.ts'),segments=frontend('apps/web/src/utils/card-segments.ts',{'./agent-ui':ui,'./card-json':json}),{answerSegments}=frontend('apps/web/src/utils/answer-layout.ts',{'./card-segments':segments,'./output-boundary':boundary,'./card-json':json})
 assert.equal(answerSegments('正文\n```json\n{"type":"page","children":[',{streaming:true}).at(-1).kind,'pending');assert.equal(answerSegments('```card\n{"type":"page"',{streaming:false})[0].kind,'broken');assert.equal(answerSegments('```card\n'+JSON.stringify(page),{streaming:false})[0].kind,'card');assert.equal(answerSegments('```json\n{"name":"code"',{streaming:true})[0].kind,'markdown')
 let next=0;const frames=new Map<number,()=>void>();(globalThis as any).window={requestAnimationFrame:(cb:()=>void)=>{frames.set(++next,cb);return next},cancelAnimationFrame:(id:number)=>frames.delete(id)}
 const {createStreamTyper}=frontend('apps/web/src/utils/stream-typewriter.ts'),target={},writes:string[]=[],typer=createStreamTyper({write:(_:object,v:string)=>writes.push(v)}),tick=()=>{const callbacks=[...frames.values()];frames.clear();callbacks.forEach(f=>f())}
 const raw='```card\n'+JSON.stringify(page)+'\n```';typer.push(target,raw);tick();assert.equal(writes.at(-1),raw);assert.equal(frames.size,0);let ended=0;typer.end(target,()=>ended++);tick();assert.equal(ended,1);assert.equal(frames.size,0);typer.dispose()
 const t={},plain=createStreamTyper({write:(_:object,v:string)=>writes.push(v)});plain.push(t,'字'.repeat(1000));let caught=0;plain.end(t,()=>caught++);tick();assert.equal(writes.at(-1)?.length,1000);assert.equal(caught,1);plain.dispose()
 pass('未完整结构用占位，结束不永久加载；卡片/完成响应下一帧显示，网络空闲无 rAF 轮询')
 assert(cacheEligible('解释成语学而不厌'));for(const q of ['今天吃什么','最新公告','删除我的记录','weather today','随机推荐'])assert(!cacheEligible(q));assert(!cacheEligible('问题',[],true));assert(!cacheEligible('问题',['data:image/png;base64,AA']))
 assert.deepEqual(cacheHistory([{role:'user',content:'题目'},{role:'assistant',content:'回答'},{role:'user',content:'题目'}],'题目'),[]);assert.equal(cacheHistory([{role:'user',content:'另一题'},{role:'assistant',content:'回答'},{role:'user',content:'追问'}],'追问').length,0)
 assert(!cacheableAnswer('```card\n{"type":"page"'));assert(!cacheableAnswer('```card\nnot json\n```'));assert(!cacheableAnswer('<｜DSML｜invoke>隐藏</｜DSML｜invoke>'))
 const directory=await mkdtemp(resolve(root,'.tmp/cache-verification-')),cwd=process.cwd();process.chdir(directory);let revision=1,enabled=true,days=3
 const aggregate={aggregate:async()=>({_count:1,_max:{updatedAt:revision}})},cache=new ResponseCacheService({knowledgeBase:aggregate,knowledgeEntry:aggregate,campusGuideItem:aggregate,setting:aggregate,skill:aggregate} as any,{get:async(k:string)=>k==='answer_cache_enabled'?enabled:days} as any);process.chdir(cwd)
 try{const context={user:'one',model:'one',preference:'adaptive',history:[]},ticket=(await cache.prepare(context))!;assert(ticket);await cache.put(ticket,{content:'安全回答',sources:[],presentation:{valid:true}});assert.equal((await cache.get(ticket))?.content,'安全回答')
  for(const change of [{user:'two'},{model:'two'},{preference:'text'}])assert.equal(await cache.get(await cache.prepare({...context,...change})),null)
  assert.equal((await cache.get(await cache.prepare({...context,history:[{role:'user',content:'另一主题'}],trialScope:'another-session'})))?.content,'安全回答')
  enabled=false;assert.equal(await cache.prepare(context),null);enabled=true;revision=2;assert.equal(await cache.get(await cache.prepare(context)),null);revision=1
  const file=join(directory,'storage/.private/answer-cache',ticket.key+'.json'),value=JSON.parse(await readFile(file,'utf8'));value.createdAt=Date.now()-2*86400000;await writeFile(file,JSON.stringify(value));assert(await cache.get(ticket));assert.equal(await cache.get({...ticket,days:1}),null)
  value.createdAt=Date.now();value.content='<｜DSML｜invoke>隐私</｜DSML｜invoke>';await writeFile(file,JSON.stringify(value));assert.equal(await cache.get(ticket),null);days=31;assert.equal(await cache.prepare(context),null)
 }finally{assert(directory.startsWith(resolve(root,'.tmp')+require('node:path').sep));await rm(directory,{recursive:true,force:true})}
 pass('磁盘缓存跨历史/会话同题命中，隔离用户/模型/偏好；开关、资料修订、缩短 TTL、损坏和内部协议均不误命中')
 const malformed='\uFEFF{"type":"page",// 格式注释\n"children":[{"type":"text","content":"https://example.com/a,} /*原文字*/",},],/*结束*/}'
 const recovered:any=parseCardJson(malformed);assert.equal(recovered.children[0].content,'https://example.com/a,} /*原文字*/');assert.throws(()=>parseCardJson('{"type":"page"'))
 assert(validateUiDocument(recovered).ok);assert.equal(answerSegments('```card\n'+malformed+'\n```',{streaming:false})[0].kind,'card')
 const answer='开头文字\n\n```card\n'+JSON.stringify({...page,children:[{type:'steps',title:'步骤',steps:[{title:'核对材料',desc:'携带原件'}]},{type:'checklist',title:'材料',items:[{title:'学生证'}]},{type:'table',title:'数据',columns:['甲','乙'],rows:[[1,2]]},{type:'button',label:'真实入口',action:{kind:'link',url:'https://example.com/entry'}}]})+'\n```\n结束文字',native='\n```card\n{"type":"care","body":"我在这里"}\n```'
 for(const pref of ['text','cards','adaptive'] as const){const expected=formatAnswerPresentation(answer+native,pref);for(let width=1;width<=23;width++){const stream=new AnswerPresentationStream(pref);let result='';for(let i=0;i<(answer+native).length;i+=width)result+=stream.push((answer+native).slice(i,i+width));result+=stream.finish();assert.equal(result,expected)}assert(expected.includes('学生证'));assert(expected.includes('https://example.com/entry'));assert(expected.includes('"type":"care"'));if(pref==='text'){assert(expected.includes('1. 核对材料：携带原件'));assert(!expected.includes('"type":"page"'))}if(pref==='cards'){assert(expected.includes('"type":"steps"'));assert(!expected.includes('"type":"page"'))}}
 const literal='````markdown\n```card\n'+JSON.stringify(page)+'\n```\n````';assert.equal(formatAnswerPresentation(literal,'text'),literal)
 assert(!cacheableAnswer('这部分回答未完整生成，请重新生成以补全内容。'))
 pass('JSON 仅恢复注释/尾逗号，数据不补造；文字/固定卡片确定性转换、原生卡保留、逐字分块与持久化结果一致')
 mkdirSync(resolve(root,'storage/shots/presentation'),{recursive:true});writeFileSync(resolve(root,'storage/shots/presentation/output-delivery-contract.json'),JSON.stringify({passed:true,checkedAt:new Date().toISOString(),checks,scope:'Contract tests with local isolated filesystem; no production writes or model calls'},null,2))
}
main().catch(e=>{console.error(e);process.exitCode=1})
