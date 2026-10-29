import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { createHash } from 'node:crypto'
import {Prisma} from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../common/services/audit.service'
import { type KnowledgeRow } from '../campus/knowledge-retriever'
import {parseKeywordRule,matchesKeywordRule,isSupportUrgent} from './keyword-rule'
import {embeddedSourceWhere,sourceDefinition,CONTEST_SQLITE,CONTEST_MARKDOWN,LEGACY_SOURCE} from './embedded-knowledge'
import {foodSource,foodItem,dinnerEligible,mealName,type FoodItem} from './food-catalog'
import {defaultShortcuts,shortcutBindingsSchema,shortcutSettingPrefix} from './knowledge-shortcuts'
import {managedTaxonomy} from './managed-taxonomy'

export interface EntryInput {baseId:string; title:string; question?:string; answer:string; aliases?:string[]; url?:string;
  mode?:string; status?:string; priority?:number; source?:string; sourceMessageId?:string}
export const normalizeQuestion = (question:string) => String(question || '').normalize('NFKC').toLowerCase()
  .replace(/[\s\u200b-\u200d\ufeff]/g,'').replace(/[\p{P}\p{S}]/gu,ch => /[+\-*/%=<>¥￥$]/.test(ch) ? ch : '')
export const questionKey = (question:string) => createHash('sha256').update(normalizeQuestion(question)).digest('hex')
export function entryData(input:EntryInput) {
  if (!input.title?.trim() || !input.answer?.trim()) throw new BadRequestException('标题和答案不能为空')
  const mode = input.mode || 'RAG', status = input.status || 'DRAFT'
  if (!['RAG','FIXED','CORRECTION','TRIGGER'].includes(mode) || !['DRAFT','APPROVED','ARCHIVED'].includes(status)) throw new BadRequestException('无效的条目模式或状态')
  if(mode==='TRIGGER')try{parseKeywordRule(input.answer)}catch{throw new BadRequestException('关键词规则 JSON 无效，请检查匹配词、行为和卡片格式')}
  const question = input.question?.trim() || input.title.trim()
  if (input.url && !/^https?:\/\//i.test(input.url)) throw new BadRequestException('来源链接需为 http(s) 地址')
  const aliases = [...new Set((input.aliases || []).filter(a => typeof a === 'string' && a.trim()).map(a => a.trim()))].slice(0,30)
  return {title:input.title.trim(), question, questionKey:questionKey(question), answer:input.answer.trim(), aliases,
    url:input.url || '', mode, status, priority:mode === 'CORRECTION' ? 100 : Math.min(Math.max(input.priority || 50,1),90),
    source:input.source || '管理员维护', sourceMessageId:input.sourceMessageId || null}
}

@Injectable()
export class KnowledgeStoreService {
  constructor(private prisma:PrismaService,private audit:AuditService) {}
  async shortcutBindings(baseId:string){
    const base=await this.prisma.knowledgeBase.findUnique({where:{id:baseId}})
    if(!base||base.kind==='REMOVED')throw new NotFoundException('知识库不存在或已移除')
    const setting=await this.prisma.setting.findUnique({where:{key:shortcutSettingPrefix+baseId}})
    return setting?shortcutBindingsSchema.parse(setting.value):defaultShortcuts(base,sourceDefinition(foodSource,['takeout']).id)
  }
  async saveShortcutBindings(baseId:string,input:unknown,operator:{id:string;email:string}){
    const parsed=shortcutBindingsSchema.safeParse(input)
    if(!parsed.success)throw new BadRequestException('每库最多 6 个按钮；名称 1–30 字、问题 1–500 字，依赖最多 8 个知识库')
    const bindings=parsed.data
    if(new Set(bindings.map(b=>b.label)).size!==bindings.length)throw new BadRequestException('同一知识库内按钮名称不能重复')
    await this.prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM knowledge_bases WHERE id=${baseId} FOR UPDATE`
      const base=await tx.knowledgeBase.findUnique({where:{id:baseId}})
      if(!base||base.kind==='REMOVED')throw new NotFoundException('知识库不存在或已移除')
      const dependencies=[...new Set(bindings.flatMap(b=>b.dependencies))]
      if(dependencies.length!==await tx.knowledgeBase.count({where:{id:{in:dependencies},kind:{not:'REMOVED'}}}))throw new BadRequestException('依赖知识库不存在或已移除')
      const value=bindings as Prisma.InputJsonValue,key=shortcutSettingPrefix+baseId
      await tx.setting.upsert({where:{key},create:{key,group:'campus',value},update:{value}})
      await this.bump(tx)
    })
    await this.audit.log({userId:operator.id,actor:operator.email,action:'knowledge.shortcuts',resource:'knowledge_base',resourceId:baseId,detail:{count:bindings.length}})
    return bindings
  }
  async publicShortcuts(){
    const [bases,settings]=await Promise.all([
      this.prisma.knowledgeBase.findMany({where:{kind:{not:'REMOVED'}},select:{id:true,name:true,mounted:true,agentId:true,connection:true},orderBy:{createdAt:'asc'}}),
      this.prisma.setting.findMany({where:{key:{startsWith:shortcutSettingPrefix}},select:{key:true,value:true}})
    ])
    const mounted=new Set(bases.filter(b=>b.mounted&&!b.agentId).map(b=>b.id)),configured=new Map(settings.map(s=>[s.key,s.value]))
    return bases.flatMap(base=>{
      if(!mounted.has(base.id))return []
      const key=shortcutSettingPrefix+base.id,parsed=shortcutBindingsSchema.safeParse(configured.has(key)?configured.get(key):defaultShortcuts(base,sourceDefinition(foodSource,['takeout']).id))
      if(!parsed.success)return []
      return parsed.data.flatMap((binding,index)=>binding.enabled&&binding.dependencies.every(id=>mounted.has(id))?[{id:base.id+':'+index,label:binding.label,question:binding.question}]:[])
    }).slice(0,120)
  }
  private foodSnapshot?:{revision:unknown;expires:number;items:FoodItem[]}
  async foodItems(agentId?:string|null):Promise<FoodItem[]>{
    await this.ensureEmbedded()
    const base=await this.prisma.knowledgeBase.findUnique({where:{id:sourceDefinition(foodSource,['takeout']).id},select:{kind:true,mounted:true,agentId:true}})
    if(base&&(!base.mounted||base.kind==='REMOVED'||base.agentId&&base.agentId!==agentId))return []
    const revision=await this.revision()
    if(this.foodSnapshot?.revision===revision&&this.foodSnapshot.expires>Date.now())return this.foodSnapshot.items
    const rows=await this.prisma.campusGuideItem.findMany({where:{AND:[{extra:{path:['kb','file'],equals:foodSource}},{extra:{path:['kb','collection'],equals:'takeout'}}]},select:{extra:true},orderBy:{externalId:'asc'}})
    const unique=new Map<number,FoodItem>()
    for(const row of rows){const item=foodItem((row.extra as any)?.food);if(item)unique.set(item.id,item)}
    const items=[...unique.values()].sort((a,b)=>a.id-b.id)
    this.foodSnapshot={revision,expires:Date.now()+60_000,items};return items
  }
  async foodDirectory(query:Record<string,string>={}){
    const items=await this.foodItems(),term=(query.q||'').slice(0,80).normalize('NFKC').toLowerCase(),verdict=query.verdict||'',category=query.category||'',place=query.place||''
    const filtered=items.filter(i=>(!query.id||String(i.id)===query.id)&&(!verdict||i.verdict===verdict)&&(!category||i.category===category)&&(!place||i.pgroup===place)&&(!term||[i.name,i.place,...i.reviews].join(' ').normalize('NFKC').toLowerCase().includes(term)))
    const page=Math.max(1,Math.min(100,Math.trunc(Number(query.page)||1))),pageSize=20
    return {items:filtered.slice((page-1)*pageSize,page*pageSize),total:filtered.length,page,pageSize,enabled:items.length>0,counts:{all:items.length,good:items.filter(i=>i.verdict==='good').length,mixed:items.filter(i=>i.verdict==='mixed').length,bad:items.filter(i=>i.verdict==='bad').length},categories:[...new Set(items.map(i=>i.category))],places:[...new Set(items.map(i=>i.pgroup))]}
  }
  async embeddedCounts(){
    return this.prisma.$queryRaw<{sourceKey:string;collections:string[];count:bigint}[]>`SELECT CASE WHEN extra #>> '{kb,collection}' = 'campus-v2-contest' THEN CASE WHEN extra #>> '{kb,file}' = 'database/campus.sqlite' THEN 'campus-v2-contest/database/campus.sqlite' ELSE 'campus-v2-contest/knowledge' END ELSE COALESCE(NULLIF(extra #>> '{kb,file}', ''), 'legacy/guide_v4.json') END AS "sourceKey", array_agg(DISTINCT COALESCE(NULLIF(extra #>> '{kb,collection}', ''), 'legacy')) AS collections, count(*) AS count FROM campus_guide_items WHERE (external_id < 2000000 OR external_id >= 3000000 OR NOT EXISTS(SELECT 1 FROM campus_guide_items WHERE external_id >= 500000000 AND external_id < 900000000)) AND (extra #>> '{kb,superseded}') IS DISTINCT FROM 'true' GROUP BY 1`
  }
  private embeddedSnapshot?:{revision:unknown;expires:number;counts:Awaited<ReturnType<KnowledgeStoreService['embeddedCounts']>>}
  private embeddedRequest:Promise<Awaited<ReturnType<KnowledgeStoreService['embeddedCounts']>>>|null=null
  async ensureEmbedded(){
    const revision=await this.revision()
    if(this.embeddedSnapshot?.revision===revision&&this.embeddedSnapshot.expires>Date.now())return this.embeddedSnapshot.counts
    if(this.embeddedRequest)return this.embeddedRequest
    const request=this.refreshEmbedded()
    this.embeddedRequest=request
    try{const counts=await request;this.embeddedSnapshot={revision:await this.revision(),expires:Date.now()+30000,counts};return counts}finally{if(this.embeddedRequest===request)this.embeddedRequest=null}
  }
  private async refreshEmbedded(){
    const counts=await this.embeddedCounts(),existing=await this.prisma.knowledgeBase.findMany({where:{kind:{in:['EMBEDDED','EMBEDDED_GROUP','REMOVED']}}}),sources=new Set(existing.filter(b=>(b.connection as any)?.sourceKey).map(b=>b.id)),groups=existing.filter(b=>b.kind!=='REMOVED'&&!(b.connection as any)?.sourceKey),missing=counts.filter(c=>!sources.has(sourceDefinition(c.sourceKey,c.collections).id))
    const retiring=groups.filter(b=>b.kind==='EMBEDDED')
    if(missing.length||retiring.length)await this.prisma.$transaction(async tx=>{for(const c of missing){const data=sourceDefinition(c.sourceKey,c.collections),parents=groups.filter(b=>c.collections.includes((b.connection as any)?.collection));if(parents.length)data.mounted=data.mounted&&parents.every(b=>b.mounted);await tx.knowledgeBase.upsert({where:{id:data.id},create:data,update:{}})}if(retiring.length)await tx.knowledgeBase.updateMany({where:{id:{in:retiring.map(b=>b.id)}},data:{kind:'EMBEDDED_GROUP'}});await this.bump(tx)})
    return counts
  }
  async embeddedWhere():Promise<Prisma.CampusGuideItemWhereInput>{
    await this.ensureEmbedded()
    const disabled=await this.prisma.knowledgeBase.findMany({where:{mounted:false,OR:[{kind:'EMBEDDED'},{kind:'REMOVED',connection:{path:['removedKind'],equals:'EMBEDDED'}}]},select:{connection:true}}),sources=disabled.map(b=>(b.connection as any)?.sourceKey).filter((c):c is string=>typeof c==='string')
    if(!sources.length)return {}
    const rejected=sources.map(embeddedSourceWhere)
    return sources.includes(LEGACY_SOURCE)?{NOT:{OR:rejected}}:{OR:[embeddedSourceWhere(LEGACY_SOURCE),{NOT:{OR:rejected}}]}
  }
  async embeddedEnabled(collection:string,agentId?:string|null){await this.ensureEmbedded();const bases=await this.prisma.knowledgeBase.findMany({where:{OR:[{kind:'EMBEDDED'},{kind:'REMOVED',connection:{path:['removedKind'],equals:'EMBEDDED'}}]},select:{mounted:true,agentId:true,connection:true}}),matching=bases.filter(b=>((b.connection as any)?.collections||[]).includes(collection));return !matching.length||matching.some(b=>b.mounted&&(!b.agentId||b.agentId===agentId))}
  async embeddedEntries(base:any,keyword='',status='',page=1,section=''){
    const sourceKey=base.connection?.sourceKey
    if(typeof sourceKey!=='string')throw new BadRequestException('内嵌知识库配置无效')
    const sections:{value:string;label:string;count:number}[]=sourceKey===CONTEST_SQLITE?Object.entries(base.connection.tableCounts||{}).map(([value,count])=>({value,label:value,count:Number(count)})):sourceKey===CONTEST_MARKDOWN?(await this.prisma.$queryRaw<{file:string;count:bigint}[]>`SELECT extra #>> '{kb,file}' AS file,count(*) AS count FROM campus_guide_items WHERE extra #>> '{kb,collection}'='campus-v2-contest' AND extra #>> '{kb,file}' LIKE 'knowledge/%' GROUP BY 1 ORDER BY 1`).map(r=>({value:r.file,label:r.file,count:Number(r.count)})):[]
    if(section&&!sections.some(s=>s.value===section))throw new BadRequestException('资料表或文件不存在')
    const where:Prisma.CampusGuideItemWhereInput={AND:[embeddedSourceWhere(sourceKey),{OR:[{extra:{path:['kb','superseded'],equals:Prisma.AnyNull}},{NOT:{extra:{path:['kb','superseded'],equals:true}}}]},...(section?[{extra:{path:['kb',sourceKey===CONTEST_SQLITE?'table':'file'],equals:section}}]:[])],...(keyword?{OR:[{title:{contains:keyword,mode:'insensitive'}},{searchText:{contains:keyword,mode:'insensitive'}},{detail:{contains:keyword,mode:'insensitive'}}]}:{})}
    if(status&&status!=='APPROVED')return {items:[],total:0,page,pageSize:20,sections}
    const result=await this.prisma.paginate(this.prisma.campusGuideItem,{where,orderBy:[{title:'asc'},{id:'asc'}]},page,20)
    return {...result,sections,items:result.items.map((r:any)=>({id:r.id,baseId:base.id,base:{name:base.name},title:r.title,question:r.title,answer:r.detail||r.summaryShort,aliases:r.extra?.kb?.aliases||[],url:r.url,mode:'RAG',status:'APPROVED',source:r.source,hitCount:r.views,readOnly:true,locator:r.extra?.kb?.locator||String(r.externalId),simulation:base.connection?.simulation===true}))}
  }
  async revision() { return (await this.prisma.setting.findUnique({where:{key:'knowledge_revision'}}))?.value || '' }
  async bump(tx:any = this.prisma) {
    this.embeddedSnapshot=undefined
    const value = `${Date.now()}-${Math.random()}`
    await tx.setting.upsert({where:{key:'knowledge_revision'},create:{key:'knowledge_revision',group:'campus',value},update:{value}})
  }
  async rows():Promise<KnowledgeRow[]> {
    const entries = await this.prisma.knowledgeEntry.findMany({where:{status:'APPROVED',mode:{not:'TRIGGER'},base:{mounted:true}},include:{base:true},orderBy:{id:'asc'}})
    return entries.flatMap(e => {
      // Managed content uses the same 900-character child projection, with a stable parent ID.
      const parts = e.answer.match(/[\s\S]{1,900}/g) || []
      return parts.map((detail,i) => ({id:`managed:${e.id}:${i}`,externalId:-(parseInt(createHash('sha256').update(e.id+':'+i).digest('hex').slice(0,7),16)+1),
        title:e.title, url:e.url, cat:e.base.name, type:'知识', source:e.source || e.base.name, summaryShort:detail, detail,
        searchText:[e.title,e.question,e.summary,...(e.aliases as string[]),detail].join(' ').toLowerCase(),
        detailStatus:'basic', verifiedAt:e.updatedAt.toISOString(), extra:{kb:{...managedTaxonomy(e),collection:`base:${e.baseId}`,parent:e.id,
          file:e.base.name, locator:e.externalKey || e.id, trust:(e.aiReview as any)?.method==='AI'&&e.aiReviewStatus==='APPROVED'?'ai_reviewed':'reviewed', agentId:e.base.agentId, aliases:[e.question,...(e.aliases as string[])],
          entryKind:e.url ? 'source' : 'none', mode:e.mode, relations:[]}}}))
    })
  }
  async fixed(query:string,agentId?:string|null,countHit=true) {
    const entries = await this.prisma.knowledgeEntry.findMany({where:{status:'APPROVED',mode:{in:['FIXED','CORRECTION']},
      base:{mounted:true,OR:[{agentId:null},...(agentId ? [{agentId}] : [])]}},include:{base:true},orderBy:[{priority:'desc'},{updatedAt:'desc'},{id:'asc'}]})
    const key = normalizeQuestion(query)
    if (!key) return null
    const scoped = (e:typeof entries[number]) => e.base.agentId ? 1 : 0
    const matches = entries.filter(e => [e.question,...(e.aliases as string[])].some(q => normalizeQuestion(q) === key))
      .sort((a,b)=>b.priority-a.priority || scoped(b)-scoped(a))
    if (!matches.length) return null
    const best = matches[0]
    if (matches.some(e => e.priority === best.priority && scoped(e)===scoped(best) && e.answer !== best.answer)) throw new BadRequestException('该问题存在同优先级的固定答案冲突，请管理员处理后再查询。')
    if (countHit) await this.prisma.knowledgeEntry.update({where:{id:best.id},data:{hitCount:{increment:1}}})
    return best
  }
  async hasMountedBase(agentId:string) {
    return (await this.prisma.knowledgeBase.count({where:{mounted:true,agentId,entries:{some:{status:'APPROVED'}}}})) > 0
  }
  async keywordRules(query:string,agentId?:string|null){
    if(isSupportUrgent(query))return []
    const entries=await this.prisma.knowledgeEntry.findMany({where:{mode:'TRIGGER',status:'APPROVED',base:{mounted:true,OR:[{agentId:null},...(agentId?[{agentId}]:[])]}},orderBy:[{priority:'desc'},{id:'asc'}]})
    const matched=entries.flatMap(entry=>{try{const rule=parseKeywordRule(entry.answer);return matchesKeywordRule(rule,query)?[{entry,rule}]:[]}catch{return []}}).slice(0,6)
    // Read only red-list rows from an enabled source. No black-list rows enter a dinner card.
    if(matched.some(({rule})=>rule.card?.type==='dinner'&&rule.card.sourceCollection==='takeout')){
      const enabled=await this.embeddedEnabled('takeout',agentId)
      const rows=enabled?await this.prisma.campusGuideItem.findMany({where:{AND:[await this.embeddedWhere(),{extra:{path:['kb','file'],equals:'社科大外卖红黑榜_RAG.json'}},{extra:{path:['kb','collection'],equals:'takeout'}},{extra:{path:['kb','audience'],equals:'红榜'}}]},select:{title:true},orderBy:{externalId:'asc'}}):[]
      const catalog=enabled?await this.foodItems(agentId):[],eligible=catalog.filter(dinnerEligible),redNames=catalog.length?[...new Set(eligible.map(mealName).filter(n=>n!=='麦当劳'))]:[...new Set(rows.map(row=>row.title.trim()).filter(name=>!!name&&name.length<=80&&name!=='麦当劳'))]
      for(const {rule} of matched)if(rule.card?.type==='dinner'&&rule.card.sourceCollection==='takeout')rule.card={...rule.card,restaurants:[...new Set([...rule.card.restaurants,...redNames,...(enabled&&!catalog.length?rule.card.additionalRestaurants||[]:[])])].slice(0,500),foodItems:eligible.map(({id,name,category,price,place,pgroup})=>({id,name:name==='麦当劳'?'三食堂（麦当劳）':mealName({pgroup,name} as FoodItem),category,price,place,pgroup})),sourceCount:eligible.length,redNameCount:redNames.length,note:enabled?'与红榜使用同一份完整名单；同名条目合并为一个选餐候选，麦当劳归入三食堂，另保留一、二食堂入口。可按类别或地点筛选。价格、营业及配送未实时核验。':'外卖红榜已停用，目前仅展示管理员配置的食堂候选；三食堂是麦当劳的称呼。'}
    }
    return matched
  }
  async save(input:EntryInput,operator:{id:string;email:string},id?:string) {
    const base = await this.prisma.knowledgeBase.findUnique({where:{id:input.baseId}})
    if (!base||base.kind==='REMOVED') throw new NotFoundException('知识库不存在或已移除')
    if(base.kind==='EMBEDDED')throw new BadRequestException('内嵌资料只读，请通过管理员纠错库补充正确答案')
    const data = entryData(input)
    const result = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM knowledge_bases WHERE id=${input.baseId} FOR UPDATE`
      const currentBase=await tx.knowledgeBase.findUnique({where:{id:input.baseId}})
      if(!currentBase||currentBase.kind==='REMOVED')throw new NotFoundException('知识库不存在或已移除')
      let moved=false,resetAutomation=false
      if (id) {
        const old = await tx.knowledgeEntry.findUnique({where:{id}})
        if (!old) throw new NotFoundException('条目不存在')
        moved=old.baseId!==input.baseId
        resetAutomation=moved||['title','question','answer','url','source','mode'].some(k=>(old as any)[k]!==data[k as keyof typeof data])||JSON.stringify(old.aliases)!==JSON.stringify(data.aliases)
        if(moved)data.status='DRAFT'
        await tx.knowledgeRevision.create({data:{entryId:id,snapshot:JSON.parse(JSON.stringify(old)),operatorId:operator.id}})
      }
      const duplicate = await tx.knowledgeEntry.findUnique({where:{baseId_questionKey:{baseId:input.baseId,questionKey:data.questionKey}}})
      if (duplicate && duplicate.id !== id) throw new BadRequestException('此库已有相同问题，请编辑原条目')
      const saved = id ? await tx.knowledgeEntry.update({where:{id},data:{...data,baseId:input.baseId,...(moved?{externalKey:null}:{}),...(resetAutomation?{summary:'',aiReviewStatus:'IDLE',aiReview:Prisma.DbNull,automationFingerprint:null,automationUpdatedAt:null}:{}),reviewedById:data.status==='APPROVED' ? operator.id : null}})
        : await tx.knowledgeEntry.create({data:{...data,baseId:input.baseId,reviewedById:data.status==='APPROVED' ? operator.id : null}})
      await this.bump(tx)
      return saved
    })
    await this.audit.log({userId:operator.id,actor:operator.email,action:id?'knowledge.edit':'knowledge.create',resource:'knowledge_entry',resourceId:result.id,detail:{mode:result.mode,status:result.status}})
    return result
  }
  async pinCorrection(input:{question:string;answer:string;agentId?:string|null;sourceMessageId?:string;source?:string},operator:{id:string;email:string}) {
    const id = `corrections-${input.agentId || 'global'}`
    const base = await this.prisma.knowledgeBase.upsert({where:{id},create:{id,name:'管理员纠错',mounted:true,agentId:input.agentId || null},update:{}})
    const old = await this.prisma.knowledgeEntry.findUnique({where:{baseId_questionKey:{baseId:base.id,questionKey:questionKey(input.question)}}})
    return this.save({baseId:base.id,title:input.question,question:input.question,answer:input.answer,mode:'CORRECTION',status:'APPROVED',sourceMessageId:input.sourceMessageId,source:input.source},operator,old?.id)
  }
  async archive(id:string,operator:{id:string;email:string},expectedSource?:string) {
    const entry = await this.prisma.knowledgeEntry.findUnique({where:{id}})
    if (!entry || entry.status === 'ARCHIVED' || (expectedSource && entry.source !== expectedSource)) return
    return this.save({...entry,aliases:entry.aliases as string[],status:'ARCHIVED',sourceMessageId:entry.sourceMessageId || undefined},operator,id)
  }
}
