import 'reflect-metadata'
import assert from 'node:assert/strict'
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {JwtService} from '@nestjs/jwt'
import {PrismaService} from '../src/prisma/prisma.service'
import {AuditService} from '../src/common/services/audit.service'
import {KnowledgeStoreService} from '../src/knowledge/knowledge-store.service'
import {CampusGuideService} from '../src/campus/campus-guide.service'
import {CampusActivityService,activityDay,activitySince,activityUrl} from '../src/campus/campus-activity.service'
import {SkillsEngineService} from '../src/skills/skills-engine.service'
const root=resolve(__dirname,'../../..'),checks:string[]=[]
for(const line of readFileSync(resolve(root,'.env'),'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2]}
assert(['localhost','127.0.0.1'].includes(new URL(process.env.DATABASE_URL!).hostname),'仅允许本地验证')
const prisma=new PrismaService(),jwt=new JwtService({secret:'isolated-activity-test'}),activity=new CampusActivityService(prisma,jwt),store=new KnowledgeStoreService(prisma,new AuditService(prisma)),guide=new CampusGuideService(prisma,store)
const pass=(s:string)=>{checks.push(s);console.log('PASS '+s)}
let userId='',baseId='',privateBaseId='',agentId=''
async function main(){
 assert.equal(activityDay(new Date('2026-10-04T16:01:00Z')),'2026-10-05')
 assert.equal(new Date(activitySince(7).getTime()+8*3600000).getUTCHours(),0)
 assert.equal(activityUrl('javascript:alert(1)'),'')
 assert.equal(activityUrl('https://user:pass@example.invalid'),'')
 assert(!activityUrl('https://example.invalid?token=secret&a=1').includes('secret'))
 pass('北京时间日期与统计零点一致，拒绝非网页链接与嵌入凭据，移除敏感 URL 参数')
 const stamp=Date.now().toString(36),user=await prisma.user.create({data:{email:'activity-'+stamp+'@example.invalid',name:'活动验证',passwordHash:'disabled'}});userId=user.id
 const op={id:userId,email:user.email},base=await prisma.knowledgeBase.create({data:{name:'activity-'+stamp,mounted:true}});baseId=base.id
 for(const mode of ['RAG','FIXED','CORRECTION','TRIGGER'])await store.save({baseId,title:mode+'-activity-'+stamp,answer:mode==='TRIGGER'?JSON.stringify({version:1,any:['活动验证'],behavior:'REPLACE',text:'固定说明',card:{type:'facts',title:'校园信息',items:[{label:'说明',value:'验证'}]}}):'### 校园知识\n已确认的验证内容',mode,status:'APPROVED'},op)
 await store.save({baseId,title:'draft-'+stamp,answer:'不可公开',mode:'RAG',status:'DRAFT'},op)
 const catalog=await guide.library({collection:'base:'+baseId,pageSize:2})
 assert.equal(catalog.total,4);assert.equal(catalog.items.length,2)
 const ruleList=await guide.library({collection:'base:'+baseId,format:'rule'})
 assert.equal(ruleList.total,1)
 const rule=await guide.detail(ruleList.items[0].id)
 assert(rule.detail?.includes('```card'));assert(rule.detail?.includes('固定说明'))
 const agent=await prisma.agent.create({data:{key:'activity-'+stamp,name:'隔离验证',systemPrompt:'测试',ownerId:userId,visibility:'PRIVATE'}});agentId=agent.id
 const privateBase=await prisma.knowledgeBase.create({data:{name:'private-'+stamp,mounted:true,agentId}});privateBaseId=privateBase.id
 const privateEntry=await store.save({baseId:privateBaseId,title:'private-'+stamp,answer:'隔离内容',mode:'FIXED',status:'APPROVED'},op)
 assert.equal((await guide.library({collection:'base:'+privateBaseId})).total,0)
 assert.equal((await guide.library({collection:'base:'+privateBaseId},true)).total,1)
 await assert.rejects(()=>guide.detail('managed:'+privateEntry.id))
 assert((await guide.detail('managed:'+privateEntry.id,true)).detail?.includes('隔离内容'))
 await prisma.knowledgeBase.update({where:{id:baseId},data:{mounted:false}});await store.bump()
 assert.equal((await guide.library({collection:'base:'+baseId})).total,0)
 await prisma.knowledgeBase.update({where:{id:baseId},data:{mounted:true}});await store.bump()
 pass('知识目录按形式分页，固定问答/纠错/规则可读；草稿、卸载与 Agent 隔离生效')
 const before=await activity.stats(7),token=await jwt.signAsync({sub:userId,type:'access'})
 const dto={requestId:stamp,eventType:'LINK_CLICK',origin:'student-chat',title:'验证入口',url:'https://example.invalid/campus'}
 assert((await activity.client(dto,'Bearer '+token,'isolated')).recorded)
 assert(!(await activity.client(dto,'Bearer '+token,'isolated')).recorded)
 await assert.rejects(()=>activity.client({...dto,requestId:'bad'},'Bearer invalid','isolated'))
 await activity.write({userId,eventType:'CONTENT_VIEW',origin:'campus-guide',entryId:'fixture',title:'知识正文'})
 await activity.write({eventType:'MAP_VIEW',origin:'trial-chat',entryId:'verify:'+stamp,collection:'maps',title:'公开地图'})
 const sources=[{id:'fixture',title:'验证知识',collection:'activity-test',source:'验证',summary:'',used:false}]
 await activity.chat(userId,'admin-chat',stamp,'验证查询',sources,false)
 await activity.chat(userId,'admin-chat',stamp,'验证查询',[{...sources[0],used:true}],true)
 const after=await activity.stats(7)
 assert.equal((after.trend.find(r=>r.date===activityDay()) as any).QUERY-(before.trend.find(r=>r.date===activityDay()) as any).QUERY,1)
 assert.equal(after.queries-before.queries,1);assert.equal(after.linkClicks-before.linkClicks,1);assert.equal(after.contentViews-before.contentViews,1);assert.equal(after.mapViews-before.mapViews,1)
 assert.equal(after.byCollection.find(r=>r.collection==='activity-test')?.used,1)
 assert.equal((await activity.list({keyword:'验证查询',eventType:'QUERY'})).items[0].resultCount,1)
 assert.equal((await activity.list({keyword:'验证入口',eventType:'LINK_CLICK'})).items[0].user?.id,userId)
 pass('实际数据库记录查询/阅读/跳转/地图，重复上报与查询终态不重复计数，鉴权和引用统计正确')
 const report={requestId:'render-'+stamp,eventType:'RENDER_ERROR',origin:'student-chat',component:'agent-ui',errorType:'schema',retryMode:'automatic',attempt:1,messageId:'fixture-message'}
 assert((await activity.client(report,'Bearer '+token,'isolated')).recorded);assert(!(await activity.client(report,'Bearer '+token,'isolated')).recorded)
 assert((await activity.client({...report,requestId:'recovered-'+stamp,eventType:'RENDER_RECOVERED',retryMode:'manual',attempt:2},'Bearer '+token,'isolated')).recorded)
 const errors=await activity.list({eventType:'RENDER_ERROR',keyword:'agent-ui'}),reported=errors.items.find((v:any)=>v.userId===userId);assert(reported);assert.equal((reported.references as any)[0].errorType,'schema');assert.equal((reported.references as any)[0].attempt,1);assert(!JSON.stringify(reported.references).includes('answer'))
 const reportStats=await activity.stats(7);assert.equal(reportStats.renderErrors-(after.renderErrors||0),1);assert.equal(reportStats.renderRecovered-(after.renderRecovered||0),1);assert.equal(reportStats.queries,after.queries);assert.equal(reportStats.linkClicks,after.linkClicks)
 pass('渲染错误/恢复上报保存脱敏诊断、去重与管理员过滤；单独统计不增加知识查询/跳转量')
 const skills:any=Object.create(SkillsEngineService.prototype)
 skills.prisma={skill:{findMany:async()=>[{id:'old1',key:'ucass-kb-survival',name:'辛瓜',enabled:true,type:'TOOL',category:'校园知识库'},{id:'old2',key:'ucass-kb-takeout',enabled:true,type:'TOOL',category:'校园知识库'},{id:'tool',key:'knowledge_search',enabled:true,type:'TOOL',description:'统一检索'}]}}
 assert.equal((await skills.available(['*'])).length,1)
 assert.equal((await skills.buildToolDefs(['old1','old2','tool'],['*'])).length,1)
 pass('辛瓜与外卖不会出现在可用技能或模型工具定义，统一检索工具保留')
} 
main().finally(async()=>{
 if(userId){const user=await prisma.user.findUnique({where:{id:userId}});const stamp=user?.email.match(/^activity-([^@]+)@/)?.[1];await prisma.campusActivity.deleteMany({where:{OR:[{userId},...(stamp?[{entryId:'verify:'+stamp}]:[])]}})}
 for(const id of [baseId,privateBaseId])if(id)await prisma.knowledgeBase.deleteMany({where:{id}})
 if(agentId)await prisma.agent.deleteMany({where:{id:agentId}})
 if(userId)await prisma.user.deleteMany({where:{id:userId}})
 await store.bump();await prisma.$disconnect()
 mkdirSync(resolve(root,'storage/shots/campus'),{recursive:true})
 writeFileSync(resolve(root,'storage/shots/campus/activity-integration.json'),JSON.stringify({checkedAt:new Date().toISOString(),checks,transport:'Actual local PostgreSQL and services'},null,2))
}).catch(e=>{console.error(e);process.exitCode=1})
