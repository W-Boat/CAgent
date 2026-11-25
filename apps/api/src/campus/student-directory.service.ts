import {isCampusOfficialHost} from '../common/campus-deployment'
import {ConflictException,Injectable,ServiceUnavailableException} from '@nestjs/common'
import {load} from 'cheerio'
import {PrismaService} from '../prisma/prisma.service'
import {KnowledgeStoreService,questionKey} from '../knowledge/knowledge-store.service'
import {readLecturePage} from '../lectures/lecture-crawler'
import {isVerificationPage} from '../knowledge/wechat-content'
import {academicCalendarIndex,academicCalendarPortal,academicNotices,campusDepartments,contactSources} from './student-directory-sources'

export type DirectoryKind='academic-calendar'|'directory'
type Entry={key:string;title:string;answer:string;summary:string;url:string;source:string;aliases:string[]}
const bases={
  'academic-calendar':{id:'kb-campusdemo-academic-calendar',name:'学年校历',description:'教务处公开校历档案与可核验教学日期',sourceUrl:academicCalendarPortal},
  directory:{id:'kb-campusdemo-office-phones',name:'部门公开办公电话',description:'学校官网公开的部门与服务办公室座机',sourceUrl:campusDepartments},
}
const officialLink=(value:string)=>{try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&isCampusOfficialHost(url.hostname)?url.href:''}catch{return ''}}
const digits=(value:string)=>value.normalize('NFKC').replace(/[\s\u00a0]+/g,' ')

@Injectable()
export class StudentDirectoryService {
  private collecting=false
  private lastStarted=0
  constructor(private readonly prisma:PrismaService,private readonly store:KnowledgeStoreService){}

  async list(kind:DirectoryKind){
    const base=bases[kind]
    const rows=await this.prisma.knowledgeEntry.findMany({where:{baseId:base.id,mode:'RAG',status:'APPROVED',base:{mounted:true,agentId:null}},select:{id:true,title:true,answer:true,url:true,source:true,aliases:true},orderBy:[{title:'asc'},{id:'asc'}]})
    return {sourceUrl:base.sourceUrl,items:rows.map(row=>({id:row.id,title:row.title,content:row.answer,url:officialLink(row.url),source:row.source,aliases:row.aliases,
      ...(kind==='directory'?{phones:[...new Set(row.answer.match(/\b0\d{2,3}-\d{7,8}\b/g)||[])],group:row.title.split(' · ')[0]}:{date:row.answer.match(/日期：\s*(\d{4}-\d{2}-\d{2})/)?.[1]||null})}))}
  }

  async collect(actor:{id:string;email:string},campusNetwork:boolean){
    if(this.collecting||Date.now()-this.lastStarted<30_000)throw new ConflictException('刚刚采集过，请稍候再试')
    this.collecting=true;this.lastStarted=Date.now()
    const failed:string[]=[]
    try{
      const pages=new Map<string,Promise<string>>()
      const page=(url:string)=>{
        if(!pages.has(url))pages.set(url,readLecturePage(url,AbortSignal.timeout(8_000),0,campusNetwork).then(html=>{if(isVerificationPage(html))throw Error('需要访问验证');return html}).catch(()=>{failed.push(url);return ''}))
        return pages.get(url)!
      }
      const [index,contacts,notices]=await Promise.all([
        page(academicCalendarIndex),
        Promise.all(contactSources.map(async source=>{
          const html=await page(source.url),$=load(html);$('script,style,header,nav').remove()
          const text=digits($.root().text())
          return source.offices.flatMap(([label,numbers]):Entry[]=>{
            const matched=numbers.filter(number=>new RegExp('(?<!\\d)'+number.split('').join('\\s*')+'(?!\\d)').test(text)).map(number=>'010-'+number)
            if(!matched.length)return []
            const title=source.department+' · '+label,summary=matched.join('、')
            return [{key:questionKey(title),title,answer:'办公电话：'+summary,summary,url:source.url,source:source.department,aliases:[source.department+'电话',label+'电话']}]
          })
        })),
        Promise.all(academicNotices.map(async item=>{
          const html=await page(item.url),text=digits(load(html).root().text()).replace(/\s+/g,'')
          if(!item.evidence.test(text))return null
          return {key:item.key,title:item.title,answer:`日期：${item.date}\n\n${item.answer}`,summary:item.answer,url:item.url,source:'学校公开通知',aliases:['校历','学年校历']} satisfies Entry
        })),
      ])
      const $=load(index),archive=new Map<string,Entry>()
      $('a[href]').each((_,node)=>{
        const title=$(node).text().replace(/\s+/g,' ').trim(),href=$(node).attr('href')||''
        if(!/20\d{2}[-—–－]20\d{2}学年.*(?:校历|教学日历)/.test(title)||!href)return
        try{
          const url=officialLink(new URL(href,academicCalendarIndex).href)
          if(!url||!/(?:^\/info\/\d+\/\d+\.htm$|^\/szkfj\/jxrl\/[-a-z\d]+\.pdf$)/i.test(new URL(url).pathname))return
          archive.set(url,{key:questionKey(url),title,answer:'教务处公开校历档案。请打开原文查阅该学年的教学安排和附件。',summary:'教务处校历档案',url,source:'教务处教学日历栏目',aliases:['校历档案','学年校历']})
        }catch{}
      })
      const calendar=[...notices.filter((row):row is Entry=>!!row),...archive.values()],phones=contacts.flat()
      if(!calendar.length&&!phones.length)throw new ServiceUnavailableException('未读取到校历或电话，请确认校园网连接后重试')
      const [calendarReport,phoneReport]=await Promise.all([this.persist('academic-calendar',calendar),this.persist('directory',phones)])
      await this.prisma.auditLog.create({data:{userId:actor.id,actor:actor.email,action:'campus.directory.collect',resource:'knowledge_base',detail:{calendar:calendarReport,directory:phoneReport,failed},success:true}})
      return {calendar:calendarReport,directory:phoneReport,failed}
    }finally{this.collecting=false}
  }

  private async persist(kind:DirectoryKind,entries:Entry[]){
    const base=bases[kind]
    if(!entries.length)return {read:0,added:0,baseId:base.id}
    return this.prisma.$transaction(async tx=>{
      const row=await tx.knowledgeBase.upsert({where:{id:base.id},create:{id:base.id,name:base.name,description:base.description,mounted:true,kind:'LOCAL'},update:{}})
      if(row.kind!=='LOCAL'||row.agentId)throw new ConflictException('目录知识库配置不匹配')
      const result=await tx.knowledgeEntry.createMany({skipDuplicates:true,data:entries.map(item=>({baseId:base.id,externalKey:`campus-directory:${kind}:${item.key}`,question:item.title,questionKey:questionKey(item.title),title:item.title,answer:item.answer,summary:item.summary,url:item.url,source:item.source,aliases:item.aliases,mode:'RAG',status:'APPROVED'}))})
      await tx.knowledgeBase.update({where:{id:base.id},data:{lastSyncAt:new Date(),syncStatus:'SUCCESS',lastSyncSummary:{read:entries.length,added:result.count}}})
      if(result.count)await this.store.bump(tx)
      return {read:entries.length,added:result.count,baseId:base.id}
    })
  }
}
