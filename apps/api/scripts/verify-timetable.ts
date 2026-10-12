import assert from 'node:assert/strict'
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {plainToInstance} from 'class-transformer'
import {validate} from 'class-validator'
import {PrismaService} from '../src/prisma/prisma.service'
import {TimetableService} from '../src/timetable/timetable.service'
import {TimetablePreferencesDto} from '../src/timetable/timetable.dto'
import {parseTimetable,validateSemesterStart,calendarEvents,exportCalendar} from '../src/timetable/timetable-parser'
import {TimetableOnlyGuard} from '../src/browser/timetable-only.guard'
const root=resolve(__dirname,'../../..'),checks:string[]=[],pass=(s:string)=>{checks.push(s);console.log('PASS '+s)}
const capture={semester:'2026-2027学年第一学期',rows:[
 {courseNo:'1012020026',name:'历史哲学',section:'01',arrangement:'1--16周,星期4, 13:50--15:25 北综合楼327 傅正',teachingMethod:'讲授'},
 {courseNo:'2021030001',name:'大学计算机',section:'11',arrangement:'1--16周,星期2, 9:45--12:10;1--16周,星期2, 15:35--17:10 教学综合楼313 机房 吴蓓',teachingMethod:'讲授'},
 {courseNo:'2011010017',name:'体育系列课程（一）--男子羽毛球',section:'1',arrangement:'1--16周,星期4, 9:45--11:20 （体育课场地）气膜馆羽毛球场 张韶光',teachingMethod:'讲授'}]}
async function main(){
  const parsed=parseTimetable(capture);assert.equal(parsed.courses.length,3);assert.equal(parsed.courses[1].meetings.length,2);assert.equal(parsed.courses[1].meetings[0].location,'教学综合楼313 机房');assert.equal(parsed.courses[1].meetings[1].end,'17:10');assert.equal(parsed.courses[2].meetings[0].weekday,4);assert.deepEqual(parsed.warnings,[])
  const odd=parseTimetable({...capture,rows:[{...capture.rows[0],arrangement:'1-8周(单周),星期日,09:00-10:00 北综合楼327 教师'}]});assert.deepEqual(odd.courses[0].meetings[0].weeks,[1,3,5,7]);assert.equal(odd.courses[0].meetings[0].weekday,7)
  const unknown=parseTimetable({...capture,rows:[{...capture.rows[0],arrangement:'教务另行通知'}]});assert(unknown.warnings.length);assert.equal(unknown.courses[0].meetings.length,0)
  assert.throws(()=>parseTimetable({...capture,rows:[]}));assert.throws(()=>parseTimetable({...capture,rows:[{...capture.rows[0],arrangement:'1-999周,星期4,09:00-10:00'}]}));assert.throws(()=>validateSemesterStart('2026-10-07'));assert.throws(()=>validateSemesterStart('2026-02-30'));assert.equal(validateSemesterStart('2026-10-05'),'2026-10-05')
  assert((await validate(plainToInstance(TimetablePreferencesDto,{useInChat:'false'},{enableImplicitConversion:true}))).length)
  pass('按真实课表格式解析多段时段、共享教室、单双周与中文星期，拒绝非法周次/日期/布尔授权')
  const profile={...parsed,semesterStart:'2026-10-05',campus:'liangxiang',reminderLeadMinutes:15}
  const events=calendarEvents(profile);assert.equal(events.length,64);assert.equal(events.find(e=>e.name==='大学计算机')?.startsAt,'2026-10-06T09:45:00+08:00');assert(events.find(e=>e.name==='历史哲学')?.mapUrl);const ics=exportCalendar(profile,'fixture-owner',true)
  assert(ics.includes('DTSTART:20261006T014500Z'));assert(ics.includes('TRIGGER:-PT15M'));assert.equal(ics.split('BEGIN:VEVENT').length-1,64);assert(ics.split('\r\n').every(line=>Buffer.byteLength(line)<=75));assert.equal(calendarEvents({...profile,semesterStart:null}).length,0)
  assert.throws(()=>new TimetableOnlyGuard().canActivate());pass('上海时区/周次生成准确日期、建筑地图与离线日历提醒，通用浏览器入口关闭')
  for(const line of readFileSync(resolve(root,'.env'),'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2]}
  assert(['localhost','127.0.0.1'].includes(new URL(process.env.DATABASE_URL!).hostname),'Fixtures must stay local')
  const db=new PrismaService(),service=new TimetableService(db),users:string[]=[]
  try{
    for(let i=0;i<2;i++)users.push((await db.user.create({data:{email:'timetable-'+Date.now()+'-'+i+'@example.invalid',name:'课表验证',passwordHash:'disabled-fixture'}})).id)
    assert.equal(await service.get(users[0]),null);service.preview(capture);assert.equal(await service.get(users[0]),null)
    await service.save(users[0],capture);assert.equal(await service.get(users[1]),null);assert.equal((await service.get(users[0]))?.useInChat,false)
    await assert.rejects(()=>service.save(users[0],{...capture,rows:[]}));assert.equal((await service.get(users[0]))?.courses instanceof Array,true)
    await service.preferences(users[0],{semesterStart:'2026-10-05',useInChat:true,remindersEnabled:true})
    const answer=await service.answer(users[0],'下一节课在哪上',new Date('2026-10-06T00:00:00Z'));assert(answer?.includes('大学计算机'));assert(answer?.includes('教学综合楼313'));assert(answer?.includes('```card'))
    assert((await service.answer(users[1],'下一节课在哪上'))?.includes('确认导入'));assert.equal(await service.answer(users[0],'我明天想去看电影'),null)
    assert.equal((await service.upcoming(users[0],new Date('2026-10-06T00:00:00Z'))).events[0].start,'09:45')
    const paused=new TimetableService(db,{get:async()=>false} as any),before=JSON.stringify(await service.get(users[0]))
    assert((await paused.answer(users[0],'我的课表'))?.includes('暂时不可用'));assert.equal(await paused.answer(users[0],'图书馆在哪里'),null)
    assert.deepEqual((await paused.upcoming(users[0])).events,[])
    await assert.rejects(()=>paused.preferences(users[0],{useInChat:true}));await assert.rejects(()=>paused.preferences(users[0],{remindersEnabled:true}))
    assert.equal(JSON.stringify(await service.get(users[0])),before);assert((await paused.calendar(users[0])).content.includes('BEGIN:VCALENDAR'))
    pass('暂停状态：课程问答仅返回不可用提示、无提醒事件、禁止重新开启个性化与提醒；已有课表不改动且可导出')
    await service.save(users[0],{...capture,semester:'2026-2027学年第二学期'});assert.equal((await service.get(users[0]))?.semesterStart,null);assert.equal((await service.get(users[0]))?.remindersEnabled,false)
    await service.remove(users[0]);assert.equal(await service.get(users[0]),null)
    pass('真实 PostgreSQL：预览不落库、按账号隔离、坏导入不覆盖、私有导览零模型查询、跨学期重置日期与提醒、删除生效')
  }finally{await db.user.deleteMany({where:{id:{in:users}}});await db.$disconnect()}
  mkdirSync(resolve(root,'storage/shots/timetable'),{recursive:true});writeFileSync(resolve(root,'storage/shots/timetable/backend.json'),JSON.stringify({checkedAt:new Date().toISOString(),checks,scope:'Local database, fixtures removed; no school credentials used'},null,2))
}
main().catch(error=>{console.error(error);process.exitCode=1})
