import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common'
import {SettingsService} from '../settings/settings.service'
import { PrismaService } from '../prisma/prisma.service'
import { CaptureDto, TimetablePreferencesDto } from './timetable.dto'
import { parseTimetable, validateSemesterStart, calendarEvents, exportCalendar, shanghaiDate } from './timetable-parser'

@Injectable()
export class TimetableService {
  constructor(private readonly prisma: PrismaService,@Optional() private readonly settings?:SettingsService) {}
  preview(capture:CaptureDto){return parseTimetable(capture)}
  get(userId:string){return this.prisma.userTimetable.findUnique({where:{userId},select:{semester:true,courses:true,warnings:true,semesterStart:true,campus:true,useInChat:true,remindersEnabled:true,reminderLeadMinutes:true,updatedAt:true}})}
  async save(userId:string,capture:CaptureDto){
    const parsed=parseTimetable(capture)
    const previous=await this.get(userId)
    // A different semester must never inherit the previous term's week-one date.
    return this.prisma.userTimetable.upsert({where:{userId},create:{userId,semester:parsed.semester,courses:parsed.courses as any,warnings:parsed.warnings},update:{semester:parsed.semester,courses:parsed.courses as any,warnings:parsed.warnings,...(previous?.semester!==parsed.semester?{semesterStart:null,remindersEnabled:false}:{})},select:{semester:true,courses:true,warnings:true,semesterStart:true,campus:true,useInChat:true,remindersEnabled:true,reminderLeadMinutes:true,updatedAt:true}})
  }
  async preferences(userId:string,dto:TimetablePreferencesDto){
    if((dto.useInChat===true||dto.remindersEnabled===true)&&await this.settings?.get('timetable_enabled')===false)throw new ForbiddenException('个人课表功能暂时不可用')
    const profile=await this.get(userId);if(!profile)throw new NotFoundException('请先导入自己的课表')
    const data={...dto,...(dto.semesterStart!==undefined?{semesterStart:validateSemesterStart(dto.semesterStart)}:{})}
    if(data.semesterStart===null)data.remindersEnabled=false
    if(data.remindersEnabled&&!(data.semesterStart||profile.semesterStart))throw new BadRequestException('请先设置校历第一周周一')
    await this.prisma.userTimetable.update({where:{userId},data})
    return this.get(userId)
  }
  async remove(userId:string){await this.prisma.userTimetable.deleteMany({where:{userId}});return {success:true}}
  async upcoming(userId:string,now=new Date()){
    if(await this.settings?.get('timetable_enabled')===false)return {configured:false,date:shanghaiDate(now),events:[],remindersEnabled:false,reminderLeadMinutes:15}
    const profile=await this.get(userId)
    if(!profile)return {configured:false,date:shanghaiDate(now),events:[],remindersEnabled:false,reminderLeadMinutes:15}
    const end=now.getTime()+14*86400000
    const events=calendarEvents(profile).filter(e=>Date.parse(e.endsAt)>=now.getTime()&&Date.parse(e.startsAt)<=end)
    return {configured:!!profile.semesterStart,date:shanghaiDate(now),events,remindersEnabled:profile.remindersEnabled,reminderLeadMinutes:profile.reminderLeadMinutes}
  }
  async calendar(userId:string){const profile=await this.get(userId);if(!profile)throw new NotFoundException('请先导入自己的课表');return {filename:'cagent-timetable.ics',content:exportCalendar(profile,userId,profile.remindersEnabled)}}
  /** Personal schedule queries are deterministic, bypass shared retrieval/learning and spend zero model tokens. */
  async answer(userId:string,query:string,now=new Date()):Promise<string|null>{
    if(query.length>300 || !/(我的课表|我的课程|我.{0,5}(今天|明天|下[一节堂]).{0,8}(课|教室)|今天.{0,6}(课|教室)|明天.{0,6}(课|教室)|下[一节堂].{0,4}(课|教室)|课表提醒|导入课表|获取课表)/.test(query))return null
    if(await this.settings?.get('timetable_enabled')===false)return '个人课表功能暂时不可用，重新开放后可读取课程并设置个性化导览和提醒。'
    const profile=await this.get(userId)
    if(!profile||!profile.useInChat)return '请在[我的课表](/timetable)读取并确认导入，再开启「用于个人对话导览」。可直接在平台的临时教务窗口登录。'
    if(/我的课表|我的课程/.test(query)&&!/今天|明天|下一|下节|下堂/.test(query))return `已保存你确认导入的 ${profile.semester} 课表，共 ${(profile.courses as any[]).length} 门课程。\n\n请打开[我的课表](/timetable)查看每周时段、教务原文和建筑位置，并设置校历第一周周一与课前提醒。调课后请重新读取。`
    if(!profile.semesterStart)return '已保存 '+profile.semester+' 的个人课表。请在[我的课表](/timetable)设置校历第一周周一，之后才能准确查询今天、下一节课程和生成提醒。'
    let events=calendarEvents(profile)
    const next=/下[一节堂]/.test(query),tomorrow=/明天/.test(query)
    const date=shanghaiDate(new Date(now.getTime()+(tomorrow?86400000:0)))
    events=next?events.filter(e=>Date.parse(e.startsAt)>=now.getTime()).slice(0,1):events.filter(e=>e.date===date)
    if(!events.length)return `${next?'此课表中没有后续课程':date+' 课表中没有安排课程'}。调课、停课请以教务最新通知为准，可在[我的课表](/timetable)重新读取。`
    return `根据你确认导入的 ${profile.semester} 课表：\n\n`+events.map(e=>`- **${e.name}**：${e.date} ${e.start}～${e.end}，${e.location||'教室未标明'}（第 ${e.week} 周）。${e.mapUrl?` [查看建筑位置](${e.mapUrl})`:''}`).join('\n')+(events[0].mapCard?'\n\n```card\n'+JSON.stringify(events[0].mapCard)+'\n```':'')+'\n\n以教务最新课表和调课通知为准。提醒与日历请在[我的课表](/timetable)设置。'
  }
}
