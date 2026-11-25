import { HttpException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { Interval } from '@nestjs/schedule'
import { createHash } from 'node:crypto'
import { PrismaService } from '../prisma/prisma.service'
import { load } from 'cheerio'
import { readLecturePage } from '../lectures/lecture-crawler'
import { isVerificationPage } from '../knowledge/wechat-content'
import { dateOnly } from '../lectures/lecture-data'
import { questionKey } from '../knowledge/knowledge-store.service'
import { SettingsService } from '../settings/settings.service'
import { portalNewsBase } from './portal-navigation'

const source = 'https://www.ucass.edu.cn'
export const publicNewsBase = portalNewsBase
const columns = [
  {name:'学校通知',path:'/index/tzgg.htm'},
  {name:'学校要闻',path:'/index/yw.htm'},
]
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const jobKey = 'official_news_last_scheduled_attempt'
const scheduledActor = { id: null, email: '官网要闻定时采集' }

export function parsePublicNews(html: string, path: string, name: string) {
  if (isVerificationPage(html)) throw new Error('学校栏目要求访问验证')
  const $ = load(html)
  const articleHeadings = $('.tuwen-tit a[href]')
  const items = new Map<string,{title:string;url:string;published:string;category:string}>()
  const links = articleHeadings.length ? articleHeadings : $('a[href]')
  links.each((_,node)=>{
    if (items.size>=20) return false
    const link = $(node)
    let url: URL
    try { url = new URL(link.attr('href') || '',source+path) } catch { return }
    if (url.protocol!=='https:' || url.username || url.password || url.port || url.search ||
      !(url.hostname==='ucass.edu.cn' || url.hostname.endsWith('.ucass.edu.cn')) ||
      !/^\/info\/\d+\/\d+\.htm$/.test(url.pathname)) return
    const title = (link.attr('title') || link.text()).replace(/\s+/g,' ').trim().slice(0,500)
    if (title.length<4 || /^(?:查看详情|阅读原文)$/.test(title)) return
    const adjacent = articleHeadings.length ? [link.closest('.tuwen-item').find('.tuwen-info').text()] : [link.closest('li').text(),link.parent().text()]
    const raw = adjacent.map(value=>value.match(/20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}/)?.[0]).find(Boolean)
    if (!raw) return
    const published = dateOnly(raw.split(/[-/.]/).map((part,i)=>i ? part.padStart(2,'0') : part).join('-'))
    if (!published) return
    url.hash = ''
    if (!items.has(url.href)) items.set(url.href,{title,url:url.href,published,category:name})
  })
  return [...items.values()]
}

@Injectable()
export class PublicNewsService {
  private active = false
  private lastStarted = 0
  private headlineCache?:{expires:number;items:ReturnType<typeof parsePublicNews>}
  private headlineRequest?:Promise<ReturnType<typeof parsePublicNews>>
  private readonly logger = new Logger(PublicNewsService.name)
  constructor(private readonly prisma: PrismaService, private readonly settings: SettingsService) {}

  async headlines(){
    if(this.headlineCache&&this.headlineCache.expires>Date.now())return this.headlineCache.items
    if(!this.headlineRequest)this.headlineRequest=(async()=>{
      const path='/index/yw.htm'
      try{
        const direct=await this.settings.get('official_news_campus_network')===true
        const items=parsePublicNews(await readLecturePage(source+path,AbortSignal.timeout(4500),0,direct),path,'学校要闻')
        this.headlineCache={items,expires:Date.now()+5*60_000};return items
      }catch{const items=this.headlineCache?.items||[];this.headlineCache={items,expires:Date.now()+60_000};return items}
    })().finally(()=>{this.headlineRequest=undefined})
    return this.headlineRequest
  }

  @Interval(60_000)
  async scheduled() {
    if (this.active || Date.now()-this.lastStarted<60_000) return
    try {
      const [enabled, rawHours, direct] = await Promise.all([
        this.settings.get('official_news_auto_enabled'),
        this.settings.get<number>('official_news_interval_hours'),
        this.settings.get('official_news_campus_network'),
      ])
      if (enabled!==true) return
      const hours = Number.isInteger(rawHours) && rawHours>=6 && rawHours<=168 ? rawHours : 24
      const claimed = await this.prisma.$transaction(async tx => {
        const lock = await tx.$queryRaw<{locked:boolean}[]>`SELECT pg_try_advisory_xact_lock(714020261124) AS locked`
        if (!lock[0]?.locked) return false
        const [previous,base] = await Promise.all([
          tx.setting.findUnique({where:{key:jobKey}}),
          tx.knowledgeBase.findUnique({where:{id:publicNewsBase},select:{kind:true,mounted:true,agentId:true}}),
        ])
        if (base && (base.kind!=='LOCAL' || !base.mounted || base.agentId)) return false
        const last = typeof previous?.value==='number' ? previous.value : 0
        const now = Date.now()
        if (now-last<hours*3600_000) return false
        await tx.setting.upsert({where:{key:jobKey},create:{key:jobKey,group:'official-news',value:now},update:{value:now}})
        return true
      })
      if (claimed) await this.collect(scheduledActor,direct===true,true)
    } catch (error) {
      this.logger.warn('官网要闻定时采集未完成：'+(error as Error).message)
    }
  }

  async collect(actor: { id: string | null; email: string }, campusNetwork: boolean, scheduled = false) {
    if (this.active || Date.now()-this.lastStarted < 60_000)
      throw new HttpException('刚读取过学校栏目，请稍后再试',429)
    this.active = true
    this.lastStarted = Date.now()
    try {
      const result = new Map<string, ReturnType<typeof parsePublicNews>[number]>()
      const columnsRead: {name:string; count:number; error?:string}[] = []
      for (const {name,path} of scheduled ? columns.filter(column=>column.path==='/index/yw.htm') : columns) {
        try {
          const html = await readLecturePage(source+path,AbortSignal.timeout(8000),0,campusNetwork)
          const parsed = parsePublicNews(html,path,name)
          for (const item of parsed) result.set(item.url,item)
          columnsRead.push({name,count:parsed.length})
        } catch (cause) {
          columnsRead.push({name,count:0,error:(cause as Error).message})
        }
      }
      if (!result.size) throw new ServiceUnavailableException(columnsRead.map(column => column.name+'：'+(column.error || '未找到带发布日期的公开条目')).join('；'))
      const entries = [...result.values()]
      return await this.prisma.$transaction(async tx => {
        const base = await tx.knowledgeBase.upsert({where:{id:publicNewsBase},create:{
          id:publicNewsBase,name:'社科大官网资讯',kind:'LOCAL',mounted:true,
          description:'只收录学校公开栏目的标题、发布日期与原文入口。新增资料需审核发布。',
        },update:{}})
        if (base.kind!=='LOCAL' || base.agentId) throw new ServiceUnavailableException('官网资讯知识库配置不匹配')
        const inserted = await tx.knowledgeEntry.createMany({skipDuplicates:true,data:entries.map(item => ({
          baseId:base.id,externalKey:'ucass-public-news:'+(item.category==='学校要闻'?'headline:':'notice:')+digest(item.url),questionKey:questionKey(item.title+' '+item.url),
          title:item.title,question:item.title+' '+item.url,answer:`栏目：${item.category}\n发布日期：${item.published}\n[在学校官网阅读原文](${item.url})`,
          summary:item.category+' · '+item.published,url:item.url,source:'中国社会科学院大学官网 · '+item.category,
          mode:'RAG',status:'DRAFT',aliases:[],
        }))})
        await tx.knowledgeBase.update({where:{id:base.id},data:{lastSyncAt:new Date(),
          syncStatus:columnsRead.some(column=>column.error)?'PARTIAL':'SUCCESS',syncError:null, lastSyncSummary:{read:entries.length,newDrafts:inserted.count,scheduled,columns:columnsRead}}})
        await tx.auditLog.create({data:{userId:actor.id,actor:actor.email,action:'portal.news.collect',
          resource:'knowledge_base',resourceId:base.id,detail:{read:entries.length,newDrafts:inserted.count,scheduled},success:true}})
        return {baseId:base.id,read:entries.length,newDrafts:inserted.count,columns:columnsRead}
      })
    } catch (error) {
      await this.prisma.knowledgeBase.updateMany({where:{id:publicNewsBase,kind:'LOCAL'},data:{
        syncStatus:'FAILED',syncError:(error as Error).message.slice(0,350),
      }}).catch(()=>undefined)
      throw error
    } finally {
      this.active = false
    }
  }
}
