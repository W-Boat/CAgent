import 'reflect-metadata'
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {resolve} from 'node:path'
import {campusMaps,resolveCampusMap} from '../src/campus/campus-map'
import {parseKeywordRule,matchesKeywordRule,campusQuery,isSupportUrgent} from '../src/knowledge/keyword-rule'
import {PrismaService} from '../src/prisma/prisma.service'
import {AuditService} from '../src/common/services/audit.service'
import {KnowledgeStoreService} from '../src/knowledge/knowledge-store.service'
import {ChatService} from '../src/chat/chat.service'
const root=resolve(__dirname,'../../..'),checks:string[]=[]
const pass=(s:string)=>{checks.push(s);console.log('PASS '+s)}
for(const file of ['knowledge/src/campus-maps.json','apps/web/src/data/campus-maps.json'])assert.deepEqual(JSON.parse(readFileSync(resolve(root,file),'utf8')),campusMaps)
assert.equal(campusMaps.campuses.flatMap(c=>c.places).length,58)
assert.deepEqual(campusMaps.campuses.map(c=>c.northRotation),[90,45])
pass('58 个地点共享同一份地图数据，保留两校区原图北方向')
const library=resolveCampusMap('图书馆在哪里')!
assert.equal(library.card.matches.length,2)
assert.equal(resolveCampusMap('望京图书馆在哪里')!.card.matches.length,1)
assert.equal(resolveCampusMap('望京图书馆在哪里')!.card.campus,'wangjing')
assert(resolveCampusMap('悦成楼在哪')!.answer.includes('南综合楼'))
assert(resolveCampusMap('良乡教学楼在哪')!.answer.includes('研教楼'))
assert(!resolveCampusMap('良乡教学楼在哪')!.answer.includes('· 教学综合楼'))
for(const alias of ['综合楼','新综楼','教综楼'])assert(resolveCampusMap('良乡'+alias+'在哪')!.answer.includes('教学综合楼'))
assert(resolveCampusMap('良乡瑞幸在哪')!.answer.includes('北综合楼'))
assert(resolveCampusMap('望京二号宿舍楼在哪')!.answer.includes('2号宿舍楼'))
assert(resolveCampusMap('那它在哪里','良乡研教楼')!.answer.includes('研教楼'))
assert.equal(resolveCampusMap('月球实验楼在哪里'),null)
assert.equal(resolveCampusMap('图书馆开放时间'),null)
assert.equal(resolveCampusMap('你好'),null)
assert.equal(resolveCampusMap('望京校区地图')!.card.campus,'wangjing')
assert.equal(resolveCampusMap('食堂在哪')!.card.matches.length,2)
assert(resolveCampusMap('良乡食堂在哪')!.answer.includes('第一食堂'))
assert.equal(resolveCampusMap('怎么到望京图书馆')!.card.campus,'wangjing')
assert.equal(resolveCampusMap('那它在哪里','良乡和望京都有图书馆')!.card.matches.length,2)
pass('位置、别名、中文楼号、多轮、校区歧义及未知建筑处理')
const spec=JSON.parse(readFileSync(resolve(root,'knowledge/campus-keyword-rules.json'),'utf8'))
const triggers=spec.entries.filter((e:any)=>e.rule)
const pair=triggers.find((e:any)=>e.rule.text==='比翼双非').rule
assert(matchesKeywordRule(parseKeywordRule(JSON.stringify(pair)),'🐍和国科大'))
assert(!matchesKeywordRule(parseKeywordRule(JSON.stringify(pair)),'只提到社科大'))
assert.equal(campusQuery('🐍是什么学校'),'社科大是什么学校')
assert(isSupportUrgent('退学，猫娘，我不想活了'))
assert.throws(()=>parseKeywordRule('{"version":1,"any":["x"],"behavior":"APPEND","effect":"evil"}'))
assert.throws(()=>parseKeywordRule('{"version":1,"behavior":"REPLACE"}'))
pass('组合关键词与蛇 emoji 匹配，拒绝非法效果与空规则')
for(const line of readFileSync(resolve(root,'.env'),'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2]}
assert(['127.0.0.1','localhost'].includes(new URL(process.env.DATABASE_URL!).hostname),'只允许本地数据库')
const prisma=new PrismaService(),audit=new AuditService(prisma),store=new KnowledgeStoreService(prisma,audit)
let userId='',baseId='',agentId=''
async function main(){
  const suffix=Date.now().toString(36),user=await prisma.user.create({data:{email:`map-verify-${suffix}@example.invalid`,name:'地图验证',passwordHash:'disabled'}})
  userId=user.id
  const op={id:user.id,email:user.email}
  const agent=await prisma.agent.create({data:{key:'map-verify-'+suffix,name:'地图验证',systemPrompt:'仅用于验证',ownerId:user.id,visibility:'PRIVATE'}});agentId=agent.id
  const base=await prisma.knowledgeBase.create({data:{name:'map-verify-'+suffix,mounted:true,agentId:agent.id}});baseId=base.id
  const fixturePhrase='验证触发'+suffix
  const entry=await store.save({baseId,title:fixturePhrase,answer:JSON.stringify({version:1,any:[fixturePhrase],behavior:'REPLACE',text:'验证固定内容'}),mode:'TRIGGER',status:'DRAFT'},op)
  assert.equal((await store.keywordRules(fixturePhrase,agentId)).length,0)
  await store.save({...entry,aliases:[],status:'APPROVED',sourceMessageId:undefined},op,entry.id)
  assert.equal((await store.keywordRules(fixturePhrase,agentId)).length,1)
  assert.equal((await store.keywordRules(fixturePhrase)).length,0)
  assert(!(await store.rows(agentId)).some(r=>r.title===fixturePhrase))
  await prisma.knowledgeBase.update({where:{id:baseId},data:{mounted:false}})
  assert.equal((await store.keywordRules(fixturePhrase,agentId)).length,0)
  await prisma.knowledgeBase.update({where:{id:baseId},data:{mounted:true}})
  assert.deepEqual(await store.keywordRules(fixturePhrase+'，自杀',agentId),[])
  pass('真实数据库草稿、卸载、Agent 隔离，规则 JSON 不进入 RAG，危险信号优先')
  let llmCalls=0,quotaChecks=0
  const guard=new Proxy({},{get:()=>()=>{llmCalls++;throw new Error('不得调用 LLM')}})
  const chat=new ChatService(store,prisma,{recordUsage:async()=>{},assertWithinQuota:async()=>{quotaChecks++}} as any,audit,guard as any,guard as any,guard as any,guard as any,guard as any,guard as any,guard as any,guard as any,guard as any,guard as any,guard as any)
  for(const [question,expected] of [['良乡图书馆在哪里','"type":"map"'],['望京二号宿舍楼在哪里','2号宿舍楼'],['社科大和国科大','比翼双非'],['社科大和北理工','天长地久'],['大老虎','"effect":"tiger"'],['辛瓜地','"effect":"melon"'],['猫娘','"effect":"cat"'],['地铁站','广阳城'],['恋爱','自己去谈'],['食堂菜谱','社科汇'],['白舟','你为什么想找我的开发者呢'],[fixturePhrase,'验证固定内容']]){
    const events:string[]=[],response:any={headersSent:false,writableEnded:false,on:()=>{},off:()=>{},setHeader:()=>{},flushHeaders:()=>{},write:(s:string)=>events.push(s),end(){this.writableEnded=true}}
    await chat.streamChat({id:userId,email:user.email,permissions:['*']} as any,{content:question,agentId,modelId:'invalid-model'} as any,response)
    const text=events.join(''),frames=text.split('\n\n').map(f=>{try{return {name:f.match(/event: (.+)/)?.[1],data:JSON.parse(f.match(/data: (.+)/)?.[1]||'{}')}}catch{return null}}).filter(Boolean)
    assert(text.includes('"status":"SUCCESS"'),text);assert(frames.filter(f=>f?.name==='text').map(f=>f!.data.text).join('').includes(expected),question);assert(text.includes('"totalTokens":0'))
  }
  assert.equal(llmCalls,0);assert.equal(quotaChecks,12)
  const history=await prisma.message.findMany({where:{userId,role:'assistant'}})
  assert.equal(history.length,12);assert(history.some(m=>m.content.includes('"type":"map"')))
  pass('12 次真实 SSE 地图/固定话术/彩蛋回复绕过无效模型、零 token，仍检查额度并保存历史')
  mkdirSync(resolve(root,'storage/shots/maps'),{recursive:true})
  writeFileSync(resolve(root,'storage/shots/maps/backend-verification.json'),JSON.stringify({checkedAt:new Date().toISOString(),checks},null,2))
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{
  if(baseId)await prisma.knowledgeBase.delete({where:{id:baseId}})
  if(agentId)await prisma.agent.delete({where:{id:agentId}})
  if(userId){await prisma.auditLog.deleteMany({where:{userId}});await prisma.user.delete({where:{id:userId}})}
  await store.bump();await prisma.$disconnect()
})
