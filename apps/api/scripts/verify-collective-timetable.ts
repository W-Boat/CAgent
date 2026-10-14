import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {resolve} from 'node:path'
import {Client} from 'pg'
import {PrismaClient} from '@prisma/client'
import {plainToInstance} from 'class-transformer'
import {validate} from 'class-validator'
import {ValidationPipe} from '@nestjs/common'
import {normalizeCourseCatalog,courseMeetings,matchesCourseConstraints} from '../src/knowledge/collective-timetable'
import {CollectiveTimetableService} from '../src/knowledge/collective-timetable.service'
import {CollectiveTimetableDto} from '../src/knowledge/knowledge.dto'
import {KnowledgeStoreService} from '../src/knowledge/knowledge-store.service'
import {CampusGuideService} from '../src/campus/campus-guide.service'
import {KnowledgeRetriever} from '../src/campus/knowledge-retriever'
const root=resolve(__dirname,'../../..'),checks:string[]=[],pass=(s:string)=>{checks.push(s);console.log('PASS '+s)}
async function main(){
 const input=JSON.parse(readFileSync(process.argv[2]||resolve(root,'knowledge/collective-timetable/catalog.json'),'utf8'))
 assert.equal((await validate(plainToInstance(CollectiveTimetableDto,input))).length,0)
 const pipe=new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true,transformOptions:{enableImplicitConversion:true}})
 const validated=await pipe.transform(input,{type:'body',metatype:CollectiveTimetableDto})
 assert.equal(validated.records.length,666);assert(!Array.isArray(validated.records[0]))
 await assert.rejects(()=>pipe.transform({...input,records:[null]},{type:'body',metatype:CollectiveTimetableDto}))
 await assert.rejects(()=>pipe.transform({...input,complete:'false'},{type:'body',metatype:CollectiveTimetableDto}))
 const catalog=normalizeCourseCatalog(input);assert.equal(input.records.length,666);assert.equal(catalog.items.length,667)
 assert(!JSON.stringify(catalog).includes('TeacherRollNumber'));assert(!JSON.stringify(catalog).includes('TakenCount'))
 assert.throws(()=>normalizeCourseCatalog({...input,records:[]}));assert.throws(()=>normalizeCourseCatalog({...input,semester:'2025'}));assert.throws(()=>normalizeCourseCatalog({...input,sourcePage:'file:///etc/passwd'}))
 pass('真实 666 条全校课程规范化，保留来源、学期和院系，移除教师工号与选课人数；拒绝非法导入')
 const pair=courseMeetings({DayOfWeek:'周二<br />周四',PatternTime:'09:00-10:00<br />14:00-15:00',WeekInfo:'1-16周单周',RoomName:'北综合楼201'})
 assert.equal(pair.length,2);assert(matchesCourseConstraints({semester:input.semester,meetings:pair},'第3周周四下午14:00有哪些课'))
 assert(!matchesCourseConstraints({semester:input.semester,meetings:pair},'第4周周四下午有哪些课'))
 assert(!matchesCourseConstraints({semester:input.semester,meetings:pair},'周二下午14:00有哪些课'))
 pass('多日、多时段与单双周联合匹配，防止把周二上午和周四下午交叉配对')
 const retriever=new KnowledgeRetriever(catalog.items as any)
 const result=retriever.search('周四下午有哪些课',{limit:20});assert(result.hits.length)
 assert(result.hits.every(h=>matchesCourseConstraints(h.row.extra.courseCatalog,'周四下午有哪些课')))
 assert(result.hits.every(h=>h.row.extra.courseCatalog.meetings.some(m=>m.weekday===4&&Number(m.start.split(':')[0])>=12&&Number(m.start.split(':')[0])<18)))
 assert(retriever.search('全校课表').hits[0].row.title.includes('概览'))
 assert(retriever.search('历史哲学课程安排',{limit:5}).hits.some(h=>h.row.extra.courseCatalog.name==='历史哲学'))
 assert.equal(retriever.search('2025-2026学年课程安排').hits.length,0)
 pass('真实索引按课程、星期/时段检索，不将本学期结果冒充其他学期')
 for(const line of readFileSync(resolve(root,'.env'),'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2]}
 const url=new URL(process.env.DATABASE_URL!);assert(['localhost','127.0.0.1','::1'].includes(url.hostname),'Verification stays local')
 const schema='verify_collective_'+Date.now(),pg=new Client({connectionString:url.href});await pg.connect();await pg.query(`CREATE SCHEMA "${schema}"`)
 url.searchParams.set('schema',schema);const db=new PrismaClient({datasources:{db:{url:url.href}}})
 try{
  await pg.query(`SET search_path TO "${schema}"`)
  const {readdirSync}=await import('node:fs')
  for(const name of readdirSync(resolve(root,'apps/api/prisma/migrations')).sort())if(/^\d/.test(name))await pg.query(readFileSync(resolve(root,'apps/api/prisma/migrations',name,'migration.sql'),'utf8'))
  const store=new KnowledgeStoreService(db as any,{} as any),service=new CollectiveTimetableService(db as any,store),guide=new CampusGuideService(db as any,store)
  const imported=await service.import(input);assert.equal(imported.indexed,667);assert.equal(imported.mounted,true)
  const hits=await guide.search('历史哲学课程安排','guide',5,{collection:'collective-timetable'});assert(hits.hits.some(h=>h.title.includes('历史哲学')))
  pass('实际数据库完整导入、自动挂载与现有校园检索联通')
  await db.knowledgeBase.update({where:{id:imported.baseId},data:{mounted:false}});await store.bump()
  const key='knowledge_shortcuts:'+imported.baseId;await db.setting.update({where:{key},data:{value:[{label:'自定义课表',question:'历史哲学课程安排',enabled:true,dependencies:[]}]}})
  await service.import(input);assert.equal(await db.campusGuideItem.count(),667);assert.equal((await db.knowledgeBase.findUnique({where:{id:imported.baseId}}))?.mounted,false)
  assert.equal((await db.setting.findUnique({where:{key}}))?.value?.[0]?.label,'自定义课表')
  assert(!(await store.publicShortcuts()).some(s=>s.label==='自定义课表'))
  assert.equal((await guide.search('历史哲学课程安排','guide',5,{collection:'collective-timetable'})).hits.length,0)
  pass('重复导入不重复、不恢复关闭开关、不覆盖按钮；停用后查询与快捷入口同步隐藏')
  await db.knowledgeBase.update({where:{id:imported.baseId},data:{kind:'REMOVED'}})
  await assert.rejects(()=>service.import(input))
  pass('已移除资料源禁止后台刷新时悄悄复活')
 }finally{await db.$disconnect();assert(/^verify_collective_\d+$/.test(schema));await pg.query(`DROP SCHEMA "${schema}" CASCADE`);await pg.end()}
 const out=resolve(root,'storage/shots/collective-timetable');mkdirSync(out,{recursive:true});writeFileSync(resolve(out,'verification.json'),JSON.stringify({passed:true,checkedAt:new Date().toISOString(),checks,records:catalog.items.length,scope:'Real source data; local isolated database; no model calls or production writes'},null,2))
}
main().catch(e=>{console.error(e);process.exitCode=1})
