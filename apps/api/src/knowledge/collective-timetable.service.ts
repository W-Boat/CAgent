import {BadRequestException,Injectable} from '@nestjs/common'
import {PrismaService} from '../prisma/prisma.service'
import {KnowledgeStoreService} from './knowledge-store.service'
import {sourceDefinition} from './embedded-knowledge'
import {normalizeCourseCatalog,COURSE_COLLECTION} from './collective-timetable'
@Injectable()
export class CollectiveTimetableService {
 constructor(private db:PrismaService,private store:KnowledgeStoreService){}
 async import(input:Parameters<typeof normalizeCourseCatalog>[0]){
  const catalog=normalizeCourseCatalog(input),definition=sourceDefinition(catalog.file,[COURSE_COLLECTION])
  return this.db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT pg_advisory_xact_lock(714020261014)::text`
   const existing=await tx.knowledgeBase.findUnique({where:{id:definition.id}})
   if(existing?.kind==='REMOVED')throw new BadRequestException('此课表知识库已移除，请先在后台恢复资料源')
   const collisions=await tx.campusGuideItem.findMany({where:{externalId:{in:catalog.items.map(r=>r.externalId)}},select:{id:true,externalId:true}}),byId=new Map(catalog.items.map(r=>[r.externalId,r.id]))
   if(collisions.some(r=>byId.get(r.externalId)!==r.id))throw new BadRequestException('知识库索引冲突，未修改旧资料')
   const base=await tx.knowledgeBase.upsert({where:{id:definition.id},create:{...definition,name:`集体课表 · ${catalog.semester}`,description:'全部课程安排快照；按院系、课程、周次、时间和教室查询，不代表个人选课。',lastSyncAt:new Date(catalog.capturedAt),syncStatus:'SUCCESS'},update:{lastSyncAt:new Date(catalog.capturedAt),syncStatus:'SUCCESS',syncError:null}})
   for(const item of catalog.items)await tx.campusGuideItem.upsert({where:{id:item.id},create:item as any,update:item as any})
   const removed=await tx.campusGuideItem.deleteMany({where:{extra:{path:['kb','file'],equals:catalog.file},id:{notIn:catalog.items.map(r=>r.id)}}})
   const summary={rawCount:catalog.rawCount,indexed:catalog.items.length,removed:removed.count,semester:catalog.semester,capturedAt:catalog.capturedAt}
   await tx.knowledgeBase.update({where:{id:base.id},data:{lastSyncSummary:summary}})
   await tx.setting.upsert({where:{key:'knowledge_shortcuts:'+base.id},create:{key:'knowledge_shortcuts:'+base.id,group:'campus',value:[{label:'集体课表',question:'请查询本学期全校课程安排，可按课程、院系、周次和教室检索',enabled:true,dependencies:[]}]},update:{}})
   await this.store.bump(tx)
   return {baseId:base.id,mounted:base.mounted,...summary}
  },{timeout:120000})
 }
}
