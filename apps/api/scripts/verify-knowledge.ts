/** Local integration checks. Fixtures are isolated and removed in finally; no LLM/network billing. */
import 'reflect-metadata'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/common/services/audit.service'
import { CryptoService } from '../src/common/services/crypto.service'
import { KnowledgeStoreService, normalizeQuestion } from '../src/knowledge/knowledge-store.service'
import { buildGuidance } from '../src/campus/knowledge-guidance'
import { selectAutomaticTools } from '../src/chat/tool-selector'
import { KnowledgeAdminService } from '../src/knowledge/knowledge-admin.service'
import { KnowledgeRetriever, excerptForQuery, type KnowledgeRow } from '../src/campus/knowledge-retriever'
import { CampusGuideService } from '../src/campus/campus-guide.service'
import { ContextBuilderService } from '../src/chat/context-builder.service'
import { LearningService } from '../src/learning/learning.service'
import { ChatService } from '../src/chat/chat.service'
import { readExternalDatabase, selectStatement } from '../src/knowledge/external-database'
import { estimateTokens } from '../src/chat/llm/types'

const root = resolve(__dirname,'../../..')
for (const line of readFileSync(resolve(root,'.env'),'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]]=m[2]
}
const database = new URL(process.env.DATABASE_URL!)
assert(['127.0.0.1','localhost'].includes(database.hostname),'只允许在本地开发数据库运行集成验证')
const prisma = new PrismaService()
const audit = new AuditService(prisma)
const crypto = new CryptoService(new ConfigService())
const store = new KnowledgeStoreService(prisma,audit)
const guide = new CampusGuideService(prisma,store)
const learning = new LearningService(store,prisma,audit)
const suffix = randomBytes(5).toString('hex')
const table = `kb_verify_${suffix}`
const prefix = `kb-verify-${suffix}`
const bases:string[] = [], users:string[] = [], agents:string[] = []
const checks:string[] = []
const passed = (name:string) => {checks.push(name);console.log(`PASS ${name}`)}

async function main() {
  const row = (id:number,title:string,extra:any={}):KnowledgeRow => ({id:String(id),externalId:id,title,searchText:title,extra:{kb:{schema:'kb/v2',collection:'test',...extra}}})
  const index = new KnowledgeRetriever([row(1,'校园卡挂失'),row(2,'图书借阅'),row(3,'秘密材料',{agentId:'other',aliases:['校园卡挂失']}),
    {id:'legacy',externalId:2000010,title:'旧示例',searchText:'旧示例'},row(4,'模拟事项',{sourceClaim:'半真实示例'})])
  assert.equal(index.search('校园卡挂失').hits[0].row.id,'1')
  assert(!index.search('校园卡挂失').hits.some(h=>h.row.id==='3'))
  assert.equal(index.search('你好').hits.length,0)
  assert.equal(index.search('可以线上办吗').hits.length,0)
  assert(index.search('那要带什么',{previousQuery:'图书借阅'}).hits.some(h=>h.row.id==='2'))
  assert.equal(index.rows.length,3)
  passed('别名匹配、多轮补全、范围隔离、旧语料与示例隔离')

  const builder = new ContextBuilderService(prisma)
  const current = '当前问题：校园卡挂失'
  const context = builder.build({systemPrompts:['简洁回答'],history:[{role:'user',content:'旧问题'.repeat(3000),seq:1},{role:'assistant',content:'旧答案'.repeat(3000),seq:2},{role:'user',content:current,seq:3}],budgetTokens:600,maxOutputTokens:200})
  assert.equal(context.at(-1)?.content,current)
  assert.throws(()=>builder.build({systemPrompts:['超长提示'.repeat(3000)],history:[{role:'user',content:current}],budgetTokens:600,maxOutputTokens:200}))
  passed('上下文预算始终保留当前问题并拒绝溢出')
  assert.notEqual(normalizeQuestion('1+1是多少'),normalizeQuestion('1-1是多少'))
  assert(excerptForQuery('背景说明'.repeat(150)+'联系电话：010-12345678','联系电话',100).includes('010-12345678'))
  const guidance = buildGuidance('请假怎么办',[{title:'学生请假',score:50,type:'事项'},{title:'教师请假',score:48,type:'事项'}])
  assert.equal(guidance.stage,'clarify')
  assert.equal(guidance.choices.length,2)
  assert.equal(selectAutomaticTools('今天天气',[{name:'weather',description:'天气查询',parameters:{}},{name:'calculator',description:'数学计算',parameters:{}}])[0].name,'weather')
  passed('固定匹配保留数学语义、歧义事项向导、只加载相关自动工具')

  const user = await prisma.user.create({data:{email:`${prefix}@example.invalid`,name:'知识库验证账号',passwordHash:'disabled-verification-account'}})
  users.push(user.id)
  const op = {id:user.id,email:user.email}
  const agent = await prisma.agent.create({data:{key:prefix,name:'知识库验证 Agent',systemPrompt:'本地验证',visibility:'PRIVATE',ownerId:user.id}})
  agents.push(agent.id)
  const admin = new KnowledgeAdminService(prisma,crypto,store,audit,{complete:async()=>JSON.stringify({entries:[{title:'解析条目',answer:'管理员提供的事实',mode:'FIXED'}]})} as any)
  const base = await admin.saveBase({name:prefix,kind:'LOCAL',mounted:true,agentId:agent.id},op)
  bases.push(base.id)
  const q = `验证固定问题${suffix}`
  const fixed = await store.save({baseId:base.id,title:q,question:q,answer:'固定答案逐字输出',mode:'FIXED',status:'DRAFT',aliases:[`别名${suffix}`]},op)
  assert.equal(await store.fixed(q,agent.id),null)
  await store.save({...fixed,aliases:fixed.aliases as string[],status:'APPROVED',sourceMessageId:undefined},op,fixed.id)
  assert.equal((await store.fixed(q+'？',agent.id))?.answer,fixed.answer)
  assert.equal((await store.fixed(`别名${suffix}`,agent.id))?.id,fixed.id)
  assert.equal(await store.fixed(q),null)
  passed('草稿不参与回答、固定问答精确匹配、别名与 Agent 隔离')
  const global = await admin.saveBase({name:prefix+'-global',mounted:true},op)
  bases.push(global.id)
  await store.save({baseId:global.id,title:q+'范围',answer:'全局答案',mode:'FIXED',status:'APPROVED'},op)
  await store.save({baseId:base.id,title:q+'范围',answer:'此 Agent 的答案',mode:'FIXED',status:'APPROVED'},op)
  assert.equal((await store.fixed(q+'范围',agent.id))?.answer,'此 Agent 的答案')
  assert.equal((await store.fixed(q+'范围'))?.answer,'全局答案')
  passed('同级固定问答优先当前 Agent，保留全局回退')

  const before = await store.revision()
  const correction = await store.pinCorrection({question:q,answer:'管理员更正后的答案',agentId:agent.id},op)
  bases.push(correction.baseId)
  assert.notEqual(before,await store.revision())
  assert.equal((await store.fixed(q,agent.id))?.answer,correction.answer)
  await admin.mount(correction.baseId,false,op)
  assert.equal((await store.fixed(q,agent.id))?.answer,fixed.answer)
  await admin.mount(base.id,false,op)
  assert.equal(await store.fixed(q,agent.id),null)
  await admin.mount(base.id,true,op)
  await admin.mount(correction.baseId,true,op)
  passed('管理员纠错优先、挂载停用立即失效、版本号刷新')

  const conflictBase = await admin.saveBase({name:prefix+'-conflict',mounted:true,agentId:agent.id},op)
  bases.push(conflictBase.id)
  await store.save({baseId:conflictBase.id,title:q,question:q,answer:'另一条冲突纠错',mode:'CORRECTION',status:'APPROVED'},op)
  await assert.rejects(()=>store.fixed(q,agent.id),/冲突/)
  await admin.mount(conflictBase.id,false,op)
  assert(await prisma.knowledgeRevision.count({where:{entryId:fixed.id}}))
  passed('同优先级冲突阻止任意答案、修改保留版本')

  let llmCalls = 0
  const guard = new Proxy({}, {get:()=>()=>{llmCalls++;throw new Error('固定答案不应调用模型')}})
  let usage:any
  const chat = new ChatService(store,prisma,{recordUsage:async(v:any)=>{usage=v},assertWithinQuota:async()=>{}} as any,audit,guard as any,guard as any,guard as any,guard as any,guard as any,guard as any,guard as any,builder,learning,guard as any,guide)
  const events:string[]=[]
  const response:any={headersSent:false,writableEnded:false,on:()=>{},off:()=>{},setHeader:()=>{},flushHeaders:()=>{},write:(s:string)=>events.push(s),end(){this.writableEnded=true}}
  await chat.streamChat({id:user.id,email:user.email,permissions:['*']} as any,{content:q,agentId:agent.id,modelId:'nonexistent-model'} as any,response)
  assert.equal(llmCalls,0)
  assert(events.join('').includes('fixed_answer'))
  assert(events.join('').includes(correction.answer))
  assert.equal(usage.providerKey,'knowledge')
  passed('聊天 SSE 固定纠错绕过模型选择与 LLM 调用，零 token')

  const conversation = await prisma.conversation.create({data:{userId:user.id,agentId:agent.id,title:prefix}})
  const question = `学习问题${suffix}`
  await prisma.message.create({data:{conversationId:conversation.id,userId:user.id,role:'user',content:question,seq:1}})
  const message = await prisma.message.create({data:{conversationId:conversation.id,userId:user.id,role:'assistant',content:'错误答案',seq:2}})
  await Promise.all(Array.from({length:4},()=>learning.submit(user.id,{messageId:message.id,positive:false,correction:'正确答案'})))
  let candidate = (await prisma.agentLearning.findMany({where:{agentId:agent.id}}))[0]
  assert.equal(candidate.supportCount,1)
  assert.equal(await learning.buildLearningPrompt(agent.id,question),null)
  await learning.revoke(user.id,message.id)
  assert.equal((await prisma.agentLearning.findUniqueOrThrow({where:{id:candidate.id}})).supportCount,0)
  await learning.submit(user.id,{messageId:message.id,positive:false,correction:'正确答案'})
  await learning.review(candidate.id,'APPROVED',op,{pinAnswer:true,fixedAnswer:'已批准的正确答案'})
  assert.equal((await store.fixed(question,agent.id))?.answer,'已批准的正确答案')
  assert(await learning.buildLearningPrompt(agent.id,question))
  assert.equal(await learning.buildLearningPrompt(agent.id,'与此无关的研究事项'),null)
  await learning.review(candidate.id,'REJECTED',op)
  assert.equal(await store.fixed(question,agent.id),null)
  passed('重复反馈不增加支持人数、撤回扣除支持、审核后生效、拒绝同时下架固定纠错')

  const drafts = await admin.parse('固定问题及正确答案',op)
  assert.equal(drafts[0].status,'DRAFT')
  const invalidParser = new KnowledgeAdminService(prisma,crypto,store,audit,{complete:async()=>'{invalid'} as any)
  await assert.rejects(()=>invalidParser.parse('测试',op),/JSON/)
  passed('自然语言解析结果必须人工审核，异常 JSON 不入库（模型响应模拟）')

  await prisma.$executeRawUnsafe(`CREATE TABLE "${table}" (id TEXT PRIMARY KEY, title TEXT, answer TEXT)`)
  await prisma.$executeRawUnsafe(`INSERT INTO "${table}" (id,title,answer) VALUES ($1,$2,$3)`,'1','外部问题'+suffix,'外部正确答案')
  const config:any={host:database.hostname,port:Number(database.port)||5432,database:database.pathname.slice(1),user:decodeURIComponent(database.username),tls:false,table,columns:{id:'id',title:'title',answer:'answer'},entryMode:'FIXED'}
  assert.equal((await readExternalDatabase('POSTGRES',config,decodeURIComponent(database.password)))[0].answer,'外部正确答案')
  assert(selectStatement('MYSQL',config).includes('`answer`'))
  assert.throws(()=>selectStatement('POSTGRES',{...config,table:'items;DROP TABLE users'}))
  assert.throws(()=>selectStatement('MYSQL',{...config,columns:{...config.columns,answer:'answer FROM users'}}))
  const external = await admin.saveBase({name:prefix+'-postgres',kind:'POSTGRES',connection:config,password:decodeURIComponent(database.password),mounted:true,agentId:agent.id},op)
  bases.push(external.id)
  assert(!('passwordEncrypted' in external))
  await admin.sync(external.id,op)
  const remote = await prisma.knowledgeEntry.findFirstOrThrow({where:{baseId:external.id}})
  assert.equal(remote.status,'DRAFT')
  await store.save({...remote,aliases:[],status:'APPROVED',sourceMessageId:undefined},op,remote.id)
  await admin.sync(external.id,op)
  assert.equal((await prisma.knowledgeEntry.findUniqueOrThrow({where:{id:remote.id}})).status,'APPROVED')
  await prisma.$executeRawUnsafe(`UPDATE "${table}" SET answer=$1 WHERE id=$2`,'更新后的外部答案','1')
  await admin.sync(external.id,op)
  assert.equal((await prisma.knowledgeEntry.findUniqueOrThrow({where:{id:remote.id}})).status,'DRAFT')
  await prisma.$executeRawUnsafe(`DELETE FROM "${table}"`)
  await admin.sync(external.id,op)
  assert.equal((await prisma.knowledgeEntry.findUniqueOrThrow({where:{id:remote.id}})).status,'ARCHIVED')
  passed('PostgreSQL 真实只读接入、密码加密且不回传、同步变更重审、远端删除下架、MySQL 引用语法与 SQL 注入拒绝')

  const managed = await store.save({baseId:base.id,title:'测试知识条目'+suffix,answer:'条目内容'+suffix,status:'APPROVED'},op)
  const hit = await guide.search(managed.title,'guide',3,{agentId:agent.id})
  assert(hit.hits.some(h=>h.id.startsWith('managed:')&&h.title===managed.title))
  assert.equal((await guide.search(managed.title,'guide',3)).hits.filter(h=>h.id.startsWith('managed:')).length,0)
  const text = guide.renderAnswer(hit,800)
  assert(text.includes(managed.title)&&estimateTokens(text)<=800)
  await admin.mount(base.id,false,op)
  assert.equal((await guide.search(managed.title,'guide',3,{agentId:agent.id})).hits.filter(h=>h.title===managed.title).length,0)
  passed('实际查询器动态挂载、Agent 范围过滤、证据来源及 token 预算')
  const moved=await store.save({...managed,aliases:[],baseId:global.id,status:'APPROVED',sourceMessageId:undefined},op,managed.id)
  assert.equal(moved.baseId,global.id)
  assert.equal(moved.status,'DRAFT')
  assert(await prisma.knowledgeRevision.count({where:{entryId:managed.id}}))
  await store.save({...moved,aliases:[],mode:'FIXED',status:'APPROVED',sourceMessageId:undefined},op,moved.id)
  assert.equal((await store.fixed(moved.question))?.id,moved.id)
  await store.save({...moved,aliases:[],mode:'RAG',status:'APPROVED',sourceMessageId:undefined},op,moved.id)
  assert.equal(await store.fixed(moved.question),null)
  passed('跨知识库迁移保留历史并重新审核，RAG 与固定问答可切换模式')
  const live = await guide.search('请假怎么弄','guide',3)
  assert(live.hits.some(h=>h.title.includes('请假')))
  assert(live.hits.every(h=>!(h.externalId>=2000000&&h.externalId<3000000)))
  passed('导入后的数据库检索命中实际事项并排除旧参考语料')
}
main().then(()=>{
  writeFileSync(resolve(root,'knowledge/dist/integration-verification.json'),JSON.stringify({checkedAt:new Date().toISOString(),checks,mysqlLiveVerified:false,llmParseLiveVerified:false},null,2))
  console.log(`完成 ${checks.length} 组集成检查`)
}).catch(err=>{console.error(err);process.exitCode=1}).finally(async()=>{
  await prisma.knowledgeBase.deleteMany({where:{id:{in:bases}}})
  await prisma.agent.deleteMany({where:{id:{in:agents}}})
  await prisma.auditLog.deleteMany({where:{userId:{in:users}}})
  await prisma.user.deleteMany({where:{id:{in:users}}})
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${table}"`)
  await store.bump()
  await prisma.$disconnect()
})
