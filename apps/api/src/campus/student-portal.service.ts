import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { managedTaxonomy } from '../knowledge/managed-taxonomy'
import { CampusGuideService } from './campus-guide.service'
import { metadata } from './knowledge-retriever'
import { publicNewsBase,PublicNewsService } from './public-news.service'
import { portalNavigationBase, portalNavigation, portalNavigationObservedAt } from './portal-navigation'
import { KnowledgeStoreService, questionKey } from '../knowledge/knowledge-store.service'
import {observedPortalAppNames} from './portal-app-directory'
import {CONTEST_MARKDOWN,CONTEST_SQLITE,embeddedSourceId} from '../knowledge/embedded-knowledge'

const officialPortal = 'https://info.ucass.edu.cn/default/index.html#/'
const fusion = 'kb-ucass-portal-fusion-2026'
const verifiedServices = 'kb-ucass-portal-services-2026'
const embeddedBySection = {services:['services','matters'], applications:['portal'], information:['通知公告']}
export type PortalSection = keyof typeof embeddedBySection
type PortalItem = {
  id: string; title: string; category: string; source: string; summary: string; url: string; date?: string
  department?: string; place?: string; campus?: string; availability?: string; kind?: string; keywords?: string[]
}
const words = (value: unknown) => Array.isArray(value) ? value.filter(item => typeof item === 'string').slice(0,25) : []
const calendarDate = (value?: string | null) => value?.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0]
function safePortalUrl(value: unknown, allowWechat = false) {
  try {
    const url = new URL(String(value))
    const host = url.hostname.toLowerCase()
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password) return ''
    if (!(host === 'ucass.edu.cn' || host.endsWith('.ucass.edu.cn') || allowWechat && host === 'mp.weixin.qq.com')) return ''
    if ([...url.searchParams.keys()].some(key => /ticket|token|password|session|student|user|sso/i.test(key))) return ''
    return url.toString()
  } catch { return '' }
}
const titleKey = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'')
const observedApps=new Set<string>(observedPortalAppNames.map(titleKey))
const observedNavigationKeys=new Set(portalNavigation.filter(item=>item.externalKey.includes(':apps:')&&observedApps.has(titleKey(item.title))).map(item=>item.externalKey))
const officialHeadlines='https://www.ucass.edu.cn/index/yw.htm'
const directoryRevision = 'portal_az_directory_revision'

@Injectable()
export class StudentPortalService {
  private readonly logger=new Logger(StudentPortalService.name)
  constructor(private readonly prisma: PrismaService, private readonly guide: CampusGuideService,
    private readonly knowledge: KnowledgeStoreService,private readonly news:PublicNewsService) {}

  onApplicationBootstrap(){void this.populateExistingDirectory().catch(()=>this.logger.warn('未能补齐官方门户目录，可在知识库管理中重试'))}
  private async populateExistingDirectory(){
    const [base, imported]=await Promise.all([this.prisma.knowledgeBase.findUnique({where:{id:portalNavigationBase},select:{kind:true,agentId:true}}),this.prisma.setting.findUnique({where:{key:directoryRevision},select:{value:true}})])
    if(base?.kind!=='LOCAL'||base.agentId||imported?.value===portalNavigationObservedAt)return
    const admin=await this.prisma.user.findFirst({where:{status:'ACTIVE',roles:{some:{role:{key:'super_admin'}}}},orderBy:{createdAt:'asc'},select:{id:true,email:true}})
    if(admin)await this.installNavigation(admin)
  }

  async installNavigation(actor: {id:string; email:string}) {
    return this.prisma.$transaction(async tx => {
      const base = await tx.knowledgeBase.upsert({where:{id:portalNavigationBase},create:{
        id:portalNavigationBase,name:'官方门户入口与办理导航',kind:'LOCAL',mounted:true,
        description:'通用应用入口和办事路径，按当前登录可见的官方页面整理。',
        connection:{observedAt:portalNavigationObservedAt,taxonomy:{entryPrefix:'ucass-portal-nav:',topics:[
          {key:'apps',label:'校园应用'},{key:'services',label:'学生事务'},
        ]}},
      },update:{}})
      if (base.kind!=='LOCAL' || base.agentId) throw new NotFoundException('目标知识库不可用')
      const existingApps=new Set(portalNavigation.filter(item=>item.externalKey.includes(':apps:')).map(item=>titleKey(item.title)))
      const prior = await tx.knowledgeEntry.findMany({where:{baseId:fusion,status:'APPROVED',externalKey:{startsWith:'portal-fusion:apps:'}},select:{title:true,url:true}})
      const links = new Map(prior.map(item=>[titleKey(item.title),safePortalUrl(item.url)]))
      const directory=observedPortalAppNames.filter(title=>!existingApps.has(titleKey(title))).map(title=>({externalKey:'ucass-portal-nav:az:'+questionKey(title),title,url:links.get(titleKey(title))||officialPortal+'apps',answer:`登录新版校园门户，在应用中心搜索「${title}」，从学校提供的入口打开。`,aliases:[]}))
      const candidates=[...portalNavigation,...directory]
      const inserted = await tx.knowledgeEntry.createMany({skipDuplicates:true,data:candidates.map(item => ({
        ...item,baseId:base.id,question:item.title,questionKey:questionKey(item.title),
        source:'学校官方门户 · '+portalNavigationObservedAt,mode:'RAG',status:'APPROVED',
        summary:item.answer,
      }))})
      if (inserted.count) {
        await this.knowledge.bump(tx)
        await tx.auditLog.create({data:{userId:actor.id,actor:actor.email,action:'portal.navigation.install',
          resource:'knowledge_base',resourceId:base.id,detail:{added:inserted.count},success:true}})
      }
      await tx.setting.upsert({where:{key:directoryRevision},create:{key:directoryRevision,value:portalNavigationObservedAt,group:'internal'},update:{value:portalNavigationObservedAt}})
      return {baseId:base.id,added:inserted.count,total:candidates.length,applications:observedPortalAppNames.length}
    })
  }

  async list(section: PortalSection) {
    if(section==='services'){
      const rows=await this.serviceRows()
      const items=rows.map(row=>{const m=metadata(row);return {id:row.id,title:row.title,category:m.sectionPath?.[0]||row.cat,source:'校园事务 2.0',summary:String(row.summaryShort||'').slice(0,170),url:safePortalUrl(row.url),department:row.dept,campus:row.campus,keywords:words(m.aliases)}})
      return {items,sourceUrl:officialPortal+'apps'}
    }
    const managed = await this.prisma.knowledgeEntry.findMany({
        where: this.managedWhere(section), orderBy: [{updatedAt:'desc'},{id:'asc'}], take: 3000,
        select: {id:true,title:true,question:true,answer:true,summary:true,url:true,source:true,externalKey:true,baseId:true,
          aliases:true,base:{select:{name:true,kind:true,connection:true}}},
    })
    const seen = new Set<string>(), items: PortalItem[] = []
    const insert = (item: PortalItem) => {
      const key = titleKey(item.title)
      if (!key || seen.has(key)) return
      seen.add(key)
      items.push(item)
    }
    managed.sort((a,b) => {
      const part = (key: string | null) => /^wechat:.+:\d+$/.test(key || '') ? Number(key!.split(':').at(-1)) : 0
      return part(a.externalKey)-part(b.externalKey)
    })
    for (const row of managed) {
      const url = safePortalUrl(row.url,section==='information')
      const directoryRow = row.externalKey && (row.externalKey.startsWith('ucass-portal-nav:az:')||observedNavigationKeys.has(row.externalKey))
      if (!url || /模拟校园门户|赛事模拟/.test(row.answer.slice(0,600)) || section==='applications'&&!directoryRow&&!observedApps.has(titleKey(row.title))) continue
      const wechat = row.base.kind==='WECHAT'
      const date = section==='information' ? calendarDate(row.source) ||
        row.answer.match(/(?:发布(?:日期|时间)|日期)[：:]\s*(\d{4}-\d{2}-\d{2})/)?.[1] : undefined
      insert({id:'managed:'+row.id,title:row.title.replace(/（\d+\/\d+）$/,''),url,date,
        source:row.source || row.base.name,
        category:(section==='information'?'学校要闻':wechat ? '公众号资讯' : managedTaxonomy(row).sectionPath?.[1]) ||
          (section==='information'?(row.baseId===publicNewsBase ? row.source.split(' · ').at(-1) || '官网资讯' : '学校通知'):section==='applications'?'校园应用':'办事指南'),
        kind:section==='information'?(wechat?'news':'notice'):undefined,
        keywords:[row.question,...words(row.aliases)],summary:(row.summary || row.answer).slice(0,210),
      })
    }
    if(section==='information'&&!items.length&&!await this.prisma.knowledgeBase.findUnique({where:{id:publicNewsBase},select:{id:true}})){
      const headlines=await this.news.headlines()
      for(const row of headlines)insert({id:'official:'+questionKey(row.url),title:row.title,category:'学校要闻',source:'中国社会科学院大学官网',summary:'',url:row.url,date:row.published,kind:'official-link'})
    }
    items.sort((a,b) => section==='information' ? (b.date || '').localeCompare(a.date || '') || a.title.localeCompare(b.title,'zh-CN')
      : a.title.localeCompare(b.title,'zh-CN'))
    return {items,sourceUrl:section==='information'?officialHeadlines:officialPortal+'apps'}
  }

  async detail(section: PortalSection, id: string) {
    if (!/^(?:managed:)?[a-z0-9_-]{1,100}$/i.test(id)) throw new NotFoundException()
    if(section==='services'){
      const row=(await this.serviceRows(id))[0]
      if(!row)throw new NotFoundException('未找到 2.0 办事流程')
      return {detail:row.detail||row.summaryShort,steps:words(row.steps),materials:words((row.detailParts as {materials?:unknown}|null)?.materials),place:row.place,department:row.dept,campus:row.campus,officeTime:row.officeTime,note:'2.0 手册含演示资料，实际受理条件请核对学校办事平台。',source:'校园事务 2.0',url:safePortalUrl(row.url)}
    }
    const detail = await this.guide.detail(id)
    let visible = false
    if (id.startsWith('managed:')) {
      visible = !!await this.prisma.knowledgeEntry.findFirst({
        where:{id:id.slice('managed:'.length),...this.managedWhere(section)},select:{id:true},
      }) && !!safePortalUrl(detail.url,section==='information') && !/模拟校园门户|赛事模拟/.test((detail.detail || '').slice(0,600))
    }
    if (!visible) throw new NotFoundException('条目未发布、已停用或不属于该目录')
    const parts = detail.detailParts as {materials?: unknown} | null
    return {detail: detail.detail || detail.summaryShort, steps:detail.steps, place:detail.place,
      department:detail.dept,campus:detail.campus,materials:words(parts?.materials),officeTime:detail.officeTime,
      note:detail.note, source:detail.source, url:safePortalUrl(detail.url,section==='information')}
  }

  private managedWhere(section: PortalSection): Prisma.KnowledgeEntryWhereInput {
    const normal = {mounted:true,agentId:null}
    const restrictions: Prisma.KnowledgeEntryWhereInput[] = section==='information' ? [
      {base:{...normal,kind:'LOCAL',id:publicNewsBase},externalKey:{startsWith:'ucass-public-news:'},source:{contains:'学校要闻'}},
      {base:{...normal,kind:'LOCAL',id:publicNewsBase},externalKey:{startsWith:'ucass-public-news:headline:'}},
      {base:{...normal,kind:'LOCAL',id:publicNewsBase},externalKey:{startsWith:'ucass-public-news:manual:'}},
    ] : section==='applications' ? [
      {base:{...normal,id:portalNavigationBase},externalKey:{startsWith:'ucass-portal-nav:apps:'}},
      {base:{...normal,id:portalNavigationBase},externalKey:{startsWith:'ucass-portal-nav:az:'}},
    ] : [
      {base:{...normal,id:verifiedServices},externalKey:{startsWith:'portal-services:'}},
      {base:{...normal,id:fusion},externalKey:{startsWith:'portal-fusion:apps:'}},
      {base:{...normal,id:fusion},externalKey:{startsWith:'portal-fusion:alignment:'}},
      {base:{...normal,id:portalNavigationBase},externalKey:{startsWith:'ucass-portal-nav:services:'}},
    ]
    return {status:'APPROVED', mode:'RAG',OR:restrictions}
  }

  private async serviceRows(id?:string){
    const sources=await this.prisma.knowledgeBase.findMany({where:{id:{in:[CONTEST_MARKDOWN,CONTEST_SQLITE].map(embeddedSourceId)},mounted:true,kind:'EMBEDDED',agentId:null},select:{id:true}})
    const enabled=new Set(sources.map(x=>x.id)),conditions:Prisma.CampusGuideItemWhereInput[]=[]
    if(enabled.has(embeddedSourceId(CONTEST_MARKDOWN)))conditions.push({extra:{path:['kb','file'],string_starts_with:'knowledge/'}})
    if(enabled.has(embeddedSourceId(CONTEST_SQLITE)))conditions.push({AND:[{extra:{path:['kb','file'],equals:'database/campus.sqlite'}},{extra:{path:['kb','table'],equals:'services'}}]})
    if(!conditions.length)return []
    const rows=await this.prisma.campusGuideItem.findMany({where:{AND:[{extra:{path:['kb','collection'],equals:'campus-v2-contest'}},{OR:conditions}]},orderBy:[{title:'asc'},{id:'asc'}],take:1000})
    const unique=new Map<string,typeof rows[number]>()
    for(const row of rows){
      const meta=metadata(row), key=titleKey(meta.originalTitle||row.title), prior=unique.get(key)
      const previous=prior?metadata(prior):null
      const edited=String(meta.adminEditedAt||''), previousEdit=String(previous?.adminEditedAt||'')
      if(!prior||edited>previousEdit||edited===previousEdit&&String(meta.file).startsWith('knowledge/'))unique.set(key,row)
    }
    return [...unique.values()].filter(row=>!metadata(row).superseded&&(!id||row.id===id))
  }
}
