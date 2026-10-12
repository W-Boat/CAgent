import assert from 'node:assert/strict'
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {PrismaService} from '../src/prisma/prisma.service'
import {AuditService} from '../src/common/services/audit.service'
import {AgentsService} from '../src/agents/agents.service'
import {SkillsEngineService} from '../src/skills/skills-engine.service'
import {ConversationsService} from '../src/conversations/conversations.service'
import {LearningService} from '../src/learning/learning.service'
import {AuditQueryService} from '../src/audit/audit-query.service'
import {DashboardService} from '../src/dashboard/dashboard.service'
import {isRetiredCapability,stripRetiredCapabilities} from '../src/common/retired-capabilities'
const root=resolve(__dirname,'../../..'),checks:string[]=[],pass=(s:string)=>{checks.push(s);console.log('PASS '+s)}
async function main(){
 for(const line of readFileSync(resolve(root,'.env'),'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2]}
 assert(['localhost','127.0.0.1'].includes(new URL(process.env.DATABASE_URL!).hostname),'Fixture writes must stay local')
 const db=new PrismaService(),audit=new AuditService(db),agents=new AgentsService(db,audit),skills=new SkillsEngineService(db,audit,undefined as any,undefined as any,undefined as any,undefined as any,undefined as any),conversations=new ConversationsService(db,audit),learning=new LearningService(undefined as any,db,audit),stamp=Date.now(),agentIds:string[]=[],skillIds:string[]=[];let userId=''
 try{
  userId=(await db.user.create({data:{email:'retired-'+stamp+'@example.invalid',name:'隐藏验证',passwordHash:'disabled-fixture'}})).id
  const visible=await db.agent.create({data:{key:'visible-fixture-'+stamp,name:'正常校园助手',description:null,systemPrompt:'visible',ownerId:userId}});agentIds.push(visible.id)
  const hidden=await db.agent.create({data:{key:'editorial-fixture-'+stamp,name:'人文之光测试',systemPrompt:'must not execute',enabled:true,ownerId:userId}});agentIds.push(hidden.id)
  const normalSkill=await db.skill.create({data:{key:'visible-skill-'+stamp,name:'正常校园技能',description:'正常',type:'TOOL'}});skillIds.push(normalSkill.id)
  const oldSkill=await db.skill.create({data:{key:'editorial-search-fixture-'+stamp,name:'人文之光检索',description:'已下线',type:'PROMPT',systemPrompt:'DO-NOT-INJECT',enabled:true}});skillIds.push(oldSkill.id)
  const oldCouple=await db.agent.create({data:{key:'loveline-fixture-'+stamp,name:'已移除空间',systemPrompt:'must not execute',enabled:true,ownerId:userId}});agentIds.push(oldCouple.id)
  const coupleSkill=await db.skill.create({data:{key:'loveline-companion-fixture-'+stamp,name:'已移除技能',description:'退役夹具',type:'PROMPT',systemPrompt:'DO-NOT-INJECT',enabled:true}});skillIds.push(coupleSkill.id)
  assert(isRetiredCapability(oldCouple));assert(isRetiredCapability(coupleSkill));await assert.rejects(()=>agents.detail(oldCouple.id));await assert.rejects(()=>skills.detail(coupleSkill.id));pass('退役情侣能力旧记录与重导入技能统一拒绝，无法通过旧 ID 启用')
  await db.agentSkill.createMany({data:[{agentId:visible.id,skillId:normalSkill.id},{agentId:visible.id,skillId:oldSkill.id}]})
  for(const rows of [await agents.list(),await agents.available(),await skills.list(),await skills.available(['*'])])assert(rows.every(row=>!isRetiredCapability(row)))
  assert((await agents.list()).some(a=>a.id===visible.id),'null description normal agent must remain visible')
  assert.deepEqual((await agents.detail(visible.id)).skills.map(s=>s.id),[normalSkill.id]);assert((await skills.list({keyword:'人文之光'})).length===0)
  await assert.rejects(()=>agents.detail(hidden.id));await assert.rejects(()=>agents.toggle(hidden.id,true));await assert.rejects(()=>agents.update(hidden.id,{name:'重新上架'}));await assert.rejects(()=>skills.detail(oldSkill.id));await assert.rejects(()=>skills.toggle(oldSkill.id,true));assert.equal(await agents.findByKey(hidden.key),null)
  pass('真实 PostgreSQL：学生与后台列表、关键词搜索和嵌套绑定统一隐藏；普通助手（空描述）保留；旧 ID 详情/编辑/启用均拒绝')
  await assert.rejects(()=>agents.update(visible.id,{skillIds:[oldSkill.id]}));assert.equal(await db.agentSkill.count({where:{agentId:visible.id}}),2,'invalid binding must not erase prior bindings')
  await assert.rejects(()=>skills.bindAgents(normalSkill.id,[hidden.id]));assert.equal(await db.agentSkill.count({where:{skillId:normalSkill.id}}),1)
  const ctx={userId,input:{},userPermissions:['*']};await assert.rejects(()=>skills.run(oldSkill.id,ctx));await assert.rejects(()=>skills.invokeByKey(oldSkill.key,{},ctx));await assert.rejects(()=>skills.readPromptSkill(oldSkill.key,[oldSkill.key],['*']));assert.deepEqual(await skills.collectPromptFragments([oldSkill.id],['*']),[]);assert.deepEqual(await skills.promptCatalog([oldSkill.id],['*'],'查找'),[]);assert.equal(await db.skillRun.count({where:{skillId:oldSkill.id}}),0)
  pass('隐藏技能不能运行、读取指引或重新绑定，拒绝请求不创建运行记录、不破坏已有绑定')
  const oldChat=await db.conversation.create({data:{userId,agentId:hidden.id,title:'retired-fixture-old'}}),normalChat=await db.conversation.create({data:{userId,agentId:visible.id,title:'retired-fixture-visible'}})
  const list=await conversations.listMine(userId,{page:1,pageSize:10});assert.equal(list.total,1);assert.equal(list.items[0].id,normalChat.id);await assert.rejects(()=>conversations.detail(oldChat.id));await assert.rejects(()=>conversations.assertAccess(oldChat.id,userId,true));assert(await db.conversation.findUnique({where:{id:oldChat.id}}),'historical row preserved')
  await db.agentLearning.create({data:{agentId:hidden.id,kind:'PREFERENCE',instruction:'old fixture'}});assert.equal((await learning.list({agentId:hidden.id})).total,0)
  pass('后台旧会话与学习分页准确隐藏，历史行保留且不能用审计权限绕过旧 ID 隐藏')
  await audit.log({userId,action:'agent.fixture',resource:'agent',resourceId:hidden.id,detail:{name:hidden.name}})
  await audit.log({userId,action:'agent.fixture',resource:'agent',resourceId:visible.id,detail:{name:visible.name}})
  const auditQuery=new AuditQueryService(db),auditRows=await auditQuery.list({userId,page:1,pageSize:10})
  assert.equal(auditRows.total,1);assert.equal(auditRows.items[0].resourceId,visible.id)
  const hiddenLog=await db.auditLog.findFirstOrThrow({where:{userId,resourceId:hidden.id}});await assert.rejects(()=>auditQuery.detail(hiddenLog.id))
  assert(!(await new DashboardService(db).recentActivity(100)).some(row=>row.id===hiddenLog.id));pass('审计列表、详情和首页最近流水隐藏旧内容，原始审计记录保留')
  const when=new Date(),payload=stripRetiredCapabilities({rankings:[{agent:hidden,runs:1},{agent:visible,runs:2}],audit:{detail:{key:hidden.key}},createdAt:when,message:'用户自由文本保留'})
  assert.equal(payload.rankings.length,1);assert.equal(payload.rankings[0].agent.id,visible.id);assert.equal(payload.audit.detail,null);assert.equal(payload.createdAt,when);assert(!JSON.stringify(payload).includes('editorial'));pass('后台历史排行榜和审计嵌套元数据兜底过滤，保留正常数据与日期')
 }finally{if(userId){await db.conversation.deleteMany({where:{userId}});await db.auditLog.deleteMany({where:{userId}})}await db.agent.deleteMany({where:{id:{in:agentIds}}});await db.skill.deleteMany({where:{id:{in:skillIds}}});if(userId)await db.user.delete({where:{id:userId}});await db.$disconnect()}
 const dir=resolve(root,'storage/shots/timetable');mkdirSync(dir,{recursive:true});writeFileSync(resolve(dir,'retired-backend.json'),JSON.stringify({checkedAt:new Date().toISOString(),checks,scope:'Actual local database; owned fixtures removed; historical data retained'},null,2))
}
main().catch(e=>{console.error(e);process.exitCode=1})
