import 'reflect-metadata'
import assert from 'node:assert/strict'
import {readFileSync,readdirSync} from 'node:fs'
import {resolve} from 'node:path'
import {Client} from 'pg'
import {PrismaService} from '../src/prisma/prisma.service'
import {KnowledgeStoreService} from '../src/knowledge/knowledge-store.service'
import {CampusGuideService} from '../src/campus/campus-guide.service'
import {LecturesService,LECTURE_BASE} from '../src/lectures/lectures.service'
import {collectorSchema,defaultCollectorConfig,filterLectures,dateOnly,lectureUrl,normalizeLecture} from '../src/lectures/lecture-data'
import {publicAddress,parseLectureDetail,parseLectureListing,crawlLectures} from '../src/lectures/lecture-crawler'
import {AgentRuntime} from '../src/chat/runtime/agent-runtime'
import {lectureToolDefinition,lectureIntent} from '../src/lectures/lecture-tool'
const root=resolve(__dirname,'../../..'),checks:string[]=[],pass=(s:string)=>{checks.push(s);console.log('PASS '+s)}
async function main(){
 const packet=JSON.parse(readFileSync(resolve(root,'knowledge/lectures/lectures.json'),'utf8')),rows=packet.lectures.map(normalizeLecture)
 assert.equal(rows.length,1189);assert.equal(new Set(rows.map(l=>l.id)).size,1189)
 assert.equal(dateOnly('2026-02-30'),'');assert.equal(dateOnly('2026-10-29'),'2026-10-29')
 for(const url of ['http://sg.ucass.edu.cn/x','https://ucass.edu.cn.evil.test/','https://name:password@sg.ucass.edu.cn/x','https://127.0.0.1/x'])assert.equal(lectureUrl(url),null)
 for(const ip of ['127.0.0.1','10.27.88.8','169.254.169.254','172.20.0.1','192.168.1.1','::1','::ffff:127.0.0.1','fc00::1'])assert(!publicAddress(ip))
 assert(publicAddress('223.5.5.5'));assert(!collectorSchema.safeParse({...defaultCollectorConfig(),maxPages:500}).success)
 pass('1189 条真实记录、稳定唯一 ID、无效日期/URL/私网访问和采集预算校验')
 const listing=parseLectureListing('<ul><li><a href="/info/1149/5290.htm" title="讲座预告：校园测试">查看</a>2026-10-22</li><li><a href="/info/1149/9999.htm">招聘通知</a></li></ul>','https://sg.ucass.edu.cn/index/ygtz.htm','filter')
 assert.equal(listing.items.length,1);assert.equal(listing.items[0].published,'2026-10-22')
 const detail=parseLectureDetail('<h1>讲座预告：校园测试</h1><article><p>讲座时间：2026年11月2日 下午14:00</p><p>地点：良乡校区教学楼123</p><p>主讲人：张老师</p><script>alert(1)</script></article>',listing.items[0],{id:'sg',name:'政府管理学院'})
 assert.equal(detail.event_date,'2026-11-02');assert.equal(detail.speaker,'张老师');assert.equal(detail.campus,'良乡校区');assert(!detail.excerpt.includes('alert'))
 const undated=parseLectureDetail('<h1>讲座回顾</h1><article>发布日期：2026-10-22，相关研究于1998年发表。</article>',listing.items[0],{id:'sg',name:'学院'})
 assert.equal(undated.event_date,'');assert.equal(undated.content_kind,'review')
 const navigation=parseLectureDetail('<h1>下一篇：另外一篇讲座</h1><h2>上一篇：另一个活动</h2><article>这里是当前讲座正文</article>',listing.items[0],{id:'sg',name:'学院'})
 assert.equal(navigation.title,listing.items[0].title)
 const realTitle=parseLectureDetail('<title>讲座预告 | 孟强：技术创造人-中国社会科学院大学哲学院</title><h1>内容简介</h1><article>2026年10月28日，学院举办技术主题讲座。</article>',listing.items[0],{id:'sg',name:'学院'})
 assert.equal(realTitle.title,'讲座预告 | 孟强：技术创造人');assert.equal(realTitle.event_date,'2026-10-28')
 assert.throws(()=>parseLectureListing('<h1>Please enable JavaScript and refresh the page.</h1>',listing.items[0].url,'filter'),/验证/)
 assert.throws(()=>parseLectureDetail('<body>当前环境异常，完成验证后即可继续访问。去验证</body>',listing.items[0],{id:'sg',name:'学院'}),/验证/)
 assert.throws(()=>parseLectureDetail('<body>公众号目录只有标题，并没有文章正文。</body>',{...listing.items[0],url:'https://mp.weixin.qq.com/s/test'},{id:'sg',name:'学院'}),/正文不可读/)
 assert.equal(filterLectures([detail,undated],{scope:'upcoming'},'2026-10-29').length,1)
 assert.equal(filterLectures([detail,undated],{scope:'undated'},'2026-10-29').length,1)
 assert.equal(filterLectures(rows,{month:'2026-10'}).some(l=>!l.event_date.startsWith('2026-10')),false)
 pass('列表/详情解析，预告与回顾区分，发布日期不冒充活动日期，月历/未定日期/将来预告筛选')
 for(const line of readFileSync(resolve(root,'.env'),'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2]}
 const url=new URL(process.env.DATABASE_URL!);assert(['127.0.0.1','localhost'].includes(url.hostname),'Local DB only')
 const schema='verify_lectures_'+Date.now(),pg=new Client({connectionString:url.href});await pg.connect();await pg.query(`CREATE SCHEMA "${schema}"`)
 url.searchParams.set('schema',schema);process.env.DATABASE_URL=url.href
 const db=new PrismaService(),store=new KnowledgeStoreService(db,{} as any),service=new LecturesService(db,store),guide=new CampusGuideService(db,store)
 try{
  await pg.query(`SET search_path TO "${schema}"`)
  for(const name of readdirSync(resolve(root,'apps/api/prisma/migrations')).sort())if(/^\d/.test(name))await pg.query(readFileSync(resolve(root,'apps/api/prisma/migrations',name,'migration.sql'),'utf8'))
  let total=0;for(let i=0;i<packet.lectures.length;i+=100)total+=(await service.importRecords(packet.lectures.slice(i,i+100))).created
  assert.equal(total,1189);assert.equal((await service.directory({})).counts.all,1189)
  const search=await guide.search(rows[0].title,'guide',5,{collection:'lectures'});assert(search.hits.some(h=>h.id===rows[0].id))
  pass('独立真实 PostgreSQL schema 全量导入与现有知识检索联通')
  assert(lectureIntent('今天有哪些校园讲座'));assert(lectureIntent('打开讲座日历'));assert(await service.available())
  let modelRound=0,toolRuns=0
  const runtime=await new AgentRuntime().run({provider:{type:'OPENAI_COMPATIBLE',async *stream(options){
   if(++modelRound===1){assert(options.tools?.some(t=>t.name==='campus_lectures'));yield {type:'tool_call',call:{id:'lecture-test',name:'campus_lectures',arguments:JSON.stringify({month:'2026-10',scope:'all'})}}}
   else{const result=JSON.parse(options.messages.filter(m=>m.role==='tool').at(-1)!.content as string);assert(result.total>0);assert.equal(result.calendarPath,'/lectures?month=2026-10');yield {type:'text',text:'请点击讲座日历查看当月活动，具体信息以原通知为准。'}}
   yield {type:'done'}
  }},request:{model:'fixture-only',apiKey:'fixture-only',maxTokens:256},messages:[{role:'user',content:'查询2026年10月讲座日历'}],tools:[{...lectureToolDefinition,execute:async args=>{toolRuns++;return JSON.stringify(await service.agentSearch(args))}}],contextWindow:8192,maxToolRounds:3,signal:new AbortController().signal,emit:()=>{}})
  assert.equal(toolRuns,1);assert.equal(runtime.tools[0].status,'SUCCESS');assert(runtime.text.includes('讲座日历'))
  assert((await store.publicShortcuts()).some(s=>s.label==='讲座日历'&&(s as any).url==='/lectures'))
  await db.knowledgeBase.update({where:{id:LECTURE_BASE},data:{agentId:'restricted-agent'}})
  assert(!await service.available());assert.equal((await service.agentSearch({scope:'all'})).enabled,false)
  assert.equal((await service.agentSearch({scope:'all'},'restricted-agent')).enabled,true)
  await db.knowledgeBase.update({where:{id:LECTURE_BASE},data:{agentId:null}})
  pass('AgentRuntime真实工具调用闭环（模拟模型、真实讲座服务），日期筛选与日历链接返回，快捷按钮和Agent范围隔离')
  const revision=await store.revision(),again=await service.importRecords(packet.lectures.slice(0,100));assert.equal(again.created+again.changed,0);assert.equal(again.skipped,100);assert.equal(await store.revision(),revision)
  await service.importRecords([{...packet.lectures[0],speaker:'已更新主讲人'}]);assert.equal((await service.detail(rows[0].id)).speaker,'已更新主讲人')
  await service.importRecords([{...packet.lectures[0],speaker:''}]);assert.equal((await service.detail(rows[0].id)).speaker,'已更新主讲人')
  assert.equal(await db.campusGuideItem.count(),1189)
  await assert.rejects(()=>service.importRecords([packet.lectures[0],{title:'bad',url:'http://localhost'}]))
  pass('重复导入不刷新检索修订，不重复；更新和部分字段补全保留；坏批次原子拒绝')
  const month=await service.directory({month:'2026-10'}),day=Object.keys(month.days)[0],one=await service.directory({month:'2026-10',date:day})
  assert(one.items.every(i=>i.event_date===day));assert.deepEqual(one.days,month.days)
  await db.knowledgeBase.update({where:{id:LECTURE_BASE},data:{mounted:false}});await store.bump()
  assert.equal((await service.directory({})).enabled,false);await assert.rejects(()=>service.detail(rows[0].id))
  assert(!await service.available());assert.equal((await service.agentSearch({scope:'all'})).items.length,0)
  assert(!(await store.publicShortcuts()).some(s=>s.label==='讲座日历'))
  assert.equal((await guide.search(rows[0].title,'guide',5,{collection:'lectures'})).hits.length,0)
  await service.importRecords([packet.lectures[0]]);assert.equal((await db.knowledgeBase.findUnique({where:{id:LECTURE_BASE}}))?.mounted,false)
  await db.knowledgeBase.update({where:{id:LECTURE_BASE},data:{kind:'REMOVED'}});await assert.rejects(()=>service.importRecords([packet.lectures[0]]))
  pass('日历日期筛选不丢其他日期数量；关闭同时屏蔽日历/详情/RAG；导入不恢复关闭或移除的库')
 }finally{await db.$disconnect();await pg.query('SET search_path TO public');assert(/^verify_lectures_\d+$/.test(schema));await pg.query(`DROP SCHEMA "${schema}" CASCADE`);await pg.end()}
 if(process.argv.includes('--live')){
  const config=defaultCollectorConfig();config.campusNetwork=true;config.sources=config.sources.filter(s=>s.id==='sg-1')
  const result=await crawlLectures(config,true);console.log(JSON.stringify({live:{records:result.records.map(r=>({title:r.title,event_date:r.event_date,url:r.url})),warnings:result.warnings,scanned:result.scanned}}))
 }
 console.log(JSON.stringify({passed:true,checks}))
}
main().catch(e=>{console.error(e);process.exitCode=1})
