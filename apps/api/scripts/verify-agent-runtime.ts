import 'reflect-metadata'
import assert from 'node:assert/strict'
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {EventEmitter} from 'node:events'
import {RuntimeCheckpointService} from '../src/chat/runtime/runtime-checkpoint.service'
import type {RuntimeState} from '../src/chat/runtime/runtime-state'
import {AgentRuntime,type RuntimeTool} from '../src/chat/runtime/agent-runtime'
import {parseToolArguments} from '../src/chat/runtime/tool-validation'
import {fitContext} from '../src/chat/runtime/context-budget'
import {ContextBuilderService} from '../src/chat/context-builder.service'
import {anthropicMessages,googleContents} from '../src/chat/llm/message-adapters'
import type {ChatMessage,LlmChatOptions,LlmStreamEvent} from '../src/chat/llm/types'
import {checkAbort} from '../src/common/abort'
import {reserveTurn} from '../src/chat/session-turns'
import {PrismaService} from '../src/prisma/prisma.service'
import {AuditService} from '../src/common/services/audit.service'
import {SkillsEngineService} from '../src/skills/skills-engine.service'
import {ConversationsService} from '../src/conversations/conversations.service'
import {TrialService} from '../src/trial/trial.service'
import {ChatService} from '../src/chat/chat.service'
import {needsAutomaticKnowledge} from '../src/chat/knowledge-routing'
import {KnowledgeStoreService} from '../src/knowledge/knowledge-store.service'
import {CampusGuideService} from '../src/campus/campus-guide.service'
import {KnowledgeRetrievalBudget} from '../src/chat/knowledge-retrieval-policy'
import {SettingsService} from '../src/settings/settings.service'
import {SETTING_MAP} from '../src/settings/setting-defs'
import {ResponseCacheService} from '../src/chat/response-cache.service'
import {STRICT_FALLBACK,EVALUATION_V2_SOURCES} from '../src/evaluation/evaluation-policy'
import {mkdtemp,rm} from 'node:fs/promises'

const root=resolve(__dirname,'../../..'),checks:string[]=[],pass=(s:string)=>{checks.push(s);console.log('PASS '+s)}
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms))
const schema={type:'object',properties:{q:{type:'string',minLength:1},count:{type:'integer',minimum:1}},required:['q'],additionalProperties:false}
const lookup:RuntimeTool={name:'lookup',description:'只读查询',parameters:schema,readOnly:true,execute:async args=>'资料：'+args.q}
function fakeProvider(run:(options:LlmChatOptions,round:number)=>AsyncGenerator<LlmStreamEvent>){let round=0;return {type:'OPENAI_COMPATIBLE' as const,stream:(options:LlmChatOptions)=>run(options,++round)}}
const base={messages:[{role:'system',content:'基于来源回答'},{role:'user',content:'请查资料'}] as ChatMessage[],request:{model:'test',apiKey:'not-a-real-key',maxTokens:256},contextWindow:4096,maxToolRounds:3}
async function run(provider:any,tools:RuntimeTool[],extra:any={}){const events:any[]=[];const result=await new AgentRuntime().run({...base,provider,tools,signal:new AbortController().signal,emit:(event:string,data:any)=>events.push({event,...data}),...extra});return {result,events}}

async function unit(){
 let serializedExecuted=0;const serialized='<｜DSML｜function_calls><｜DSML｜invoke name="lookup"><｜DSML｜parameter name="q">隐藏</｜DSML｜parameter></｜DSML｜invoke></｜DSML｜function_calls>'
 const hidden=await run(fakeProvider(async function*(){yield {type:'text',text:'解释'};for(const char of serialized)yield {type:'text',text:char};yield {type:'reasoning',text:serialized};yield {type:'done'}}),[{...lookup,execute:async()=>{serializedExecuted++;return '不应调用'}}]);assert.equal(serializedExecuted,0);assert.equal(hidden.result.text,'解释');assert.equal(hidden.result.reasoning,'');assert(hidden.result.failure?.includes('未解析'));assert(!JSON.stringify(hidden.events).includes('DSML'));assert(hidden.result.completionTokens>50);pass('原始 DSML 分段正文与思考均不泄漏、不执行；错误不冒充成功，缺省用量含隐藏输出')
 assert(!needsAutomaticKnowledge('请调用 calculator 数学计算工具计算 (12345*6789)+9876'));assert(!needsAutomaticKnowledge('将刚才的计算结果除以 3'));assert(!needsAutomaticKnowledge('(123+456)/3'))
 for(const q of ['学校有几个超市','计算奖学金申请的课程成绩','学费补贴如何计算','学生社团有几个','请计算知识库中条目的数量','计算机专业介绍','计算2026年研究生津贴的条件'])assert(needsAutomaticKnowledge(q))
 pass('纯计算跳过自动校园检索；校园事务、分类资料与显式知识查询保留证据能力')
 const once=new KnowledgeRetrievalBudget(8,false);assert.equal(once.limit,1);once.reserve();assert(!once.available());assert.throws(()=>once.reserve());assert.equal(once.count,1)
 const depth=new KnowledgeRetrievalBudget(2,true);depth.reserve();depth.reserve();assert.throws(()=>depth.reserve());assert.equal(depth.count,2);assert.equal(new KnowledgeRetrievalBudget(99,true).limit,3)
 assert.equal(SETTING_MAP.get('knowledge_retrieval_depth')?.defaultValue,3)
 let persisted=0;const configStore={setting:{upsert:()=>{persisted++;return Promise.resolve({})},findMany:async()=>[]},$transaction:async(items:any[])=>Promise.all(items)},config=new SettingsService(configStore as any,{log:async()=>{}} as any)
 for(const invalid of [0,9,1.5,'2',null])await assert.rejects(()=>config.updateMany({knowledge_retrieval_depth:invalid}));assert.equal(persisted,0)
 await config.updateMany({knowledge_retrieval_depth:2,knowledge_continuous_retrieval:false});assert.equal(persisted,2)
 let searches=0,calculations=0;const limited=new KnowledgeRetrievalBudget(1,false)
 const limitedResult=await run(fakeProvider(async function*(options,round){if(round===1){assert(options.tools?.some(t=>t.name==='lookup'));for(const id of ['query1','query2'])yield {type:'tool_call',call:{id,name:'lookup',arguments:'{"q":"资料"}'}}}else if(round===2){assert(!options.tools?.some(t=>t.name==='lookup'));assert(options.tools?.some(t=>t.name==='calculator'));yield {type:'tool_call',call:{id:'math',name:'calculator',arguments:'{"q":"123"}'}}}else{yield {type:'text',text:'根据已获取的证据回答。'}}yield {type:'done'}}),[{...lookup,available:limited.available,execute:async()=>{limited.reserve();searches++;await sleep(3);return '授权证据'}},{...lookup,name:'calculator',execute:async()=>{calculations++;return '123'}}])
 assert.equal(searches,1);assert.equal(calculations,1);assert.equal(limited.count,1);assert.equal(limitedResult.result.failure,undefined)
 pass('管理员检索次数/连续开关、整数边界、动态撤下检索工具、并发查询不超支，其他工具可继续')
 assert.throws(()=>parseToolArguments(lookup,'{"q":23}'));assert.throws(()=>parseToolArguments(lookup,'{"q":"","count":0}'));assert.throws(()=>parseToolArguments(lookup,'{"q":"ok","extra":true}'));assert.throws(()=>parseToolArguments(lookup,'{"q":'))
 assert.deepEqual(parseToolArguments(lookup,'{"q":"校园卡","count":2}'),{q:'校园卡',count:2});pass('工具参数完整 JSON/类型/必填/边界校验，错误参数不被转换成 raw 执行')
 let invoked=0,active=0,peak=0
 const readonly={...lookup,execute:async(args:any)=>{invoked++;peak=Math.max(peak,++active);await sleep(args.q==='a'?15:2);active--;return args.q}}
 const cached=await run(fakeProvider(async function*(options,round){if(round===1){yield {type:'tool_call',call:{id:'one',name:'lookup',arguments:'{"q":"a","count":2}'}};yield {type:'tool_call',call:{id:'two',name:'lookup',arguments:'{"count":2,"q":"a"}'}};yield {type:'tool_call',call:{id:'three',name:'lookup',arguments:'{"q":"b"}'}}}else{assert.deepEqual(options.messages.filter(m=>m.role==='tool').map(m=>m.toolCallId),['one','two','three']);yield {type:'text',text:'依据结果回答'}}yield {type:'usage',usage:{promptTokens:100,completionTokens:20,totalTokens:120}};yield {type:'done',finishReason:'stop'}}),[readonly])
 assert.equal(invoked,2);assert.equal(peak,2);assert.equal(cached.result.metrics.cachedCalls,1);assert.deepEqual(cached.result.tools.map(t=>t.id),['one','two','three']);assert.equal(cached.result.promptTokens,200);assert.equal(cached.result.text,'依据结果回答');pass('只读并行、等价参数去重、按原顺序回传工具结果与逐轮累计用量')
 const ordered:string[]=[]
 await run(fakeProvider(async function*(_,round){if(round===1)for(const id of ['a','b'])yield {type:'tool_call',call:{id,name:'write',arguments:'{"q":"'+id+'"}'}};yield {type:'done'}}),[{...lookup,name:'write',readOnly:false,execute:async args=>{ordered.push('start'+args.q);await sleep(2);ordered.push('end'+args.q);return 'ok'}}])
 assert.deepEqual(ordered,['starta','enda','startb','endb']);pass('有副作用及未分类工具保持串行，不复用写入操作')
 let allowed=0
 const invalid=await run(fakeProvider(async function*(options,round){if(round===1){yield {type:'tool_call',call:{id:'bad',name:'lookup',arguments:'{"q":2}'}};yield {type:'tool_call',call:{id:'unauthorized',name:'hidden_tool',arguments:'{}'}}}else{assert(options.messages.filter(m=>m.role==='tool').every(m=>m.content.includes('失败')));yield {type:'text',text:'参数有误，重新确认'}}yield {type:'done'}}),[{...lookup,execute:async()=>{allowed++;return 'ok'}}])
 assert.equal(allowed,0);assert.equal(invalid.result.metrics.failedTools,2);assert.equal(invalid.events.filter(e=>e.event==='tool_start').length,2);pass('未知/未授权和无效参数工具不执行，失败显式回传给模型与界面')
 const final=await run(fakeProvider(async function*(options,round){if(round===1)yield {type:'tool_call',call:{id:'last-tool',name:'lookup',arguments:'{"q":"结果"}'}};else{assert.equal(options.tools,undefined);assert(options.messages.some(m=>m.role==='tool'));yield {type:'text',text:'最后总结'}}yield {type:'done'}}),[lookup],{maxToolRounds:1})
 assert.equal(final.result.text,'最后总结');assert.equal(final.result.metrics.modelTurns,2);assert(final.result.metrics.limitReached);pass('工具预算到达后仍保留一次禁用工具的总结机会')
 const controller=new AbortController();let entered=()=>{};const enteredTool=new Promise<void>(r=>{entered=r})
 const canceled=run(fakeProvider(async function*(){yield {type:'text',text:'已生成部分'};yield {type:'tool_call',call:{id:'cancel',name:'lookup',arguments:'{"q":"cancel"}'}};yield {type:'done'}}),[{...lookup,execute:async(_,signal)=>{entered();await sleep(30);checkAbort(signal);return '不能返回'}}],{signal:controller.signal})
 await enteredTool;controller.abort();const stopped=await canceled
 assert(stopped.result.aborted);assert.equal(stopped.result.text,'');assert.equal(stopped.result.tools[0].status,'ABORTED');assert.equal(stopped.result.metrics.modelTurns,1);pass('停止覆盖工具等待和后续模型轮次，工具前计划不成为回答并标记 ABORTED')
 const hanging=new AbortController();const hangingRun=run(fakeProvider(async function*(){await new Promise(()=>{});yield {type:'done'}}),[],{signal:hanging.signal});await sleep(2);hanging.abort();assert((await hangingRun).result.aborted)
 const broken=await run(fakeProvider(async function*(){yield {type:'text',text:'断流内容'}}),[]);assert(broken.result.failure?.includes('提前中断'));pass('忽略信号的模型流仍可结束等待，异常断流不冒充成功或用户停止')
 let executed=false
 const hooks=await run(fakeProvider(async function*(_,round){if(round===1)yield {type:'tool_call',call:{id:'blocked',name:'lookup',arguments:'{"q":"blocked"}'}};yield {type:'done'}}),[{...lookup,execute:async()=>{executed=true;return 'ok'}}],{hooks:{beforeTool:async()=>{throw new Error('应用策略阻止执行')}}})
 assert(!executed);assert.equal(hooks.result.metrics.failedTools,1);pass('可信扩展钩子可在执行前拦截，拦截后不触发实际操作')
 const transcript:ChatMessage[]=[{role:'user',content:'上一轮'},{role:'assistant',content:'查看',toolCalls:[{id:'call-1',name:'lookup',arguments:'{"q":"a"}'}]},{role:'tool',toolCallId:'call-1',name:'lookup',content:'{"answer":"结果"}'},{role:'assistant',content:'依据结果回答'},{role:'user',content:'继续追问'}]
 const anth=anthropicMessages(transcript),gem=googleContents(transcript)
 assert(anth[1].content.some(p=>p.type==='tool_use'&&p.id==='call-1'));assert(anth[2].content.some(p=>p.type==='tool_result'&&p.tool_use_id==='call-1'));assert(gem[1].parts.some(p=>p.functionCall?.name==='lookup'));assert.equal(gem[2].parts[0].functionResponse.response.answer,'结果');pass('Claude tool_use/tool_result 与 Gemini functionCall/functionResponse 完整转换')
 const fitted=fitContext([{role:'system',content:'规则'},...transcript.slice(0,4).map(m=>({...m,content:m.content.repeat(1200)})),{role:'user',content:'当前问题'}],[lookup],900,200)
 assert.equal(fitted.messages.at(-1)?.content,'当前问题');assert(!fitted.messages.some(m=>m.role==='tool'));assert.equal(fitted.budget.removedTurns,1);assert.throws(()=>fitContext([{role:'system',content:'规则'},{role:'user',content:'图片',images:['data:image/png;base64,AA==']}],[],1000,256));pass('按完整问答轮次裁剪，工具协议不残缺；图片和工具定义纳入输入预算')
}

async function database(){
 for(const line of readFileSync(resolve(root,'.env'),'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2]}
 assert(['localhost','127.0.0.1'].includes(new URL(process.env.DATABASE_URL!).hostname),'禁止对生产数据库运行 fixture 检查')
 const privateDirectory=await mkdtemp(resolve(root,'.tmp/chat-checkpoint-')),originalCwd=process.cwd();process.chdir(privateDirectory);const checkpoints=new RuntimeCheckpointService();process.chdir(originalCwd);const snapshots:RuntimeState[]=[];const originalSave=checkpoints.save.bind(checkpoints);checkpoints.save=async state=>{snapshots.push(state);return originalSave(state)};const prisma=new PrismaService(),stamp=Date.now().toString(36);let userId='',agentId='',providerId='',skillId=''
 try{
  const user=await prisma.user.create({data:{email:`runtime-${stamp}@example.invalid`,name:'运行循环验证',passwordHash:'disabled-fixture'}});userId=user.id
  const conv=await prisma.conversation.create({data:{userId,title:'并发验证'}})
  const raced=await Promise.allSettled([reserveTurn(prisma,{conversationId:conv.id,userId,content:'first'}),reserveTurn(prisma,{conversationId:conv.id,userId,content:'second'})])
  assert.equal(raced.filter(r=>r.status==='fulfilled').length,1);assert.equal(await prisma.message.count({where:{conversationId:conv.id}}),2);assert.equal((await prisma.conversation.findUnique({where:{id:conv.id}}))?.messageCount,2)
  await prisma.message.updateMany({where:{conversationId:conv.id,status:'STREAMING'},data:{status:'SUCCESS'}})
  const again=await reserveTurn(prisma,{conversationId:conv.id,userId,content:'next'});assert.equal(again.user.seq,3)
  await prisma.message.update({where:{id:again.assistant.id},data:{createdAt:new Date(Date.now()-11*60_000)}})
  await reserveTurn(prisma,{conversationId:conv.id,userId,content:'recover'});assert.equal((await prisma.message.findUnique({where:{id:again.assistant.id}}))?.status,'ABORTED');pass('实际 PostgreSQL 并发消息预留互斥、完整计数及过期生成恢复')
  const prompt=await prisma.skill.create({data:{key:'runtime-prompt-'+stamp,name:'写作流程',description:'写作总结',type:'PROMPT',systemPrompt:'先核对资料，再进行写作。'}});skillId=prompt.id
  const audit=new AuditService(prisma),quota={assertWithinQuota:async()=>{},recordUsage:async()=>{}},skills=new SkillsEngineService(prisma,audit,quota as any,{} as any,{} as any,{} as any,{} as any)
  const catalog=await skills.promptCatalog([skillId],[],'写作总结');assert.equal(catalog[0].key,prompt.key);assert(!('systemPrompt' in catalog[0]));assert((await skills.readPromptSkill(prompt.key,[prompt.key],[])).includes(prompt.systemPrompt!));await assert.rejects(()=>skills.readPromptSkill(prompt.key,[],[]));pass('真实技能目录只暴露描述，按需加载工作流程并重新校验授权')
  const provider=await prisma.provider.create({data:{key:'runtime-'+stamp,name:'隔离验证',type:'OPENAI_COMPATIBLE'}});providerId=provider.id
  const model=await prisma.model.create({data:{key:'runtime-model',name:'隔离模型',providerId,contextWindow:12000,maxOutputTokens:512,supportsTools:true}})
  const agent=await prisma.agent.create({data:{key:'runtime-agent-'+stamp,name:'运行验证',systemPrompt:'遵循已授权的技能指引。',ownerId:userId,visibility:'PRIVATE',modelId:model.id,mode:'AGENT'}});agentId=agent.id
  await prisma.agentSkill.create({data:{agentId,skillId}})
  const store=new KnowledgeStoreService(prisma,audit),guide=new CampusGuideService(prisma,store),builder=new ContextBuilderService(prisma)
  const fake=fakeProvider(async function*(options,round){if(round%2===1){yield {type:'text',text:"I'll look up the information for you."};assert(options.tools?.some(t=>t.name==='skill_read'));assert(!options.messages[0].content.includes(prompt.systemPrompt!));yield {type:'tool_call',call:{id:'read-prompt',name:'skill_read',arguments:JSON.stringify({name:prompt.key})}}}else{assert(options.messages.some(m=>m.role==='tool'&&m.content.includes(prompt.systemPrompt!)));assert(options.messages[0].content.includes('Agent UI v0.1'));yield {type:'text',text:'```card\n'+JSON.stringify({type:'page',version:'0.1',id:'verified_ui',layout:'stack',fallback:'已依照指引完成回答。',children:[{type:'text',id:'conclusion',content:'已依照指引完成回答。'}]})+'\n```'}}yield {type:'usage',usage:{promptTokens:100,completionTokens:20,totalTokens:120}};yield {type:'done',finishReason:'stop'}})
  const chat=new ChatService(store,prisma,quota as any,audit,{resolveCredentials:async()=>({apiKey:'not-a-real-key',baseUrl:null,keyId:null}),reportKeySuccess:async()=>{},reportKeyFailure:async()=>{}} as any,{} as any,{get:async(key:string)=>key==='enable_tools'?true:undefined} as any,skills,{} as any,{} as any,{resolve:()=>fake} as any,builder,{buildLearningPrompt:async()=>null} as any,{buildMemoryPrompt:async()=>null} as any,guide,undefined,undefined,checkpoints)
  class Response extends EventEmitter{headersSent=true;writableEnded=false;destroyed=false;httpStatus=200;body:any;setHeader(){};flushHeaders(){};status(code:number){this.httpStatus=code;return this};json(data:any){this.body=data;return this};frames:string[]=[];write(s:string){this.frames.push(s);return true};end(){this.writableEnded=true}}
  const existing=await prisma.conversation.create({data:{userId,title:'已有空会话，切换智能体'}})
  const response=new Response();await chat.streamChat({id:userId,email:user.email,permissions:[]} as any,{conversationId:existing.id,content:'请按写作流程总结',agentId,modelId:model.id,memoryEnabled:false},response as any)
  assert(response.frames.join('').includes('"status":"SUCCESS"'))
  const assistant=await prisma.message.findFirst({where:{userId,modelId:model.id,role:'assistant'},orderBy:{createdAt:'desc'}});assert(assistant);const attachments=assistant.attachments as any
  assert(!assistant.content.includes("I'll"));assert.equal(attachments.presentation.version,'0.1');assert.equal(attachments.presentation.documents.length,1);assert(attachments.presentation.documents[0].ok);assert.deepEqual(attachments.presentation.components,['text']);assert.equal(attachments.agentRun.modelTurns,2);assert.equal(attachments.modelMessages.filter((m:any)=>m.role==='tool').length,1)
  assert(snapshots.length>4);const persisted=snapshots.at(-1)!;assert.equal(persisted.runId,assistant.id);assert.equal((await checkpoints.load(persisted.runId,persisted.scopeKey))?.node,'end');assert(attachments.agentRun.checkpointWrites>4);assert(!JSON.stringify(snapshots).includes('not-a-real-key'));const history=await builder.loadHistory(assistant.conversationId);assert(history.some(m=>m.toolCallId==='read-prompt'));assert.equal(assistant.totalTokens,240)
  const regen=new Response();await chat.regenerate({id:userId,email:user.email,permissions:[]} as any,{conversationId:assistant.conversationId,messageId:assistant.id},regen as any);assert(regen.frames.join('').includes('"status":"SUCCESS"'),regen.frames.filter(frame=>frame.includes('event: error')).join(''));assert(await prisma.message.findUnique({where:{id:assistant.id}}));assert.equal(await prisma.message.count({where:{conversationId:assistant.conversationId}}),2);assert.equal(((await prisma.message.findUnique({where:{id:assistant.id}}))!.attachments as any).answerVersions.length,1)
  const conversationService=new ConversationsService(prisma,audit),owner={id:userId,email:user.email,permissions:[]} as any;const versionList=await conversationService.answerVersions(assistant.conversationId,assistant.id,userId);assert.equal(versionList.items.length,2);await conversationService.selectAnswerVersion(assistant.conversationId,assistant.id,userId,0);assert.equal((await conversationService.answerVersions(assistant.conversationId,assistant.id,userId)).selected,0);await conversationService.selectAnswerVersion(assistant.conversationId,assistant.id,userId,1);await assert.rejects(()=>conversationService.answerVersions(assistant.conversationId,assistant.id,'other-owner'));await assert.rejects(()=>conversationService.selectAnswerVersion(assistant.conversationId,assistant.id,userId,99));assert.equal(await prisma.message.count({where:{conversationId:assistant.conversationId}}),2)
  pass('真实 ChatService 接入按需技能、持久化运行指标/工具上下文、历史回放、实际私有节点检查点及重新生成保留原回复')
  const unsafe=await prisma.skill.create({data:{key:'unsafe-evaluation-'+stamp,name:'写入测试',description:'不得用于批量测试',type:'HTTP',config:{url:'https://example.invalid/write',method:'POST'}}})
  const originalMemory=(chat as any).memory,originalResolve=(chat as any).llmFactory.resolve;let evaluationMemoryReads=0
  try{
   await prisma.agentSkill.create({data:{agentId,skillId:unsafe.id}})
   ;(chat as any).memory={buildMemoryPrompt:async()=>{evaluationMemoryReads++;return 'PRIVATE_MEMORY'},upsert:async()=>{throw new Error('evaluation must not write memory')}}
   ;(chat as any).llmFactory.resolve=()=>fakeProvider(async function*(options){assert(!options.tools?.some(t=>t.name===unsafe.key));assert(!JSON.stringify(options.messages).includes('PRIVATE_MEMORY'));yield {type:'text',text:'隔离测试完成。'};yield {type:'done'}})
   const evaluated=new Response();await chat.streamChat(owner,{content:'测试用中性问题',agentId,modelId:model.id,memoryEnabled:true},evaluated as any,undefined,{evaluation:true,signal:new AbortController().signal})
   assert(evaluated.frames.join('').includes('"status":"SUCCESS"'),evaluated.frames.join(''));assert.equal(evaluationMemoryReads,0)
   pass('真实 ChatService 批量执行强制隔离记忆，不向模型暴露有写入副作用的工具')
  }finally{(chat as any).memory=originalMemory;(chat as any).llmFactory.resolve=originalResolve;await prisma.skill.delete({where:{id:unsafe.id}})}
  const originalCatalog=guide.catalogBlock,originalEvidence=guide.answerEvidence,originalRules=store.keywordRules,originalFixed=store.fixed
  try{
   let deny=false,generations=0,reviews=0,recordedTokens=0
   guide.catalogBlock=async options=>{assert.deepEqual(options?.sourceKeys,EVALUATION_V2_SOURCES);return '只含两库的目录'}
   guide.answerEvidence=async(_q,_m,_l,options)=>{assert.deepEqual(options?.sourceKeys,EVALUATION_V2_SOURCES);return {text:'办理校园卡携带学生证原件。',sources:[{id:'scope-only',title:'校园卡窗口',collection:'campus-v2-contest',source:'2.0模拟资料',summary:'办理校园卡携带学生证原件。',used:true}],guidance:{}} as any}
   store.keywordRules=async()=>{throw Error('受限评测不允许关键词规则')};store.fixed=async()=>{throw Error('受限评测不允许外挂固定回答')}
   const strictProvider={type:'OPENAI_COMPATIBLE',async*stream(options:any){
    if(options.messages[0].content.includes('独立输出审查器')){reviews++;const input=JSON.parse(options.messages[1].content);assert(input.evidence.includes('学生证'));assert(!options.tools);yield {type:'text',text:JSON.stringify({campusGuide:true,neutral:!deny,safe:true,grounded:true})};yield {type:'usage',usage:{promptTokens:30,completionTokens:5,totalTokens:35}}}
    else{generations++;assert((options.tools||[]).every((t:any)=>t.name==='knowledge_search'));yield {type:'reasoning',text:'PRIVATE_STRICT_REASONING'};yield {type:'text',text:'```card\n'+JSON.stringify({type:'page',children:[{type:'text',content:deny?'待拦截的负面评价':'办理校园卡请携带学生证原件。'}]})+'\n```'};yield {type:'usage',usage:{promptTokens:100,completionTokens:20,totalTokens:120}}}
    yield {type:'done',finishReason:'stop'}
   }} as any
   const strictChat=new ChatService(store,prisma,{assertWithinQuota:async()=>{},recordUsage:async(u:any)=>recordedTokens+=u.promptTokens+u.completionTokens} as any,audit,{resolveCredentials:async()=>({apiKey:'fake'}),reportKeySuccess:async()=>{}} as any,{} as any,{get:async(key:string)=>key==='enable_tools'?true:undefined} as any,skills,{} as any,{} as any,{resolve:()=>strictProvider} as any,builder,{buildLearningPrompt:async()=>{throw Error('受限模式不读学习条目')}} as any,{buildMemoryPrompt:async()=>{throw Error('评测不读记忆')}} as any,guide)
   for(const rejected of [false,true]){
    deny=rejected;const output=new Response();await strictChat.streamChat({id:userId,email:user.email,permissions:['campus:read']} as any,{content:'校园卡怎么办',agentId,modelId:model.id,memoryEnabled:false},output as any,undefined,{evaluation:true,evaluationPolicy:{strictMode:true,knowledgeScope:'v2-only'}})
    const frames=output.frames.join('');assert(frames.includes('"status":"SUCCESS"'),frames)
    assert(!frames.includes('```card')&&!frames.includes('PRIVATE_STRICT_REASONING')&&!frames.includes('待拦截的负面评价'))
    const answer=await prisma.message.findFirst({where:{userId,role:'assistant'},orderBy:{createdAt:'desc'}});assert(answer);assert.equal(answer.totalTokens,155);assert.equal(answer.reasoning,null);assert(!(answer.attachments as any).modelMessages)
    assert.equal(answer.content,rejected?STRICT_FALLBACK:'办理校园卡请携带学生证原件。');assert(frames.includes(answer.content))
   }
   assert.equal(generations,2);assert.equal(reviews,2);assert.equal(recordedTokens,310)
   pass('严格两库真实 ChatService：原始卡片/推理/被拒内容不进入流或持久化，独立审核通过/拒绝及双调用155 token记账')
  }finally{guide.catalogBlock=originalCatalog;guide.answerEvidence=originalEvidence;store.keywordRules=originalRules;store.fixed=originalFixed}
  const guideSkill=await prisma.skill.create({data:{key:'source-guide-'+stamp,name:'来源传递验证',description:'导览查询',type:'TOOL',config:{builtin:'campus_guide'}}})
  const originalSearch=guide.search,originalRender=guide.renderAnswer
  try{
   await prisma.agentSkill.create({data:{agentId,skillId:guideSkill.id}})
   const hit={id:'verified_tool_source',externalId:123456,title:'导览材料',summaryShort:'学生证原件',url:'',cat:'事务',source:'授权导览夹具',related:[]}
   guide.search=async()=>({mode:'guide',query:'导览材料',hits:[hit],meta:{resolvedQuery:'导览材料',verifiedAt:'fixture'}} as any)
   guide.renderAnswer=()=> '[123456] 导览材料\n学生证原件'
   const sourceProvider=fakeProvider(async function*(_,round){if(round===1)yield {type:'text',text:'<｜DSML｜function_calls><｜DSML｜invoke name="knowledge_search">无效协议</｜DSML｜invoke></｜DSML｜function_calls>'};else if(round===2)yield {type:'tool_call',call:{id:'guide-read',name:guideSkill.key,arguments:'{"query":"导览材料"}'}};else yield {type:'text',text:'```card\n'+JSON.stringify({type:'page',id:'tool_evidence',version:'0.1',layout:'stack',fallback:'携带学生证原件。',children:[{type:'checklist',id:'materials',title:'准备材料',sourceRefs:['123456'],items:[{title:'学生证',desc:'原件'}]}]})+'\n```'};yield {type:'usage',usage:{promptTokens:100,completionTokens:20,totalTokens:120}};yield {type:'done'}})
   const sourceSkills=new SkillsEngineService(prisma,audit,quota as any,{} as any,{} as any,{} as any,guide)
   const sourceChat=new ChatService(store,prisma,quota as any,audit,{resolveCredentials:async()=>({apiKey:'not-a-real-key'}),reportKeySuccess:async()=>{}} as any,{} as any,{get:async(key:string)=>key==='enable_tools'?true:undefined} as any,sourceSkills,{} as any,{} as any,{resolve:()=>sourceProvider} as any,builder,{buildLearningPrompt:async()=>null} as any,{buildMemoryPrompt:async()=>null} as any,guide)
   const output=new Response();await sourceChat.streamChat({id:userId,email:user.email,permissions:[]} as any,{content:'导览查询验证',agentId,modelId:model.id,memoryEnabled:false},output as any)
   const frames=output.frames.join('');assert(frames.includes('"status":"SUCCESS"'),frames);assert(frames.indexOf('event: kb')<frames.indexOf('event: text'),frames)
   const answer=await prisma.message.findFirst({where:{userId,role:'assistant'},orderBy:{createdAt:'desc'}});assert(answer);const metadata=answer.attachments as any
   assert.equal(metadata.presentation.rendered,'page');assert.equal(metadata.presentation.fallbackApplied,false);assert.equal(metadata.knowledgeSources[0].id,hit.id);assert.equal(metadata.knowledgeSources[0].citationId,'123456');assert.equal(metadata.knowledgeSources[0].used,true);assert(answer.content.includes('```card'))
   assert.equal(metadata.agentRun.automaticRetries,1);assert.equal(metadata.agentRun.modelTurns,3);assert.equal(answer.totalTokens,360);assert.equal(await prisma.message.count({where:{conversationId:answer.conversationId}}),2);assert(!frames.includes('event: error'));assert(frames.includes('"stage":"retrying"'))
   pass('真实 ChatService 同消息自动纠正工具协议、保留来源并渲染卡片、三次调用累计360 token，无重复消息或错误事件')
   pass('真实导览技能来源经回调进入 ChatService 授权池与 SSE，工具独有来源不再误拒卡片')
  }finally{guide.search=originalSearch;guide.renderAnswer=originalRender;await prisma.skill.delete({where:{id:guideSkill.id}})}
  const directory=await mkdtemp(resolve(root,'.tmp/cache-service-')),cwd=process.cwd();process.chdir(directory)
  const cacheSettings={get:async(key:string)=>key==='answer_cache_enabled'?true:key==='answer_cache_days'?3:key==='enable_tools'?false:undefined},answerCache=new ResponseCacheService(prisma,cacheSettings as any);process.chdir(cwd)
  try{
   const testBase=await prisma.knowledgeBase.create({data:{name:'cache-counter-fixture-'+userId,kind:'LOCAL',mounted:true}})
   try{const counterEntry=await prisma.knowledgeEntry.create({data:{baseId:testBase.id,title:'计数夹具',question:'cache-counter-'+userId,questionKey:'cache-counter-'+userId,answer:'固定答案',mode:'FIXED',status:'APPROVED'}}),context={user:userId,question:'缓存版本夹具'},before=await answerCache.prepare(context)
    await store.fixed(counterEntry.question,null,true);assert.equal((await answerCache.prepare(context))?.key,before?.key)
    const restricted=await answerCache.prepare({...context,evaluationPolicy:{strictMode:true,knowledgeScope:'v2-only',version:'evaluation-v1'}}),twoOnly=await answerCache.prepare({...context,evaluationPolicy:{strictMode:false,knowledgeScope:'v2-only',version:'evaluation-v1'}})
    assert.notEqual(restricted?.key,before?.key);assert.notEqual(restricted?.key,twoOnly?.key);assert.notEqual(twoOnly?.key,before?.key)
    await store.bump();assert.notEqual((await answerCache.prepare(context))?.key,before?.key)
    pass('真实固定回答命中计数不破坏缓存，资料内容修订仍失效')
   }finally{await prisma.knowledgeEntry.deleteMany({where:{baseId:testBase.id}});await prisma.knowledgeBase.delete({where:{id:testBase.id}})}
   let modelCalls=0,credentials=0,checkOriginal=false,invalidBody=false;const provider=fakeProvider(async function*(options){modelCalls++;assert(options.messages[0]?.content.includes('【当前时间】'));assert(!options.messages[0]?.content.startsWith('【当前时间】'));if(checkOriginal){assert.equal(options.messages.at(-1)?.content,'解释成语学而不厌');assert(!options.messages.some(m=>m.content.includes('解释另一种学习态度')))}const answer=invalidBody?'```card\n{"type":"page","children":[':'```card\n'+JSON.stringify({type:'page',children:[{type:'steps',title:'理解步骤',steps:[{title:'持续学习',desc:'学而不厌'}]},{type:'info_card',title:'态度',metrics:[{label:'材料',value:'学生证'}]}]})+'\n```';for(let i=0;i<answer.length;i+=7)yield {type:'text',text:answer.slice(i,i+7)};yield {type:'usage',usage:{promptTokens:100,completionTokens:20,totalTokens:120,promptCacheHitTokens:64,promptCacheMissTokens:36}};yield {type:'done'}})
   const cachedChat=new ChatService(store,prisma,quota as any,audit,{resolveCredentials:async()=>{credentials++;return {apiKey:'not-a-real-key',baseUrl:null,keyId:null}},reportKeySuccess:async()=>{},reportKeyFailure:async()=>{}} as any,{} as any,cacheSettings as any,skills,{} as any,{} as any,{resolve:()=>provider} as any,builder,{buildLearningPrompt:async()=>null} as any,{buildMemoryPrompt:async()=>null} as any,guide,undefined,answerCache)
   const session=await prisma.conversation.create({data:{userId,title:'缓存集成隔离'}}),dto={conversationId:session.id,content:'解释成语学而不厌',agentId,modelId:model.id,memoryEnabled:false,enableTools:false},me={id:userId,email:user.email,permissions:[]} as any
   for(let i=0;i<2;i++){const res=new Response();await cachedChat.streamChat(me,dto,res as any);assert(res.frames.join('').includes('"status":"SUCCESS"'));assert.equal(res.frames.join('').includes('event: cache'),i===1)}
   const firstGenerated=await prisma.message.findFirstOrThrow({where:{conversationId:session.id,role:'assistant'},orderBy:{seq:'asc'}});assert.deepEqual((firstGenerated.attachments as any).agentRun.providerCache,{reportedCalls:1,unreportedCalls:0,hitTokens:64,missTokens:36});
   assert.equal(modelCalls,1);assert.equal(credentials,1);const saved=await prisma.message.findFirst({where:{conversationId:session.id,role:'assistant'},orderBy:{seq:'desc'}});assert(saved);assert.equal(saved.finishReason,'cache_hit');assert.equal(saved.totalTokens,0);assert.equal((saved.attachments as any).agentRun.modelTurns,0)
   await cachedChat.streamChat(me,{...dto,content:'解释另一种学习态度'},new Response() as any);assert.equal(modelCalls,2)
   const afterTopic=new Response();await cachedChat.streamChat(me,dto,afterTopic as any);assert(afterTopic.frames.join('').includes('event: cache'));assert.equal(modelCalls,2)
   const newSession=await prisma.conversation.create({data:{userId,title:'新会话同题'}}),crossSession=new Response();await cachedChat.streamChat(me,{...dto,conversationId:newSession.id},crossSession as any);assert(crossSession.frames.join('').includes('event: cache'));assert.equal(modelCalls,2)
   checkOriginal=true;await cachedChat.regenerate(me,{conversationId:session.id,messageId:saved.id,outputPreference:'adaptive'},new Response() as any);assert.equal(modelCalls,3);checkOriginal=false;const countBefore=await prisma.message.count({where:{conversationId:session.id}});await conversationService.selectAnswerVersion(session.id,saved.id,userId,0);await conversationService.selectAnswerVersion(session.id,saved.id,userId,1);assert.equal(modelCalls,3);assert.equal(await prisma.message.count({where:{conversationId:session.id}}),countBefore)
   for(const pref of ['text','cards'] as const){const output=new Response();await cachedChat.streamChat(me,{...dto,outputPreference:pref},output as any);const frames=output.frames.join('').split('\n\n').map(f=>({event:/^event: (.+)$/m.exec(f)?.[1],data:JSON.parse(/^data: (.+)$/m.exec(f)?.[1]||'{}')})),text=frames.filter(f=>f.event==='text').map(f=>f.data.text).join(''),persisted=await prisma.message.findFirst({where:{conversationId:session.id,role:'assistant'},orderBy:{seq:'desc'}});assert.equal(text,persisted?.content);assert(text.includes('学生证'));assert(!text.includes('"type":"page"'));assert.equal(text.includes('```card'),pref==='cards')}
   assert.equal(modelCalls,5);invalidBody=true;for(let i=0;i<2;i++){const broken=new Response();await cachedChat.streamChat(me,{...dto,content:'隔离不完整布局验证'},broken as any);assert(broken.frames.join('').includes('"status":"FAILED"'));assert(!broken.frames.join('').includes('event: cache'))}assert.equal(modelCalls,7)
   invalidBody=false;const trial=new TrialService(cachedChat) as any;trial.prisma=prisma;trial.ensureTrialUser=async()=>userId;trial.authUser=async()=>me;trial.deepseekId=async()=>model.id;trial.guideId=async()=>agentId;const trialIp='fixture-'+userId,trialQuestion='体验隔离原问题-'+userId
   try{const initial=new Response();await trial.chatRound(trialIp,trialQuestion,undefined,initial,{outputPreference:'adaptive'});assert(initial.frames.join('').includes('"status":"SUCCESS"'));const question=await prisma.message.findFirst({where:{userId,role:'user',content:trialQuestion}});assert(question);const answer=await prisma.message.findFirst({where:{conversationId:question.conversationId,role:'assistant'}});assert(answer);const retry=new Response();await trial.chatRound(trialIp,trialQuestion,question.conversationId,retry,{revisionMessageId:answer.id,outputPreference:'adaptive'});assert(retry.frames.join('').includes('"status":"SUCCESS"'));assert.equal(await prisma.message.count({where:{conversationId:question.conversationId}}),2);assert.equal((await prisma.message.findUnique({where:{id:answer.id}}))?.attachments && ((await prisma.message.findUnique({where:{id:answer.id}}))!.attachments as any).answerVersions.length,1);assert.equal(await prisma.trialRound.count({where:{ip:trialIp}}),2);const stranger=new Response();await trial.chatRound(trialIp+'-other',trialQuestion,question.conversationId,stranger,{revisionMessageId:answer.id});assert.equal(stranger.httpStatus,400);const wrong=new Response();await trial.chatRound(trialIp,'不同问题',question.conversationId,wrong,{revisionMessageId:answer.id});assert.equal(wrong.httpStatus,400);assert.equal(await prisma.trialRound.count({where:{ip:trialIp}}),2)
   }finally{await prisma.trialRound.deleteMany({where:{ip:trialIp}})}
   pass('真实体验服务原消息再生成、IP与问题校验、无重复提问；未完整结构FAILED且不缓存')
   pass('真实 ChatService 同题跨历史/会话命中零 token，roll绕过；长历史模型仍返回page时文字/固定模板确定性转换，流式与落库一致')
  }finally{assert(directory.startsWith(resolve(root,'.tmp')+require('node:path').sep));await rm(directory,{recursive:true,force:true})}
 }finally{
  if(agentId)await prisma.agent.delete({where:{id:agentId}})
  if(skillId)await prisma.skill.delete({where:{id:skillId}})
  if(userId){await prisma.auditLog.deleteMany({where:{userId}});await prisma.user.delete({where:{id:userId}})}
  if(providerId)await prisma.provider.delete({where:{id:providerId}})
  await prisma.$disconnect();await rm(privateDirectory,{recursive:true,force:true})
 }
}
async function main(){await unit();await database();mkdirSync(resolve(root,'storage/shots/runtime'),{recursive:true});writeFileSync(resolve(root,'storage/shots/runtime/backend-verification.json'),JSON.stringify({checkedAt:new Date().toISOString(),checks,billing:'No external model calls; actual local PostgreSQL and mocked provider stream'},null,2))}
main().catch(error=>{console.error(error);process.exitCode=1})
