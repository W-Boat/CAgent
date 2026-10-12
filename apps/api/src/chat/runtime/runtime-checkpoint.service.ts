import {Injectable,Logger} from '@nestjs/common'
import {createHash,randomUUID} from 'node:crypto'
import {mkdir,open,readFile,writeFile,rename,unlink,readdir,stat} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {validRuntimeState,type RuntimeState} from './runtime-state'
/** Private local persistence behind the existing storage/.private HTTP deny rules. No provider credentials. */
@Injectable()
export class RuntimeCheckpointService {
 private readonly directory=resolve(process.cwd(),'storage','.private','agent-runs');private readonly logger=new Logger(RuntimeCheckpointService.name);private lastClean=0
 private filename(runId:string,scopeKey:string){if(!/^[a-zA-Z0-9_-]{1,120}$/.test(runId)||!/^[a-f0-9]{64}$/.test(scopeKey))throw new Error('Invalid checkpoint identity');return join(this.directory,createHash('sha256').update(scopeKey+':'+runId).digest('hex')+'.json')}
 async load(runId:string,scopeKey:string):Promise<RuntimeState|null>{try{const text=await readFile(this.filename(runId,scopeKey),'utf8');if(Buffer.byteLength(text)>512*1024)return null;const state=JSON.parse(text);return validRuntimeState(state)&&state.runId===runId&&state.scopeKey===scopeKey&&Date.now()-state.updatedAt<86400000&&state.updatedAt<=Date.now()?state:null}catch{return null}}
 async save(state:RuntimeState):Promise<boolean>{
  if(!validRuntimeState(state))throw new Error('Invalid runtime state')
  const filename=this.filename(state.runId,state.scopeKey),body=JSON.stringify(state);if(Buffer.byteLength(body)>512*1024)return false
  let temporary:string|undefined,lock:Awaited<ReturnType<typeof open>>|undefined
  try{await mkdir(this.directory,{recursive:true,mode:0o700});lock=await this.acquire(filename+'.lock');await lock.writeFile(JSON.stringify({pid:process.pid,createdAt:Date.now()}))
   const old=await this.load(state.runId,state.scopeKey);if((old?.sequence||0)!==state.sequence-1)throw new Error('任务检查点版本冲突，另一执行者可能已推进此任务。')
   temporary=filename+'.'+randomUUID()+'.tmp';await writeFile(temporary,body,{mode:0o600});await rename(temporary,filename);temporary=undefined;await this.clean();return true
  }catch(error){if((error as Error).message.includes('版本冲突')||(error as any).code==='EEXIST')throw new Error('任务检查点已被另一执行者锁定或更新，请勿并发恢复。');this.logger.warn('运行检查点未能持久保存，本次回答仍继续，恢复能力暂停。');return false}
  finally{if(temporary)await unlink(temporary).catch(()=>undefined);if(lock){await lock.close();await unlink(filename+'.lock').catch(()=>undefined)}}
 }
 private async acquire(filename:string){
  try{return await open(filename,'wx',0o600)}catch(error){
   if((error as any).code!=='EEXIST')throw error
   // Serialize stale-lock recovery; never remove a newly acquired live writer's lock.
   const recovery=await open(filename+'.recovery','wx',0o600)
   try{
    const info=JSON.parse(await readFile(filename,'utf8'))
    if(!Number.isSafeInteger(info.pid)||info.pid<=0||!Number.isFinite(info.createdAt)||Date.now()-info.createdAt<60000)throw error
    try{process.kill(info.pid,0);throw error}catch(probe){if((probe as any).code!=='ESRCH')throw error}
    await unlink(filename);return await open(filename,'wx',0o600)
   }finally{await recovery.close();await unlink(filename+'.recovery').catch(()=>undefined)}
  }
 }
 private async clean(){if(Date.now()-this.lastClean<60000)return;this.lastClean=Date.now();const files=await Promise.all((await readdir(this.directory)).filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).map(async name=>({name,mtime:(await stat(join(this.directory,name)).catch(()=>null))?.mtimeMs||0})));files.sort((a,b)=>b.mtime-a.mtime);for(const [i,file] of files.entries())if(i>=64||Date.now()-file.mtime>=86400000)await unlink(join(this.directory,file.name)).catch(()=>undefined)}
}
