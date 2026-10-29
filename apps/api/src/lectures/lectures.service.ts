import {BadRequestException,Injectable,NotFoundException,Logger} from '@nestjs/common'
import {Interval} from '@nestjs/schedule'
import {PrismaService} from '../prisma/prisma.service'
import {KnowledgeStoreService} from '../knowledge/knowledge-store.service'
import {sourceDefinition} from '../knowledge/embedded-knowledge'
import {collectorSchema,defaultCollectorConfig,filterLectures,LECTURE_FILE,LECTURE_COLLECTION,lectureRow,normalizeLecture,shanghaiToday,type Lecture} from './lecture-data'
import {crawlLectures} from './lecture-crawler'

export const LECTURE_BASE=sourceDefinition(LECTURE_FILE,[LECTURE_COLLECTION]).id
const CONFIG_KEY='lecture_collector_config'
@Injectable()
export class LecturesService {
 private logger=new Logger(LecturesService.name)
 private cache?:{revision:unknown;expires:number;rows:Lecture[]}
 private scheduledBusy=false
 constructor(private db:PrismaService,private store:KnowledgeStoreService){}
 async config(){const setting=await this.db.setting.findUnique({where:{key:CONFIG_KEY}});return collectorSchema.parse((setting?.value as any)?.config||defaultCollectorConfig())}
 async status(){const base=await this.db.knowledgeBase.findUnique({where:{id:LECTURE_BASE}});return {enabled:!!base?.mounted&&base.kind!=='REMOVED',status:base?.syncStatus||'IDLE',lastSyncAt:base?.lastSyncAt||null,error:base?.syncError||null,summary:base?.lastSyncSummary||null,baseId:LECTURE_BASE}}
 async saveConfig(input:unknown,operator:{id:string;email:string}){
  const parsed=collectorSchema.safeParse(input);if(!parsed.success)throw new BadRequestException(parsed.error.issues.map(i=>i.message).join('；'))
  await this.db.$transaction(async tx=>{
   await tx.setting.upsert({where:{key:CONFIG_KEY},create:{key:CONFIG_KEY,group:'campus',value:{config:parsed.data,operatorId:operator.id}},update:{value:{config:parsed.data,operatorId:operator.id}}})
   await tx.auditLog.create({data:{userId:operator.id,actor:operator.email,action:'lectures.collector.configure',resource:'knowledge_base',resourceId:LECTURE_BASE,detail:{enabled:parsed.data.enabled,sources:parsed.data.sources.length}}})
  });return parsed.data
 }
 async importRecords(records:unknown[],capturedAt=new Date().toISOString(),operator?:{id:string;email:string}){
  if(!Array.isArray(records)||!records.length||records.length>200)throw new BadRequestException('每批请导入 1–200 条讲座')
  const captured=new Date(capturedAt);if(!Number.isFinite(captured.getTime())||captured.getTime()>Date.now()+300000)throw new BadRequestException('采集时间无效')
  let normalized:Lecture[];try{normalized=[...new Map(records.map(r=>{const l=normalizeLecture(r);return [l.id,l]})).values()]}catch(e){throw new BadRequestException((e as Error).message)}
  return this.db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT pg_advisory_xact_lock(714020261029)::text`
   const existing=await tx.knowledgeBase.findUnique({where:{id:LECTURE_BASE}})
   if(existing?.kind==='REMOVED')throw new BadRequestException('讲座知识库已移除，不会被采集任务自动恢复')
   const base=await tx.knowledgeBase.upsert({where:{id:LECTURE_BASE},create:{...sourceDefinition(LECTURE_FILE,[LECTURE_COLLECTION]),name:'校园讲座聚合库',description:'公开讲座、学术沙龙与活动回顾；支持日历和按校区、日期、来源检索。',lastSyncAt:captured},update:{}})
   let created=0,changed=0,skipped=0
   for(let lecture of normalized){
    const old=await tx.campusGuideItem.findUnique({where:{id:lecture.id}}),previous=(old?.extra as any)?.lecture as Lecture|undefined
    if(previous){
     // A partially fetched page cannot erase previously captured facts.
     lecture={...previous,...Object.fromEntries(Object.entries(lecture).filter(([key,value])=>value!==''&&!(key==='campus'&&value==='未注明'&&previous.campus)))}
     if(JSON.stringify(lecture)===JSON.stringify(previous)){skipped++;continue}
    }
    const row=lectureRow(lecture,captured.toISOString()),collision=await tx.campusGuideItem.findUnique({where:{externalId:row.externalId},select:{id:true}})
    if(collision&&collision.id!==row.id)throw new BadRequestException('讲座索引冲突，本批未写入，请联系管理员')
    await tx.campusGuideItem.upsert({where:{id:row.id},create:row,update:row});old?changed++:created++
   }
   if(created||changed){await this.store.bump(tx);this.cache=undefined}
   await tx.knowledgeBase.update({where:{id:base.id},data:{lastSyncAt:captured}})
   if(operator)await tx.auditLog.create({data:{userId:operator.id,actor:operator.email,action:'lectures.import',resource:'knowledge_base',resourceId:base.id,detail:{created,changed,skipped}}})
   return {baseId:base.id,mounted:base.mounted,created,changed,skipped,total:normalized.length}
  },{timeout:120000})
 }
 async available(agentId?:string|null){const base=await this.db.knowledgeBase.findUnique({where:{id:LECTURE_BASE}});return !!base?.mounted&&base.kind!=='REMOVED'&&(!base.agentId||base.agentId===agentId)}
 async agentSearch(input:Record<string,unknown>,agentId?:string|null){
  const query:Record<string,string>={}
  for(const key of ['q','date','month','campus','scope'])if(typeof input[key]==='string')query[key]=String(input[key]).slice(0,100)
  if(!['all','upcoming','undated'].includes(query.scope))query.scope='upcoming'
  const result=await this.directory(query,agentId)
  return {enabled:result.enabled,today:result.today,total:result.total,calendarPath:'/lectures'+(query.month?'?month='+encodeURIComponent(query.month):''),
   notice:'这是资料快照，历史记录和回顾不代表仍可报名。可点击输入框上方的讲座日历按钮查看；没有匹配的待开展预告时应如实说明。',
   items:result.items.slice(0,5).map(l=>({id:l.id,title:l.title,date:l.event_date,time:l.time_text,location:l.location,campus:l.campus,speaker:l.speaker,kind:l.content_kind,url:l.url,source:l.source_name}))}
 }
 private async snapshot(agentId?:string|null){
  const base=await this.db.knowledgeBase.findUnique({where:{id:LECTURE_BASE}})
  if(!base||!base.mounted||base.kind==='REMOVED'||base.agentId&&base.agentId!==agentId)return {enabled:false,rows:[] as Lecture[],updatedAt:null as Date|null}
  const revision=await this.store.revision()
  if(this.cache?.revision===revision&&this.cache.expires>Date.now())return {enabled:true,rows:this.cache.rows,updatedAt:base.lastSyncAt}
  const raw=await this.db.campusGuideItem.findMany({where:{extra:{path:['kb','file'],equals:LECTURE_FILE}},select:{extra:true}})
  const rows=raw.flatMap(r=>{const l=(r.extra as any)?.lecture;return l?[l as Lecture]:[]})
  this.cache={revision,expires:Date.now()+60000,rows};return {enabled:true,rows,updatedAt:base.lastSyncAt}
 }
 async directory(query:Record<string,string>,agentId?:string|null){
  const {enabled,rows,updatedAt}=await this.snapshot(agentId),today=shanghaiToday(),filtered=filterLectures(rows,query,today)
  const page=Math.max(1,Math.min(10000,Math.trunc(Number(query.page)||1))),pageSize=20,days:Record<string,number>={}
  for(const l of filterLectures(rows,{...query,date:''},today))if(l.event_date)days[l.event_date]=(days[l.event_date]||0)+1
  const counts={all:rows.length,upcoming:rows.filter(l=>l.content_kind==='preview'&&l.event_date>=today).length,undated:rows.filter(l=>!l.event_date).length}
  return {enabled,today,updatedAt,counts,total:filtered.length,page,pageSize,days,
   sources:[...new Map(rows.map(l=>[l.source_id,{id:l.source_id,name:l.source_name}])).values()],campuses:[...new Set(rows.map(l=>l.campus))].sort(),types:[...new Set(rows.map(l=>l.type))].sort(),
   items:filtered.slice((page-1)*pageSize,page*pageSize).map(({excerpt,...l})=>l)}
 }
 async detail(id:string){const {rows}=await this.snapshot(),item=rows.find(l=>l.id===id);if(!item)throw new NotFoundException('讲座不存在或知识库已关闭');return item}
 async test(input:unknown){const parsed=collectorSchema.safeParse(input);if(!parsed.success)throw new BadRequestException('采集配置无效');return crawlLectures(parsed.data,true)}
 async queue(operator:{id:string;email:string},automatic=false){
  const config=await this.config();if(!config.sources.some(s=>s.enabled))throw new BadRequestException('请至少开启一个信息源')
  await this.db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT pg_advisory_xact_lock(714020261029)::text`
   const base=await tx.knowledgeBase.findUnique({where:{id:LECTURE_BASE}})
   if(!base||base.kind==='REMOVED')throw new BadRequestException('请先导入讲座库，已移除的知识库不能自动恢复')
   if(base.syncStatus==='SYNCING'&&base.updatedAt.getTime()>Date.now()-600000)throw new BadRequestException('采集任务正在运行')
   await tx.knowledgeBase.update({where:{id:LECTURE_BASE},data:{syncStatus:'SYNCING',syncError:null,lastSyncSummary:{startedAt:new Date().toISOString(),scanned:0,collected:0,automatic,nextSource:Number((base.lastSyncSummary as any)?.nextSource)||0}}})
   await tx.auditLog.create({data:{userId:operator.id,actor:operator.email,action:'lectures.collector.start',resource:'knowledge_base',resourceId:LECTURE_BASE,detail:{automatic}}})
  })
  void this.collect(config).catch(()=>this.logger.warn('讲座采集失败，状态已记录'))
  return {queued:true,baseId:LECTURE_BASE}
 }
 private async collect(config:Awaited<ReturnType<LecturesService['config']>>){
  try{
   const base=await this.db.knowledgeBase.findUnique({where:{id:LECTURE_BASE}})
   const result=await crawlLectures(config,false,undefined,Number((base?.lastSyncSummary as any)?.nextSource)||0),summary={scanned:result.scanned,collected:result.records.length,warnings:result.warnings,limited:result.limited,nextSource:result.nextSource,finishedAt:new Date().toISOString(),created:0,changed:0,skipped:0}
   if(result.records.length){const imported=await this.importRecords(result.records);Object.assign(summary,{created:imported.created,changed:imported.changed,skipped:imported.skipped})}
   await this.db.knowledgeBase.updateMany({where:{id:LECTURE_BASE,kind:{not:'REMOVED'}},data:{syncStatus:!result.records.length?'FAILED':result.warnings.length?'PARTIAL':'SUCCESS',syncError:result.records.length?null:'未采集到有效文章，请先测试信息源；原有资料已保留',lastSyncSummary:summary,lastSyncAt:new Date()}})
  }catch{
   await this.db.knowledgeBase.updateMany({where:{id:LECTURE_BASE,kind:{not:'REMOVED'}},data:{syncStatus:'FAILED',syncError:'采集或导入失败，已有资料保留，请检查信息源后重试',lastSyncSummary:{finishedAt:new Date().toISOString()}}});throw new Error('采集失败')
  }
 }
 @Interval(60000) async scheduled(){
  if(this.scheduledBusy)return;this.scheduledBusy=true
  try{
   const config=await this.config();if(!config.enabled)return
   const base=await this.db.knowledgeBase.findUnique({where:{id:LECTURE_BASE}})
   if(!base||!base.mounted||base.kind==='REMOVED'||base.syncStatus==='SYNCING'&&base.updatedAt.getTime()>Date.now()-600000)return
   const summary=base.lastSyncSummary as any,last=Date.parse(summary?.finishedAt||summary?.startedAt||'')||base.lastSyncAt?.getTime()||0
   if(Date.now()-last<config.intervalMinutes*60000)return
   const setting=await this.db.setting.findUnique({where:{key:CONFIG_KEY}}),id=(setting?.value as any)?.operatorId
   if(!id)return
   const user=await this.db.user.findFirst({where:{id,status:'ACTIVE'},include:{roles:{include:{role:{include:{permissions:{include:{permission:true}}}}}}}})
   if(user?.roles.some(r=>r.role.permissions.some(p=>['*','campus:admin'].includes(p.permission.code))))await this.queue({id:user.id,email:user.email},true)
  }catch{this.logger.warn('讲座采集轮询未完成，将于下一轮检查')}finally{this.scheduledBusy=false}
 }
}
