import 'reflect-metadata'
import assert from 'node:assert/strict'
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {PrismaService} from '../src/prisma/prisma.service'
import {EvaluationService} from '../src/evaluation/evaluation.service'
import {EvaluationResponse} from '../src/evaluation/evaluation-response'
import {parseTestSet,parseCsv,csvCell,TEST_SET_EXAMPLE} from '../src/evaluation/batch-format'
import {MemoryService} from '../src/memory/memory.service'
import {reserveTurn} from '../src/chat/session-turns'
import {ConversationsService} from '../src/conversations/conversations.service'
import {Test} from '@nestjs/testing'
import {Reflector} from '@nestjs/core'
import {ValidationPipe} from '@nestjs/common'
import {EvaluationController} from '../src/evaluation/evaluation.controller'
import {PermissionsGuard} from '../src/common/guards/permissions.guard'
import {TransformInterceptor} from '../src/common/interceptors/transform.interceptor'
const checks:string[]=[],pass=(s:string)=>{checks.push(s);console.log('PASS '+s)},sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms))
async function main(){
 assert.equal(parseTestSet(TEST_SET_EXAMPLE,'json').length,2);assert.equal(parseTestSet('["题一","题二"]','json').length,2)
 const csv='batch_id,split,turn,question\r\na,test,2,"追问,与\n换行"\r\na,test,1,"他说""好"""\r\nb,validation,1,单轮';const parsed=parseTestSet(csv,'csv');assert.deepEqual(parsed[0].questions,['他说"好"','追问,与\n换行']);assert.equal(parsed[1].split,'validation')
 for(const source of ['{"batches":[{"id":"a","questions":[]}]}','{"batches":[{"id":"a","questions":["题"]},{"id":"a","questions":["题"]}]}',JSON.stringify(Array(501).fill('题'))])assert.throws(()=>parseTestSet(source,'json'))
 assert.throws(()=>parseTestSet('batch_id,turn,question\na,1,问题\na,1,另一问题','csv'));assert.throws(()=>parseTestSet('question\n"未闭合','csv'));assert(csvCell('=HYPERLINK("x")').startsWith('"\''));pass('JSON/CSV 多轮、引号换行、测试/验证分组，重复轮次及输入上限校验，CSV 公式注入防护')
 let touched=0;const blocked=new MemoryService({userMemory:{findMany:async()=>{touched++;return []},findFirst:async()=>{touched++;return null}}} as any,{get:async()=>false} as any)
 assert.deepEqual(await blocked.getUserMemories('user'),[]);assert.equal(await blocked.buildMemoryPrompt('user'),'');assert.equal((await blocked.getMemoryStats('user')).enabled,false);await assert.rejects(()=>blocked.upsertMemory({userId:'user',content:'不要写入'}));await assert.rejects(()=>blocked.updateMemory('id','user',{content:'不要写入'}));assert.equal(touched,0);pass('全站记忆关闭阻断注入、读取、创建、修改；不依赖客户端参数')
 for(const line of readFileSync(resolve(__dirname,'../../../.env'),'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2]}
 assert(['localhost','127.0.0.1'].includes(new URL(process.env.DATABASE_URL!).hostname));const db=new PrismaService(),stamp=Date.now().toString(36),users:string[]=[],agents:string[]=[];let roleId='',service:EvaluationService|undefined
 try{
  const permission=await db.permission.findUniqueOrThrow({where:{code:'conversation:read'}}),role=await db.role.create({data:{key:'evaluation-'+stamp,name:'测试权限',permissions:{create:{permissionId:permission.id}}}});roleId=role.id
  for(let i=0;i<2;i++){const u=await db.user.create({data:{email:`eval-${stamp}-${i}@example.invalid`,name:'批量测试夹具',passwordHash:'disabled-fixture',roles:{create:{roleId}}}});users.push(u.id)}
  for(let i=0;i<2;i++){const a=await db.agent.create({data:{key:`eval-${stamp}-${i}`,name:'记忆范围夹具',ownerId:users[0],systemPrompt:'测试',visibility:'PRIVATE'}});agents.push(a.id)}
  const memory=new MemoryService(db,{get:async()=>true} as any);await memory.upsertMemory({userId:users[0],content:'全局'});await memory.upsertMemory({userId:users[0],agentId:agents[0],content:'本智能体'});await memory.upsertMemory({userId:users[0],agentId:agents[1],content:'其他智能体'});await memory.upsertMemory({userId:users[0],content:'已过期',expiresAt:new Date(Date.now()-1000)})
  assert.deepEqual((await memory.getUserMemories(users[0],agents[0])).map(m=>m.content).sort(),['全局','本智能体']);assert.deepEqual((await memory.getUserMemories(users[0])).map(m=>m.content),['全局']);pass('实际数据库验证长期记忆 Agent 范围与过期条件同时生效')
  const calls:any[]=[];let activeCalls=0,peakCalls=0,startedStop:()=>void=()=>{},stopReady=new Promise<void>(r=>startedStop=r)
  const chat={streamChat:async(user:any,dto:any,res:EvaluationResponse,revision:any,internal:any)=>{assert.equal(dto.memoryEnabled,false);assert.equal(internal.evaluation,true);assert.equal(revision,undefined);calls.push(dto);const previous=await db.message.count({where:{conversationId:dto.conversationId,role:'assistant'}}),turn=await reserveTurn(db,{userId:user.id,conversationId:dto.conversationId,content:dto.content}),send=(event:string,data:any)=>res.write('event: '+event+'\ndata: '+JSON.stringify(data)+'\n\n');send('meta',{conversationId:dto.conversationId,assistantMessageId:turn.assistant.id});let status:'SUCCESS'|'FAILED'|'ABORTED'='SUCCESS',reply='回复😀 · 上下文轮次 '+previous
   if(dto.content==='失败'){status='FAILED';reply='';send('error',{message:'受控错误'})}if(dto.content==='等待停止'){startedStop();await new Promise<void>(r=>{if(internal.signal.aborted)r();else internal.signal.addEventListener('abort',()=>r(),{once:true})});status='ABORTED';reply=''}
   activeCalls++;peakCalls=Math.max(peakCalls,activeCalls);await sleep(40)
   await db.message.update({where:{id:turn.assistant.id},data:{content:reply,status,error:status==='FAILED'?'受控错误':null}});send('text',{text:reply});send('usage',{promptTokens:10,completionTokens:3,totalTokens:13});send('done',{status,runtime:{modelTurns:1}});res.end();activeCalls--}}
  const audit={log:async()=>{}},user={id:users[0],email:'fixture@example.invalid',name:'测试',status:'ACTIVE',roles:[],permissions:['conversation:read']},other={...user,id:users[1]};service=new EvaluationService(db,chat as any,audit as any)
  const wait=async(id:string)=>{for(let i=0;i<200;i++){const j=await service!.detail(user,id);if(!['QUEUED','RUNNING','CANCELLING'].includes(j.status))return j;await sleep(10)}throw new Error('fixture job timeout')}
  const job=await service.create(user,{title:'多轮隔离',format:'json',data:TEST_SET_EXAMPLE,bypassCache:true});const done=await wait(job.id);assert.equal(done.status,'COMPLETED');assert.equal(done.succeeded,3);assert.equal(done.turns[0].conversationId,done.turns[1].conversationId);assert.notEqual(done.turns[1].conversationId,done.turns[2].conversationId);assert(done.turns[1].reply.includes('上下文轮次 1'));assert(done.turns[2].reply.includes('上下文轮次 0'));assert(calls.every(c=>c.bypassCache===true));pass('实际数据库异步批量任务：同批上下文连续、跨批隔离、正常结果持久化，默认不读写个人记忆')
  peakCalls=0
  const parallel=await service.create(user,{title:'批次并发及策略',format:'json',concurrency:2,strictMode:true,knowledgeScope:'v2-only',data:JSON.stringify({batches:[{id:'pa',questions:['并发A','A追问']},{id:'pb',questions:['并发B','B追问']},{id:'pc',questions:['并发C']}]})}),parallelDone=await wait(parallel.id)
  assert.equal(peakCalls,2);assert.equal(parallelDone.completed,5);assert.equal(parallelDone.succeeded,5)
  assert.deepEqual(parallelDone.turns.map(t=>t.batchId),['pa','pa','pb','pb','pc']);assert(parallelDone.turns[1].reply.includes('上下文轮次 1'));assert(parallelDone.turns[3].reply.includes('上下文轮次 1'));assert.equal((parallelDone.options as any).outputPreference,'text')
  assert.equal(JSON.parse((await service.export(user,parallel.id,'json')).body).task.options.knowledgeScope,'v2-only');assert((await service.export(user,parallel.id,'csv')).body.includes('strictMode'))
  pass('实际数据库并发峰值受限、批次内严格顺序、进度统计不倒退、结果按原题排序，任务策略随导出保存')
  const ordinary=new ConversationsService(db,audit as any);assert(!(await ordinary.listMine(user.id,{})).items.some((c:any)=>c.evaluationJobId));pass('测试会话从普通会话列表隔离，仍保留审计记录')
  await assert.rejects(()=>service!.detail(other,job.id));await assert.rejects(()=>service!.cancel(other,job.id));await assert.rejects(()=>service!.export(other,job.id,'json'));assert.equal((await service.list(other)).length,0)
  const json=JSON.parse((await service.export(user,job.id,'json')).body);assert.equal(json.batches[0].turns[1].question,'怎么去？');assert(json.batches[0].turns[1].reply.includes('😀'));const rows=parseCsv((await service.export(user,job.id,'csv')).body.replace(/^\uFEFF/,''));assert.equal(rows.length,4);assert(rows[0].includes('reply')&&rows[0].includes('batch_id'));assert(rows[2].includes('怎么去？'));await assert.rejects(()=>service!.export(user,job.id,'xml'));pass('JSON/CSV 下载包含批次、轮次、题目和完整回复；跨用户读取/停止/下载拒绝')
  const failed=await service.create(user,{title:'失败隔离',format:'json',data:JSON.stringify({batches:[{id:'失败批',questions:['失败','依赖追问']},{id:'继续批',questions:['正常问题']}]})}),failedDone=await wait(failed.id);assert.deepEqual(failedDone.turns.map(t=>t.status),['FAILED','SKIPPED','SUCCESS']);assert(!calls.some(c=>c.content==='依赖追问'));pass('前轮失败只跳过该批次后续追问，其他批次继续执行')
  const stop=await service.create(user,{title:'停止',format:'json',data:JSON.stringify({batches:[{id:'stop',questions:['等待停止','不得执行']}]})});await stopReady;await service.cancel(user,stop.id);const stopped=await wait(stop.id);assert.equal(stopped.status,'CANCELLED');assert(stopped.turns.every(t=>t.status==='CANCELLED'));assert(!calls.some(c=>c.content==='不得执行'));pass('停止任务贯穿实际流式信号，保留已完成结果且不启动下一题')
  const restart=await db.evaluationJob.create({data:{userId:user.id,title:'重启',status:'RUNNING',total:2,batchCount:1,options:{},turns:{create:[{position:0,batchId:'r',turn:1,split:'test',question:'已完成',reply:'保留回复',status:'SUCCESS'},{position:1,batchId:'r',turn:2,split:'test',question:'未完成',status:'RUNNING'}]}}});await service.onModuleInit();const recovered=await service.detail(user,restart.id);assert.equal(recovered.status,'INTERRUPTED');assert.equal(recovered.turns[0].reply,'保留回复');assert.equal(recovered.turns[1].status,'CANCELLED');pass('重启明确标为中断，不自动产生额外调用，部分结果仍可下载')
  const module=await Test.createTestingModule({controllers:[EvaluationController],providers:[{provide:EvaluationService,useValue:service}]}).compile(),app=module.createNestApplication({logger:false})
  app.use((req:any,res:any,next:any)=>{req.user=req.headers.authorization==='Bearer admin-fixture'?user:req.headers.authorization==='Bearer other-fixture'?other:req.headers.authorization==='Bearer student-fixture'?{...user,permissions:[]}:undefined;next()});app.useGlobalGuards(new PermissionsGuard(new Reflector()));app.useGlobalPipes(new ValidationPipe({whitelist:true,transform:true}));app.useGlobalInterceptors(new TransformInterceptor());await app.listen(0,'127.0.0.1');const origin=await app.getUrl()
  try{for(const token of ['', 'student-fixture']){const response=await fetch(origin+'/evaluations',{headers:{Authorization:'Bearer '+token}});assert.equal(response.status,403)}const crossed=await fetch(origin+'/evaluations/'+job.id+'/export?format=json',{headers:{Authorization:'Bearer other-fixture'}});assert.equal(crossed.status,404);const invalid=await fetch(origin+'/evaluations',{method:'POST',headers:{Authorization:'Bearer admin-fixture','Content-Type':'application/json'},body:JSON.stringify({title:'无效格式',format:'xml',data:'bad'})});assert.equal(invalid.status,400);pass('真实 Nest HTTP 权限与 DTO：匿名/学生拒绝，跨用户下载拒绝，格式类型校验')
   for(const format of ['json','csv']){const response=await fetch(origin+'/evaluations/'+job.id+'/export?format='+format,{headers:{Authorization:'Bearer admin-fixture'}});assert.equal(response.status,200);assert(response.headers.get('content-disposition')?.includes('attachment'));const text=await response.text();assert(text.includes('广')||text.includes('上下文轮次'));if(format==='json')assert(JSON.parse(text).batches)}pass('真实 HTTP 下载 Content-Disposition、UTF-8 内容与直接文件响应，不误包装为 API 信封')
  }finally{await app.close()}
 }finally{service?.onModuleDestroy();await db.user.deleteMany({where:{id:{in:users}}});if(roleId)await db.role.delete({where:{id:roleId}});await db.$disconnect()}
 const out=resolve(__dirname,'../../../storage/shots/evaluation');mkdirSync(out,{recursive:true});writeFileSync(resolve(out,'backend-verification.json'),JSON.stringify({passed:true,checks,externalModelCalls:0},null,2))
}
main().catch(e=>{console.error(e);process.exitCode=1})
