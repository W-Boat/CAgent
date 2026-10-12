import {BadRequestException,ForbiddenException,Injectable,Logger,NotFoundException,OnModuleDestroy,OnModuleInit} from '@nestjs/common'
import {Interval} from '@nestjs/schedule'
import {PrismaService} from '../prisma/prisma.service'
import {ChatService} from '../chat/chat.service'
import type {AuthUser} from '../common/decorators/current-user.decorator'
import {visibleCapabilityWhere} from '../common/retired-capabilities'
import {AuditService} from '../common/services/audit.service'
import {parseTestSet,flattenTestSet,csvCell} from './batch-format'
import {CreateEvaluationDto} from './evaluation.dto'
import {EvaluationResponse} from './evaluation-response'

@Injectable()
export class EvaluationService implements OnModuleInit,OnModuleDestroy {
 private busy=false;private stopped=false;private active?:{id:string;controller:AbortController};private readonly logger=new Logger(EvaluationService.name)
 constructor(private readonly db:PrismaService,private readonly chat:ChatService,private readonly audit:AuditService){}
 async onModuleInit(){
  const interrupted=await this.db.evaluationJob.findMany({where:{status:{in:['QUEUED','RUNNING','CANCELLING']}},select:{id:true}})
  if(interrupted.length)await this.db.$transaction([
   this.db.evaluationJob.updateMany({where:{id:{in:interrupted.map(j=>j.id)}},data:{status:'INTERRUPTED',finishedAt:new Date(),error:'服务重启，任务已停止。已完成结果保留，可重新创建任务。'}}),
   this.db.evaluationTurn.updateMany({where:{jobId:{in:interrupted.map(j=>j.id)},status:{in:['PENDING','RUNNING']}},data:{status:'CANCELLED',error:'服务重启，未完成此题'}})
  ])
  for(const job of interrupted)await this.count(job.id)
 }
 onModuleDestroy(){this.stopped=true;this.active?.controller.abort()}
 @Interval(5000) tick(){void this.pump()}
 private scope(user:AuthUser){return user.permissions.includes('*')?{}:{userId:user.id}}
 private async owned(user:AuthUser,id:string){const job=await this.db.evaluationJob.findFirst({where:{id,...this.scope(user)}});if(!job)throw new NotFoundException('测试任务不存在');return job}
 async create(user:AuthUser,dto:CreateEvaluationDto){
  let batches;try{batches=parseTestSet(dto.data,dto.format,dto.split)}catch(e){throw new BadRequestException((e as Error).message)}
  if(!dto.title?.trim())throw new BadRequestException('请输入任务名称')
  if(dto.agentId&&!await this.db.agent.findFirst({where:{id:dto.agentId,enabled:true,...visibleCapabilityWhere,OR:[{visibility:'PUBLIC'},{ownerId:user.id},...(user.permissions.includes('*')?[{}]:[])]},select:{id:true}}))throw new BadRequestException('智能体不存在或不可用')
  if(dto.modelId&&!await this.db.model.findFirst({where:{id:dto.modelId,enabled:true,provider:{enabled:true}},select:{id:true}}))throw new BadRequestException('模型不存在或不可用')
  const turns=flattenTestSet(batches),job=await this.db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM users WHERE id=${user.id} FOR UPDATE`
   if(await tx.evaluationJob.count({where:{userId:user.id,status:{in:['QUEUED','RUNNING','CANCELLING']}}})>=2)throw new BadRequestException('最多同时保留两个待执行任务，请等待或停止现有任务')
   return tx.evaluationJob.create({data:{userId:user.id,title:dto.title.trim(),status:'QUEUED',total:turns.length,batchCount:batches.length,options:{modelId:dto.modelId||null,agentId:dto.agentId||null,bypassCache:dto.bypassCache!==false,outputPreference:dto.outputPreference||'adaptive'},turns:{create:turns.map((t,i)=>({...t,position:i,status:'PENDING'}))}}})
  })
  await this.audit.log({userId:user.id,actor:user.email,action:'evaluation.create',resource:'evaluation',resourceId:job.id,detail:{total:job.total,batchCount:job.batchCount}})
  void this.pump();return job
 }
 async list(user:AuthUser){return this.db.evaluationJob.findMany({where:this.scope(user),orderBy:{createdAt:'desc'},take:50})}
 async detail(user:AuthUser,id:string){const job=await this.owned(user,id),turns=await this.db.evaluationTurn.findMany({where:{jobId:id},orderBy:{position:'asc'},select:{id:true,batchId:true,split:true,turn:true,question:true,status:true,error:true,reply:true,usage:true,latencyMs:true,conversationId:true,assistantMessageId:true}});return {...job,turns:turns.map(t=>({...t,reply:t.reply.slice(0,4000),previewTruncated:t.reply.length>4000}))}}
 async cancel(user:AuthUser,id:string){const job=await this.owned(user,id);if(!['QUEUED','RUNNING','CANCELLING'].includes(job.status))return job
  const running=this.active?.id===id;await this.db.evaluationJob.updateMany({where:{id,status:{in:['QUEUED','RUNNING','CANCELLING']}},data:{status:running?'CANCELLING':'CANCELLED',...(!running?{finishedAt:new Date()}: {})}})
  if(running)this.active!.controller.abort(new DOMException('测试任务已停止','AbortError'))
  await this.db.evaluationTurn.updateMany({where:{jobId:id,status:'PENDING'},data:{status:'CANCELLED',error:'任务已停止'}})
  await this.count(id)
  return this.owned(user,id)
 }
 async export(user:AuthUser,id:string,format:string){if(!['json','csv'].includes(format))throw new BadRequestException('仅支持 JSON 或 CSV');const job=await this.owned(user,id),turns=await this.db.evaluationTurn.findMany({where:{jobId:id},orderBy:{position:'asc'}})
  const rows=turns.map(t=>({batch_id:t.batchId,split:t.split,turn:t.turn,question:t.question,reply:t.reply,status:t.status,error:t.error||'',latency_ms:t.latencyMs,conversation_id:t.conversationId,assistant_message_id:t.assistantMessageId,usage:t.usage,runtime:t.runtime,sources:t.sources}))
  if(format==='json')return {mime:'application/json; charset=utf-8',body:JSON.stringify({schemaVersion:1,task:{id:job.id,title:job.title,status:job.status,createdAt:job.createdAt,options:job.options},batches:Array.from(new Set(rows.map(r=>r.batch_id))).map(batch_id=>({batch_id,split:rows.find(r=>r.batch_id===batch_id)!.split,turns:rows.filter(r=>r.batch_id===batch_id)}))},null,2)}
  const fields=['task_id','batch_id','split','turn','question','reply','status','error','latency_ms','conversation_id','usage'] as const
  return {mime:'text/csv; charset=utf-8',body:'\uFEFF'+fields.join(',')+'\r\n'+rows.map(r=>fields.map(f=>csvCell(f==='task_id'?job.id:f==='usage'?JSON.stringify(r.usage):r[f])).join(',')).join('\r\n')+'\r\n'}
 }
 private async actor(id:string):Promise<AuthUser>{const u=await this.db.user.findUnique({where:{id},include:{roles:{include:{role:{include:{permissions:{include:{permission:true}}}}}}}});if(!u||u.status!=='ACTIVE')throw new ForbiddenException('执行账号不可用');const permissions=[...new Set(u.roles.flatMap(r=>r.role.permissions.map(p=>p.permission.code)))];if(!permissions.includes('*')&&!permissions.includes('conversation:read'))throw new ForbiddenException('批量测试权限已撤销');return {id:u.id,email:u.email,name:u.name,status:u.status,roles:u.roles.map(r=>r.role.key),permissions}}
 private async pump(){if(this.busy||this.stopped)return;this.busy=true
  try{while(!this.stopped){const job=await this.db.evaluationJob.findFirst({where:{status:'QUEUED'},orderBy:{createdAt:'asc'}});if(!job)break;const claimed=await this.db.evaluationJob.updateMany({where:{id:job.id,status:'QUEUED'},data:{status:'RUNNING',startedAt:new Date()}});if(!claimed.count)continue
   const controller=new AbortController();this.active={id:job.id,controller};const options=job.options as {modelId?:string;agentId?:string;bypassCache:boolean;outputPreference:'cards'|'adaptive'|'text'},conversations=new Map<string,string>(),blocked=new Set<string>()
   try{for(const turn of await this.db.evaluationTurn.findMany({where:{jobId:job.id},orderBy:{position:'asc'}})){
    const current=await this.db.evaluationJob.findUnique({where:{id:job.id},select:{status:true}});if(controller.signal.aborted||current?.status!=='RUNNING')break
    if(blocked.has(turn.batchId)){await this.db.evaluationTurn.update({where:{id:turn.id},data:{status:'SKIPPED',error:'本批次前一轮失败，未继续执行依赖该上下文的追问'}});await this.count(job.id);continue}
    const user=await this.actor(job.userId);let conversationId=conversations.get(turn.batchId)
    if(!conversationId){const conversation=await this.db.conversation.create({data:{userId:user.id,title:`测试 · ${job.title} · ${turn.batchId}`.slice(0,200),evaluationJobId:job.id,modelId:options.modelId||null,agentId:options.agentId||null}});conversationId=conversation.id;conversations.set(turn.batchId,conversationId)}
    await this.db.evaluationTurn.update({where:{id:turn.id},data:{status:'RUNNING',conversationId}});const response=new EvaluationResponse(),started=Date.now()
    await this.chat.streamChat(user,{conversationId,content:turn.question,modelId:options.modelId||undefined,agentId:options.agentId||undefined,origin:'api',outputPreference:options.outputPreference,bypassCache:options.bypassCache,memoryEnabled:false},response as any,undefined,{evaluation:true,signal:controller.signal})
    const message=response.assistantMessageId?await this.db.message.findUnique({where:{id:response.assistantMessageId},select:{content:true,status:true,error:true}}):null,status=controller.signal.aborted?'CANCELLED':message?.status||response.status
    await this.db.evaluationTurn.update({where:{id:turn.id},data:{status,reply:message?.content||response.reply,error:message?.error||response.error||null,assistantMessageId:response.assistantMessageId,latencyMs:Date.now()-started,usage:response.usage as any,runtime:response.runtime as any,sources:response.sources as any}})
    if(status!=='SUCCESS')blocked.add(turn.batchId);await this.count(job.id)
   }
   const current=await this.db.evaluationJob.findUnique({where:{id:job.id},select:{status:true}});if(current?.status==='CANCELLING'||controller.signal.aborted){await this.db.evaluationTurn.updateMany({where:{jobId:job.id,status:{in:['PENDING','RUNNING']}},data:{status:'CANCELLED',error:'任务已停止'}});await this.db.evaluationJob.update({where:{id:job.id},data:{status:'CANCELLED',finishedAt:new Date()}})}else await this.db.evaluationJob.updateMany({where:{id:job.id,status:'RUNNING'},data:{status:'COMPLETED',finishedAt:new Date()}})
   }catch(e){await this.db.evaluationJob.updateMany({where:{id:job.id,status:{in:['RUNNING','CANCELLING']}},data:{status:controller.signal.aborted?'CANCELLED':'FAILED',finishedAt:new Date(),error:(e as Error).message}});await this.db.evaluationTurn.updateMany({where:{jobId:job.id,status:{in:['PENDING','RUNNING']}},data:{status:'CANCELLED',error:'执行已结束，未完成此题'}})}finally{await this.count(job.id);this.active=undefined}
  }}catch(e){this.logger.error('批量任务调度失败：'+(e as Error).message)}finally{this.busy=false}
 }
 private async count(id:string){const counts=await this.db.evaluationTurn.groupBy({by:['status'],where:{jobId:id},_count:{_all:true}});const n=(s:string)=>counts.find(c=>c.status===s)?._count._all||0;await this.db.evaluationJob.update({where:{id},data:{completed:counts.filter(c=>!['PENDING','RUNNING'].includes(c.status)).reduce((n,c)=>n+c._count._all,0),succeeded:n('SUCCESS'),failed:n('FAILED')+n('SKIPPED')}})}
}
