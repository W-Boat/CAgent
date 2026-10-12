import { BadRequestException } from '@nestjs/common'
import { resolveCampusMap } from '../campus/campus-map'

export interface CaptureRow { courseNo: string; name: string; section: string; arrangement: string; teachingMethod: string }
export interface Capture { semester: string; rows: CaptureRow[] }
export interface Meeting { weeks: number[]; weekday: number; start: string; end: string; location: string; teacher: string }
export interface Course extends CaptureRow { meetings: Meeting[]; warnings: string[] }
export interface ParsedTimetable { semester: string; courses: Course[]; warnings: string[] }
const clean = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim()
const time = (s: string) => s.split(':').map(n => n.padStart(2, '0')).join(':')
const minutes = (s: string) => Number(s.split(':')[0])*60+Number(s.split(':')[1])

/** Only the five visible course columns enter this parser. Never accept HTML or scripts. */
export function parseTimetable(capture: Capture): ParsedTimetable {
  if (!capture || !/^20\d{2}-20\d{2}学年[第]?[一二三123]学期$/.test(capture.semester || '') || !Array.isArray(capture.rows) || !capture.rows.length || capture.rows.length > 120)
    throw new BadRequestException('请选择有效学期，并读取非空课表（最多 120 门课）')
  const courses: Course[] = []
  const seen = new Set<string>()
  for (const raw of capture.rows) {
    for (const key of ['courseNo','name','section','arrangement','teachingMethod'] as const) {
      if (typeof raw[key] !== 'string' || raw[key].length > (key === 'arrangement' ? 4000 : 200)) throw new BadRequestException('课表字段格式或长度不正确')
    }
    const row = Object.fromEntries(['courseNo','name','section','arrangement','teachingMethod'].map(k => [k,clean(raw[k])])) as unknown as CaptureRow
    if (!row.name || !row.arrangement) throw new BadRequestException('课程名和上课安排不能为空')
    const key = `${row.courseNo}|${row.name}|${row.section}|${row.arrangement}`
    if (seen.has(key)) continue
    seen.add(key)
    const course: Course = { ...row, meetings: [], warnings: [] }
    // Matches each complete meeting, including multiple sessions sharing a final room/teacher.
    const text = row.arrangement.replace(/[–—~～至]/g,'-').replace(/-{2,}/g,'-')
    const rx = /([\d\s,，、\-]+)周\s*(?:[（(]?([单双])周?[）)]?)?\s*[,，;；]?\s*(?:星期|周)([1-7一二三四五六日天])\s*[,，]?\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/g
    const matches = [...text.matchAll(rx)]
    if(matches.length>20)throw new BadRequestException('单门课程的上课时段最多 20 段')
    if (!matches.length) course.warnings.push('上课安排尚不能解析，请以教务原文为准；不会生成提醒')
    if (matches.length && text.slice(0,matches[0].index).trim()) course.warnings.push('部分上课安排未识别，请核对教务原文')
    for (let i=0; i<matches.length; i++) {
      const m=matches[i], weeks=new Set<number>()
      for(const part of m[1].trim().split(/[,，、\s]+/).filter(Boolean)) {
        if (!/^\d+(?:-\d+)?$/.test(part)) continue
        const [lo,hi=lo]=part.split('-').map(Number)
        if(lo<1||hi<lo||hi>30) throw new BadRequestException(`${row.name} 的周次超出 1～30 周或倒序`)
        for(let w=lo;w<=hi;w++) if(!m[2]||(m[2]==='单'?w%2===1:w%2===0))weeks.add(w)
      }
      const start=time(m[4]),end=time(m[5])
      if(!weeks.size || ![start,end].every(t=>/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) || minutes(start)>=minutes(end)) {
        course.warnings.push('存在无效周次或时间，该时段不会生成提醒'); continue
      }
      const tail=text.slice((m.index || 0)+m[0].length,i+1<matches.length?matches[i+1].index:undefined).replace(/^[,，;；\s]+|[;；\s]+$/g,'')
      const bits=tail.split(/\s+/).filter(Boolean)
      const teacher=bits.length>1?bits.pop()!:''
      const location=bits.join(' ')
      if(tail && /周|星期|\d{1,2}:\d{2}/.test(tail)) course.warnings.push('附加上课安排未完整识别，请核对原文')
      const weekday=/\d/.test(m[3])?Number(m[3]):Math.min(7,'一二三四五六日天'.indexOf(m[3])+1)
      course.meetings.push({weeks:[...weeks].sort((a,b)=>a-b),weekday,start,end,location,teacher})
    }
    // The academic system emits e.g. morning;afternoon ROOM TEACHER.
    if(course.meetings.length>1) {
      const last=course.meetings[course.meetings.length-1]
      for(const meeting of course.meetings) if(!meeting.location){meeting.location=last.location;meeting.teacher=last.teacher}
    }
    courses.push(course)
  }
  if(!courses.length)throw new BadRequestException('没有可导入的课程')
  if(courses.reduce((n,c)=>n+c.meetings.length,0)>400)throw new BadRequestException('课表时段过多，请检查原始表格')
  return {semester:capture.semester,courses,warnings:courses.flatMap(c=>c.warnings.map(w=>`${c.name}：${w}`))}
}

export function validateSemesterStart(value: unknown): string | null {
  if(value===null || value==='')return null
  if(typeof value!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(value))throw new BadRequestException('第一周周一须为 YYYY-MM-DD')
  const date=new Date(value+'T00:00:00Z')
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value||date.getUTCDay()!==1)throw new BadRequestException('请选择真实日期，且必须是第一周的星期一')
  return value
}
export interface ScheduleProfile {semester: string; courses: unknown; semesterStart: string | null; campus: string; reminderLeadMinutes: number}
export interface TimetableEvent {id:string; name:string; courseNo:string; week:number; weekday:number; date:string; start:string; end:string; startsAt:string; endsAt:string; location:string; teacher:string; mapUrl:string|null; mapCard:unknown|null}
export function calendarEvents(profile: ScheduleProfile): TimetableEvent[] {
  if(!profile.semesterStart)return []
  const monday=new Date(profile.semesterStart+'T00:00:00Z').getTime(),events:TimetableEvent[]=[]
  for(const [ci,course] of (profile.courses as Course[]).entries())for(const [mi,m]of course.meetings.entries()){
    const map=resolveCampusMap(`${profile.campus==='wangjing'?'望京':'良乡'} ${m.location} 在哪里`)
    const place=map?.card.matches[0]?.placeIds[0]
    for(const week of m.weeks){
    const date=new Date(monday+((week-1)*7+m.weekday-1)*86400000).toISOString().slice(0,10)
    events.push({id:`${profile.semester}-${ci}-${mi}-${week}`,name:course.name,courseNo:course.courseNo,week,weekday:m.weekday,date,start:m.start,end:m.end,startsAt:`${date}T${m.start}:00+08:00`,endsAt:`${date}T${m.end}:00+08:00`,location:m.location,teacher:m.teacher,mapUrl:place?`/map?campus=${profile.campus}&place=${encodeURIComponent(place)}`:null,mapCard:map?.card||null})
    }
  }
  return events.sort((a,b)=>a.startsAt.localeCompare(b.startsAt)||a.id.localeCompare(b.id))
}
export const shanghaiDate=(now:Date)=>new Date(now.getTime()+8*3600000).toISOString().slice(0,10)
const escapeIcs=(s:string)=>s.replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;')
export function exportCalendar(profile:ScheduleProfile,ownerId:string,remindersEnabled:boolean):string {
  if(!profile.semesterStart)throw new BadRequestException('先设置第一周周一，再导出日历')
  const stamp=(s:string)=>new Date(s).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//CAgent//Private timetable//ZH','CALSCALE:GREGORIAN','METHOD:PUBLISH',`X-WR-CALNAME:${escapeIcs(profile.semester+' 我的课表')}`]
  for(const e of calendarEvents(profile)){
    lines.push('BEGIN:VEVENT',`UID:${e.id}-${ownerId}@cagent`, `DTSTAMP:${stamp(new Date().toISOString())}`,`DTSTART:${stamp(e.startsAt)}`,`DTEND:${stamp(e.endsAt)}`,`SUMMARY:${escapeIcs(e.name)}`,`LOCATION:${escapeIcs(e.location)}`,`DESCRIPTION:${escapeIcs('第'+e.week+'周 '+e.teacher+'\n以教务最新课表为准')}`)
    if(remindersEnabled)lines.push('BEGIN:VALARM','ACTION:DISPLAY',`TRIGGER:-PT${profile.reminderLeadMinutes}M`,`DESCRIPTION:${escapeIcs(e.name+' 即将上课')}`,'END:VALARM')
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  // RFC 5545 folding at <=75 UTF-8 octets, without splitting a multibyte character.
  return lines.flatMap(line=>{const parts:string[]=[];let part='';for(const char of line){if(Buffer.byteLength(part+char)>75){parts.push(part);part=' '}part+=char}parts.push(part);return parts}).join('\r\n')+'\r\n'
}
