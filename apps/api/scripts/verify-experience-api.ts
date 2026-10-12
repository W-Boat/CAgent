import 'reflect-metadata'
import assert from 'node:assert/strict'
import {config} from 'dotenv'
import {PrismaService} from '../src/prisma/prisma.service'
import {ConversationsService} from '../src/conversations/conversations.service'
import {KnowledgeAdminController} from '../src/knowledge/knowledge-admin.controller'
import {QueryMessageDto} from '../src/conversations/dto/conversation.dto'
import {plainToInstance} from 'class-transformer'
import {validate} from 'class-validator'
config({path:'../../.env'})
async function main(){
 const prisma=new PrismaService();await prisma.$connect()
 let conversationId='',baseId=''
 try{
  const owner=await prisma.user.findFirstOrThrow({where:{email:process.env.SEED_ADMIN_EMAIL}})
  const conv=await prisma.conversation.create({data:{userId:owner.id,title:'隔离验证：历史游标'}});conversationId=conv.id
  await prisma.message.createMany({data:Array.from({length:231},(_,i)=>({conversationId,userId:owner.id,role:i%2?'assistant' as const:'user' as const,seq:i+1,content:'验证消息 '+(i+1)}))})
  const service=new ConversationsService(prisma,{} as any)
  const newest=await service.listMessages(conversationId,{latest:'true',pageSize:100}) as any
  assert.equal(newest.items[0].seq,132);assert.equal(newest.items.at(-1).seq,231);assert.equal(newest.hasMore,true)
  await prisma.message.create({data:{conversationId,userId:owner.id,role:'assistant',seq:232,content:'新到消息'}})
  const older=await service.listMessages(conversationId,{beforeSeq:newest.nextBeforeSeq,pageSize:100}) as any
  assert.deepEqual(older.items.map((m:any)=>m.seq),Array.from({length:100},(_,i)=>32+i))
  const first=await service.listMessages(conversationId,{beforeSeq:older.nextBeforeSeq,pageSize:100}) as any
  assert.equal(first.items.length,31);assert.equal(first.hasMore,false)
  const legacy=await service.listMessages(conversationId,{page:1,pageSize:100}) as any;assert.equal(legacy.items[0].seq,1)
  const oversized=await service.listMessages(conversationId,{latest:'true',pageSize:5000}) as any;assert.equal(oversized.items.length,100)
  const stableOlder=await service.listMessages(conversationId,{beforeId:newest.nextBeforeId,pageSize:100}) as any
  assert.deepEqual(stableOlder.items.map((m:any)=>m.seq),older.items.map((m:any)=>m.seq))
  await assert.rejects(()=>service.listMessages(conversationId,{beforeId:'unknown-message'}))
  await prisma.message.updateMany({where:{conversationId},data:{seq:0}})
  const seen=new Set<string>();let cursor:string|undefined
  for(let i=0;i<4;i++){
    const page=await service.listMessages(conversationId,{latest:'true',beforeId:cursor,pageSize:100}) as any
    for(const m of page.items){assert(!seen.has(m.id));seen.add(m.id)}
    if(!page.hasMore)break
    cursor=page.nextBeforeId
  }
  assert.equal(seen.size,232,'历史序号相同的消息也可完整加载且不重复')
  for(const value of ['0','-1','abc','2147483648'])assert((await validate(plainToInstance(QueryMessageDto,{beforeSeq:value}))).length)
  assert.equal((await validate(plainToInstance(QueryMessageDto,{beforeSeq:'132',latest:'true'}))).length,0)
  await assert.rejects(()=>service.assertAccess(conversationId,'other-user',false))
  console.log('PASS 最新历史、插入新消息后的稳定游标、旧分页兼容、数量上限、非法游标与跨用户访问拒绝')
  const base=await prisma.knowledgeBase.create({data:{name:'隔离验证：知识搜索',mounted:false}});baseId=base.id
  await prisma.knowledgeEntry.create({data:{baseId,title:'测试条目',questionKey:'isolated-keyword-test',answer:'答案内搜索标记 731426',status:'DRAFT'}})
  const controller=new KnowledgeAdminController({} as any,{} as any,prisma,{} as any,{} as any,{} as any)
  assert.equal((await controller.entries(baseId,'DRAFT','1','731426')).items.length,1)
  assert.equal((await controller.entries(baseId,'APPROVED','1','731426')).items.length,0)
  assert.throws(()=>controller.entries(baseId,'DRAFT','1','a'.repeat(201)))
  console.log('PASS 知识条目全文搜索、库与发布状态联合过滤、超长搜索拒绝')
 }finally{
  if(conversationId)await prisma.conversation.delete({where:{id:conversationId}})
  if(baseId)await prisma.knowledgeBase.delete({where:{id:baseId}})
  await prisma.$disconnect()
 }
}
main().catch(e=>{console.error(e);process.exitCode=1})
