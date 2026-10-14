import {createHash} from 'node:crypto'
import {load} from 'cheerio'
import {BadRequestException} from '@nestjs/common'

export const COURSE_COLLECTION='collective-timetable'
const plain=(value:unknown,max=2000)=>load('<div>'+String(value??'')+'</div>').text().normalize('NFKC').replace(/\s+/g,' ').trim().slice(0,max)
const parts=(value:unknown)=>String(value??'').split(/<br\s*\/?\s*>|\r?\n/i).map(v=>plain(v))
const clock=(value:string)=>{const [h,m]=value.split(':').map(Number);return h>=0&&h<=23&&m>=0&&m<=59?h*60+m:NaN}
export interface CourseMeeting {weekday:number;weeks:number[];start:string;end:string;room:string}
export function courseMeetings(row:Record<string,unknown>):CourseMeeting[]{
 const days=parts(row.DayOfWeek),times=parts(row.PatternTime),weeks=parts(row.WeekInfo),rooms=parts(row.RoomName)
 const length=Math.max(days.length,times.length,weeks.length,rooms.length),at=(a:string[],i:number)=>a.length===1?a[0]:a[i]||''
 const result:CourseMeeting[]=[]
 for(let i=0;i<length;i++){
  const day=at(days,i).match(/(?:周|星期)([一二三四五六日天1-7])/),time=at(times,i).match(/(\d{1,2}:\d{2})\s*[-–—~～至]+\s*(\d{1,2}:\d{2})/)
  if(!day||!time||!Number.isFinite(clock(time[1]))||!Number.isFinite(clock(time[2]))||clock(time[1])>=clock(time[2]))continue
  const weekday=/\d/.test(day[1])?Number(day[1]):Math.min(7,'一二三四五六日天'.indexOf(day[1])+1),text=at(weeks,i),values=new Set<number>()
  for(const match of text.matchAll(/(\d+)(?:\s*[-–—~～至]\s*(\d+))?/g)){
   const lo=Number(match[1]),hi=Number(match[2]||lo)
   if(lo<1||hi>30||lo>hi)throw new BadRequestException('课程周次超出 1–30 周')
   for(let w=lo;w<=hi;w++)if(!/单/.test(text)||w%2===1)if(!/双/.test(text)||w%2===0)values.add(w)
  }
  if(values.size)result.push({weekday,weeks:[...values].sort((a,b)=>a-b),start:time[1].padStart(5,'0'),end:time[2].padStart(5,'0'),room:at(rooms,i)})
 }
 return result
}
export function courseConstraints(query:string){
 const day=query.match(/(?:周|星期)([一二三四五六日天1-7])/),time=query.match(/\b(\d{1,2}:\d{2})\b/),week=query.match(/第\s*(\d+)\s*周/),term=query.match(/20\d{2}-20\d{2}/),section=query.match(/课序号\s*(?:为|[:：])?\s*([0-9]+)/),code=query.match(/课程(?:号|代码)\s*(?:为|[:：])?\s*([a-z0-9_-]+)/i)
 return {weekday:day?(/\d/.test(day[1])?Number(day[1]):Math.min(7,'一二三四五六日天'.indexOf(day[1])+1)):null,
  week:week?Number(week[1]):null,time:time?clock(time[1]):null,exactStart:/开始|开课时间/.test(query),period:/上午|早上/.test(query)?[0,720]:/下午/.test(query)?[720,1080]:/晚上|晚间/.test(query)?[1080,1440]:null,term:term?.[0]||null,section:section?.[1]||null,code:code?.[1]?.toLowerCase()||null}
}
export function matchesCourseConstraints(data:any,query:string){
 if(!data)return false
 const c=courseConstraints(query)
 if(c.term&&!String(data.semester).startsWith(c.term))return false
 if(c.section&&Number(data.section)!==Number(c.section))return false
 if(c.code&&String(data.code).toLowerCase()!==c.code)return false
 if(c.weekday===null&&c.week===null&&c.time===null&&!c.period)return true
 return (data.meetings||[]).some((m:CourseMeeting)=>(c.weekday===null||m.weekday===c.weekday)&&(c.week===null||m.weeks.includes(c.week))
  &&(c.time===null||(c.exactStart?clock(m.start)===c.time:clock(m.start)<=c.time&&clock(m.end)>c.time))
  &&(!c.period||clock(m.start)>=c.period[0]&&clock(m.start)<c.period[1]))
}
export function collectiveIntent(query:string){return /课表|课程安排|上课时间|哪些课|什么课|开了.*课|开设.*课|开课院系|课程号|课程代码|课序号/.test(query)}
export function normalizeCourseCatalog(input:{complete:boolean;semester:string;capturedAt:string;sourcePage:string;campus?:string;records:Record<string,unknown>[]}){
 if(input.complete!==true)throw new BadRequestException('请上传完整全校课表导出，不支持用筛选结果覆盖整学期资料')
 if(!/^20\d{2}-20\d{2}学年第[一二三123]学期$/.test(input.semester)||!Array.isArray(input.records)||!input.records.length||input.records.length>5000)throw new BadRequestException('请选择学期并上传非空全校课表 JSON，最多 5000 条')
 let url:URL;try{url=new URL(input.sourcePage)}catch{throw new BadRequestException('课表来源地址无效')}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash||url.pathname!=='/Student/AllCourseTimeTable.aspx')throw new BadRequestException('来源须为全部课程安排表页面')
 const captured=new Date(input.capturedAt)
 if(!Number.isFinite(captured.getTime())||captured.getTime()>Date.now()+300000)throw new BadRequestException('采集时间无效')
 const file=`集体课表/${input.semester}/课程安排.json`,seen=new Set<string>(),ids=new Set<number>()
 const items=input.records.flatMap(raw=>{
  if(!raw||typeof raw!=='object'||typeof raw.CourseName!=='string'||!plain(raw.CourseName)||typeof raw.CourseCode!=='string')throw new BadRequestException('课程名称或课程号缺失')
  const teachers=Array.isArray(raw.TRs)?raw.TRs.map(t=>plain((t as any)?.FullName,100)).filter(Boolean):[]
  const course={semester:input.semester,department:plain(raw.OrgName),name:plain(raw.CourseName),code:plain(raw.CourseCode,100),section:plain(raw.DCSN,100),
   category:plain(raw.CGMethod),credits:plain(raw.Credit),hours:plain(raw.CreditHour),classes:plain(raw.Classes),grade:plain(raw.GradeName),teacherNames:[...new Set(teachers)],weekday:plain(raw.DayOfWeek),weeks:plain(raw.WeekInfo),time:plain(raw.PatternTime),room:plain(raw.RoomName),meetings:courseMeetings(raw)}
  const hash=createHash('sha256').update(JSON.stringify([input.semester,plain(raw.DCId),course])).digest('hex'),id='collective-course-'+hash.slice(0,32),externalId=1_000_000_000+parseInt(hash.slice(0,8),16)%100_000_000
  if(seen.has(id))return [];seen.add(id)
  if(ids.has(externalId))throw new BadRequestException('课表索引发生冲突，请联系管理员');ids.add(externalId)
  const detail=[`学期：${course.semester}`,`课程：${course.name}；课程号：${course.code}；课序号：${course.section}`,`院系：${course.department}；类别：${course.category||'未标明'}`,
   `教师：${teachers.join('、')||'未标明'}；学分：${course.credits||'未标明'}；学时：${course.hours||'未标明'}`,`上课班级：${course.classes||'未标明'}；年级：${course.grade||'未标明'}`,`安排：${course.weeks} ${course.weekday} ${course.time}；地点：${course.room||'未安排'}`,
   '这是全校课程安排快照，不代表用户本人选课；调课以教务最新公布为准。'].join('\n')
  return [{id,externalId,title:`${course.name} · ${course.code}/${course.section} · ${course.weekday} ${course.time}`,url:url.href,cat:'集体课表',type:'课程安排',source:'本科教务 · 全部课程安排表',
   name:course.name,dept:course.department,place:course.room,campus:input.campus||'通用',officeTime:course.weekday+' '+course.time,access:'校园网/VPN',detailStatus:'full',
   summaryShort:detail,detail,searchText:[detail,...teachers].join(' ').toLowerCase(),verifiedAt:captured.toISOString(),note:'全校课表快照；不是个人课表。',
   keyFacts:[{kind:'学期',value:course.semester},{kind:'上课安排',value:[course.weeks,course.weekday,course.time].join(' ')},{kind:'地点',value:course.room}],
   extra:{kb:{schema:'kb/v2',collection:COURSE_COLLECTION,parent:id,file,locator:'教学任务 '+plain(raw.DCId)+' / '+hash.slice(0,8),trust:'official',entryKind:'source',sectionPath:[course.semester,course.department,course.category].filter(Boolean),aliases:[course.name,course.code,course.department,course.category,...teachers].filter(Boolean),relations:[]},courseCatalog:course}}]
 })
 const departments=new Map<string,number>()
 for(const row of items){const name=row.extra.courseCatalog.department||'未标明院系';departments.set(name,(departments.get(name)||0)+1)}
 const digest=createHash('sha256').update(file+':overview').digest('hex'),overviewId='collective-overview-'+digest.slice(0,32),externalId=1_000_000_000+parseInt(digest.slice(0,8),16)%100_000_000
 if(ids.has(externalId))throw new BadRequestException('课表概览索引发生冲突')
 const overview=[`${input.semester} · 全校课程安排`,`${items.length} 条排课安排；同一课程可有多个时段，条数不是用户选课数。`,
  '开课院系及排课安排条数：'+[...departments].sort().map(([name,n])=>name+' '+n+'条').join('；'),`采集时间：${captured.toISOString()}`,
  '可以按课程名、课程号、课序号、教师完整姓名、院系、周次、星期、时段和教室查询。全校快照不代表用户个人选课；调课以教务最新公布为准。'].join('\n')
 const overviewRow:any={id:overviewId,externalId,title:`${input.semester} · 全校课表概览`,url:url.href,cat:'集体课表',type:'课表概览',source:'本科教务 · 全部课程安排表',detailStatus:'full',summaryShort:overview,detail:overview,searchText:overview,access:'校园网/VPN',campus:input.campus||'通用',verifiedAt:captured.toISOString(),note:'全校课表快照；不是个人课表。',
  extra:{kb:{schema:'kb/v2',collection:COURSE_COLLECTION,parent:overviewId,file,locator:'学期概览',trust:'official',overview:true,entryKind:'source',sectionPath:[input.semester,'概览'],aliases:['集体课表','全校课表','全校课程安排','本学期课程安排','开课院系'],relations:[]},courseCatalog:{semester:input.semester,meetings:[]}}}
 items.push(overviewRow)
 return {file,items,semester:input.semester,capturedAt:captured.toISOString(),sourcePage:url.href,rawCount:input.records.length}
}
