import {ConflictException,NotFoundException} from '@nestjs/common'
import type {PrismaService} from '../prisma/prisma.service'
import {archiveVersion} from './answer-versions'
import {estimateTokens} from './llm/types'

/** Reserve a whole user/assistant pair under a short PostgreSQL row lock. No model call holds a DB transaction. */
export async function reserveTurn(prisma:PrismaService,params:{conversationId:string;userId:string;content:string;images?:string[];modelId?:string;providerKey?:string;modelKey?:string;agentId?:string|null;revisionMessageId?:string}){
  return prisma.$transaction(async tx=>{
    const row=await tx.$queryRaw<{id:string}[]>`SELECT id FROM conversations WHERE id=${params.conversationId} AND user_id=${params.userId} AND status <> 'DELETED' FOR UPDATE`
    if(!row.length)throw new NotFoundException('会话不存在')
    const active=await tx.message.findFirst({where:{conversationId:params.conversationId,role:'assistant',status:'STREAMING'},orderBy:{createdAt:'desc'}})
    if(active&&Date.now()-new Date((active.attachments as any)?.versionRunStartedAt||active.createdAt).getTime()<10*60_000)throw new ConflictException('这个会话正在生成回复，请停止或等待完成后再发送。')
    if(active)await tx.message.updateMany({where:{conversationId:params.conversationId,role:'assistant',status:'STREAMING'},data:{status:'ABORTED',finishReason:'stale_run',error:'上次生成已中断，可继续提问。'}})
    if(params.revisionMessageId){
     const assistant=await tx.message.findFirst({where:{id:params.revisionMessageId,conversationId:params.conversationId,role:'assistant'}})
     if(!assistant)throw new NotFoundException('原回答不存在')
     const user=await tx.message.findFirst({where:{conversationId:params.conversationId,role:'user',seq:{lt:assistant.seq}},orderBy:{seq:'desc'}})
     if(!user||user.content!==params.content)throw new ConflictException('原问题发生变化，请重新加载')
     const version=archiveVersion(assistant)
     const updated=await tx.message.update({where:{id:assistant.id},data:{status:'STREAMING',attachments:{...(assistant.attachments as any||{}),...version,versionRunStartedAt:new Date().toISOString()}}})
     return {user,assistant:updated}
    }
    const last=await tx.message.aggregate({where:{conversationId:params.conversationId},_max:{seq:true}}),seq=(last._max.seq||0)+1
    const user=await tx.message.create({data:{conversationId:params.conversationId,userId:params.userId,role:'user',content:params.content,seq,promptTokens:estimateTokens(params.content),...(params.images?.length?{attachments:{images:params.images}}:{})}})
    const assistant=await tx.message.create({data:{conversationId:params.conversationId,userId:params.userId,role:'assistant',content:'',seq:seq+1,status:'STREAMING',modelId:params.modelId,providerKey:params.providerKey,modelKey:params.modelKey}})
    await tx.conversation.update({where:{id:params.conversationId},data:{messageCount:{increment:2},lastMessageAt:new Date(),modelId:params.modelId,agentId:params.agentId}})
    return {user,assistant}
  },{maxWait:5000,timeout:10000})
}
