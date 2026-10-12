import 'reflect-metadata'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,rm,readdir,stat} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {AgentRuntime,type RunOptions} from '../src/chat/runtime/agent-runtime'
import {RuntimeCheckpointService} from '../src/chat/runtime/runtime-checkpoint.service'
import {copyState,restoreRuntime,type RuntimeState} from '../src/chat/runtime/runtime-state'
const root=resolve(__dirname,'../../..'),scope='a'.repeat(64),checks:string[]=[]
const pass=(s:string)=>{checks.push(s);console.log('PASS '+s)}
function options(execute:()=>Promise<string>,provider:any,readOnly=true):RunOptions{return {messages:[{role:'system',content:'核实资料'},{role:'user',content:'查询'}],request:{model:'controlled',apiKey:'NEVER_SAVE_THIS_SECRET',maxTokens:200},contextWindow:4096,maxToolRounds:2,tools:[{name:'lookup',description:'查询',parameters:{type:'object',properties:{},additionalProperties:false},readOnly,execute}],provider,signal:new AbortController().signal,emit:()=>{}}}
const provider=(finish=false)=>({type:'OPENAI_COMPATIBLE',stream:async function*(o:any){if(finish){assert(o.messages.some((m:any)=>m.role==='tool'&&m.content==='已核实'));yield {type:'text',text:'恢复完成'}}else yield {type:'tool_call',call:{id:'lookup-1',name:'lookup',arguments:'{}'}};yield {type:'done',finishReason:'stop'}}})
async function child(directory:string,mode:string){process.chdir(directory);const service=new RuntimeCheckpointService();let invoked=0
 const opt=options(async()=>{invoked++;await writeFile(join(directory,'executions.txt'),String(invoked));return '已核实'},provider(mode==='resume'))
 const state=mode==='resume'?await service.load('crash-run',scope):undefined;assert(mode!=='resume'||state)
 opt.checkpoint={runId:'crash-run',scopeKey:scope,resume:state||undefined,save:async s=>{const ok=await service.save(s);if(mode==='crash'&&s.node==='tools'&&s.completed['lookup-1'])process.exit(79);return ok}}
 const result=await new AgentRuntime().run(opt);assert.equal(result.text,'恢复完成');assert.equal(result.failure,undefined);assert.equal(invoked,0);assert.equal(result.metrics.resumedFromCheckpoint,true);assert.equal(result.metrics.modelTurns,2);await writeFile(join(directory,'resumed.json'),JSON.stringify(result))
}
async function main(){const directory=await mkdtemp(resolve(root,'.tmp/runtime-checkpoints-')),cwd=process.cwd()
 try{
  const spawn=(mode:string)=>spawnSync(process.execPath,['-r','ts-node/register/transpile-only',__filename,'--worker',directory,mode],{cwd:resolve(root,'apps/api'),encoding:'utf8',timeout:60000})
  const killed=spawn('crash');assert.equal(killed.status,79,killed.stderr);assert.equal(await readFile(join(directory,'executions.txt'),'utf8'),'1')
  const recovered=spawn('resume');assert.equal(recovered.status,0,recovered.stderr);assert.equal(await readFile(join(directory,'executions.txt'),'utf8'),'1');pass('独立进程在工具完成后退出；新进程从磁盘恢复，不重复查询，保留协议与累计用量')
  process.chdir(directory);const service=new RuntimeCheckpointService(),saved=await service.load('crash-run',scope);assert(saved);assert.equal(saved.node,'end');assert.equal(await service.load('crash-run','b'.repeat(64)),null)
  const body=await readFile(join(directory,'storage/.private/agent-runs',(await readdir('storage/.private/agent-runs')).find(n=>n.endsWith('.json'))!),'utf8');assert(!body.includes('NEVER_SAVE_THIS_SECRET'));pass('检查点按所有者隔离，模型凭据不落盘；结束任务不能恢复')
  const opt=options(async()=>'',provider(true));const checkpoint={runId:saved.runId,scopeKey:scope,save:async()=>true,resume:copyState(saved)};assert.throws(()=>restoreRuntime(opt,checkpoint),/已结束/)
  checkpoint.resume.node='tools';checkpoint.resume.version=2 as any;assert.throws(()=>restoreRuntime(opt,checkpoint),/不一致/);checkpoint.resume.version=1
  assert.throws(()=>restoreRuntime({...opt,tools:opt.tools.map(t=>({...t,readOnly:false}))},checkpoint),/不一致/)
  checkpoint.resume.inFlight={write:{name:'lookup',readOnly:false}};assert.throws(()=>restoreRuntime(opt,checkpoint),/禁止自动重放/);checkpoint.resume.inFlight={};checkpoint.scopeKey='b'.repeat(64);assert.throws(()=>restoreRuntime(opt,checkpoint),/不一致/);pass('版本、工具权限及所有者变化拒绝恢复；未确认写操作阻止重放')
  let current:RuntimeState|undefined;const controller=new AbortController(),model={type:'OPENAI_COMPATIBLE',stream:async function*(){yield {type:'text',text:'未完成内容'};controller.abort();yield {type:'done'}}}
  const aborted=await new AgentRuntime().run({...options(async()=>'',model),signal:controller.signal,checkpoint:{runId:'partial',scopeKey:scope,save:async s=>{current=s;return true}}});assert(aborted.aborted);assert(current)
  const restored=restoreRuntime({...options(async()=>'',provider()),checkpoint:undefined},{runId:'partial',scopeKey:scope,save:async()=>true,resume:current});assert.equal(restored.result.text,'');pass('中断模型输出恢复到本轮起点，避免重复拼接半段答案')
  const race=copyState(saved);race.sequence++;race.node='context';const outcomes=await Promise.allSettled([service.save(copyState(race)),service.save(copyState(race))]);assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);assert.equal(outcomes.filter(o=>o.status==='rejected').length,1);pass('检查点锁与版本比较拒绝并发执行者覆盖')
  const lock=join(directory,'storage/.private/agent-runs',createHash('sha256').update(scope+':crash-run').digest('hex')+'.json.lock');await writeFile(lock,JSON.stringify({pid:2147483647,createdAt:Date.now()-120000}));race.sequence++;assert(await service.save(race));pass('确认已退出且锁超过一分钟的本机写者可恢复；不抢占仍运行的写者')
  const huge=copyState(race);huge.sequence++;huge.messages.push({role:'user',content:'x'.repeat(600000)});assert.equal(await service.save(huge),false);assert.equal((await service.load(race.runId,scope))?.sequence,race.sequence);pass('超大检查点受限且不覆盖已有状态')
  let writes=0,turn=0;const repeated={type:'OPENAI_COMPATIBLE',stream:async function*(){if(++turn===1)for(const id of ['a','b'])yield {type:'tool_call',call:{id,name:'lookup',arguments:'{}'}};else yield {type:'text',text:'完成'};yield {type:'done'}}}
  const writeResult=await new AgentRuntime().run(options(async()=>{writes++;return '已核实'},repeated,false));assert.equal(writes,1);assert.equal(writeResult.tools[1].status,'FAILED');pass('同一任务等价写入仅执行一次，后续重复调用返回明确错误')
  const shots=resolve(root,'storage/shots/runtime');await import('node:fs/promises').then(fs=>fs.mkdir(shots,{recursive:true}));await writeFile(join(shots,'checkpoint-verification.json'),JSON.stringify({passed:true,checkedAt:new Date().toISOString(),checks,scope:'Actual private filesystem and separate Node processes, controlled model streams; no paid model calls or production restart'},null,2))
 }finally{process.chdir(cwd);await rm(directory,{recursive:true,force:true})}
}
if(process.argv[2]==='--worker')child(process.argv[3],process.argv[4]).catch(e=>{console.error(e);process.exitCode=1});else main().catch(e=>{console.error(e);process.exitCode=1})
