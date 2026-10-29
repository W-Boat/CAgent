import {COURSE_COLLECTION,collectiveIntent,matchesCourseConstraints} from '../knowledge/collective-timetable'
/** Deterministic local retrieval. The index is replaceable; response/provenance stay stable. */
export const KNOWLEDGE_SKILL_COLLECTIONS: Record<string, string> = {
  'ucass-kb-survival': 'survival', 'ucass-kb-takeout': 'takeout'
}
export const isKnowledgeSkill = (skill:{key:string;category?:string}) => !!KNOWLEDGE_SKILL_COLLECTIONS[skill.key]
  || (skill.key.startsWith('kb-') && skill.category === '校园知识库')
export const normalize = (text: unknown): string => String(text ?? '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
const STOP = new Set(['怎么','如何','什么','哪里','在哪','哪个','可以','能办','办吗','需要','我要','我想','这个','那个','一下','帮我','请问','有没有','办理','申请','办理指引','事项','查询','咨询','时候','周末','电话','地点','材料','工作日','线上','线下','详细','推荐','知道','现在','是否','多少','不能','可以线上办吗','在哪里办','要什么材料'])
for(const term of ['概况','概览','具体','介绍'])STOP.add(term)
export function terms(text: string): string[] {
  const result = new Set<string>()
  for (const run of text.normalize('NFKC').toLowerCase().match(/[a-z0-9][a-z0-9_-]*|[\u3400-\u9fff]+/g) || []) {
    if (/^[a-z0-9]/.test(run)) { result.add(run); continue }
    for (const n of [2, 3]) for (let i=0; i<=run.length-n; i++) {
      const t = run.slice(i,i+n)
      if (!STOP.has(t)) result.add(t)
    }
  }
  return [...result]
}
export function excerptForQuery(text:string,query:string,max=420):string {
  if (text.length<=max) return text
  const facets=['电话','地址','地点','材料','费用','时间','工作量','给分','部门','入口','步骤'].filter(t=>query.includes(t))
  const queryTerms=[...new Set([...terms(query),...facets])]
  const score=(s:string)=>queryTerms.reduce((n,t)=>n+(s.toLowerCase().includes(t)?facets.includes(t)?3:1:0),0)
  const window=(s:string)=>{
    if(s.length<=max)return s
    const starts=[0,...queryTerms.flatMap(t=>{const at=s.toLowerCase().indexOf(t);return at<0?[]:[Math.max(0,at-Math.floor(max/3))]})]
    return starts.map(at=>s.slice(at,at+max-1)).sort((a,b)=>score(b)-score(a))[0]+'…'
  }
  const sentences=text.split(/(?<=[。！？；\n])/u)
  const ranked=sentences.map((s,i)=>({s,i,score:score(s)}))
    .sort((a,b)=>b.score-a.score||a.i-b.i)
  const picked:typeof ranked=[];let size=0
  for(const sentence of ranked) {
    const value=window(sentence.s)
    if(size+value.length<=max){picked.push({...sentence,s:value});size+=value.length}
  }
  return picked.sort((a,b)=>a.i-b.i).map(s=>s.s).join('')
}
export interface KnowledgeRow {
  id: string; externalId: number; title: string; searchText: string; source?: string; type?: string
  name?: string | null; summaryShort?: string; detail?: string | null; extra?: any; url?: string
  detailStatus?: string; verifiedAt?: string | null; [key: string]: any
}
export interface RetrievalOptions { collection?: string; topic?:string; previousQuery?: string; limit?: number; agentId?:string|null; managedOnly?:boolean; sourceKeys?:readonly string[] }
export interface RankedRow { row: KnowledgeRow; score: number; reasons: string[]; related: KnowledgeRow[] }
export function metadata(row: KnowledgeRow) {
  const extra = row.extra && !Array.isArray(row.extra) ? row.extra : {}
  return { trust: /榜题|行知校园/.test(row.source || '') ? 'curated' : /课程|红黑|辛瓜|UCASSbook/.test(row.source || '') ? 'community' : 'official_index',
    collection: 'legacy', parent: row.id, aliases: extra.benchmark_aliases || extra.aliases || [],
    relations: [...(extra.matter_id ? [`matter:${extra.matter_id}`] : []), ...(extra.matter_ids || []).map((id: string) => `matter:${id}`)], ...extra.kb }
}
export class KnowledgeRetriever {
  readonly rows: KnowledgeRow[]
  private postings = new Map<string, Map<number, number>>()
  private lengths: number[] = []
  private average = 1
  private phrases = new Map<string, Set<number>>()
  private related = new Map<string, Set<number>>()
  constructor(rows: KnowledgeRow[]) {
    const sourceFiles=new Set(rows.map(r=>r.extra?.kb?.file).filter(Boolean))
    const hasUnifiedIndex = rows.some(r => r.extra?.kb?.schema === 'kb/v2')
    // Legacy demo records cannot become evidence, even before an operator reimports v2.
    this.rows = rows.filter(r => (!r.extra?.kb?.derivedFrom||!sourceFiles.has(r.extra.kb.derivedFrom)) && r.extra?.kb?.indexable!==false && !(hasUnifiedIndex && r.externalId >= 2_000_000 && r.externalId < 3_000_000 && !r.extra?.kb)
      && !r.extra?.kb?.superseded && (r.extra?.kb?.collection==='campus-v2-contest'&&r.extra?.kb?.simulation===true || !/示例|半真实|模拟/.test(JSON.stringify(r.extra?.kb?.sourceClaim || r.extra?.data_status || '') + (r.note || ''))))
    this.rows.forEach((row, i) => {
      const meta = metadata(row)
      const fields: [string, number][] = [[row.title, 5], [row.name || '', 4],
        [(meta.sectionPath || []).join(' '),2],
        [Array.isArray(meta.aliases) ? meta.aliases.join(' ') : '', 4], [row.searchText || row.summaryShort || '', 1]]
      const tf = new Map<string, number>()
      for (const [text, weight] of fields) for (const t of terms(text)) tf.set(t, (tf.get(t) || 0) + weight)
      this.lengths[i] = Math.max(tf.size, 1)
      for (const [t, freq] of tf) {
        if (!this.postings.has(t)) this.postings.set(t, new Map())
        this.postings.get(t)!.set(i, freq)
      }
      const titleCore = row.title.replace(/[（(].*?[）)]/g, '').trim()
      for (const phrase of [row.title, titleCore, ...(Array.isArray(meta.aliases) ? meta.aliases : [])]) {
        const key = normalize(phrase)
        if (key.length < 2 || key.length > 64 || STOP.has(key)) continue
        if (!this.phrases.has(key)) this.phrases.set(key, new Set())
        this.phrases.get(key)!.add(i)
      }
      // Relations are explicit matter IDs, exact titles and sibling parts, never a department fanout.
      for (const key of [`parent:${meta.parent}`, `title:${normalize(row.title)}`, ...(meta.sectionKey ? [`section:${meta.sectionKey}`] : []), ...(meta.relations || [])]) {
        if (!this.related.has(key)) this.related.set(key, new Set())
        this.related.get(key)!.add(i)
      }
    })
    this.average = this.lengths.reduce((a,b) => a+b, 0) / Math.max(this.rows.length, 1)
  }
  search(raw: string, options: RetrievalOptions = {}): {query: string; resolvedQuery: string; anchors: string[]; hits: RankedRow[]} {
    const query = raw.trim().slice(0, 1000)
    // Only short anaphoric follow-ups inherit the most recent USER subject.
    const followup = query.length <= 48 && /^(那|这个|它|还|需要|要带|能|可以|周末|电话|地址|在哪|怎么办|多少钱|多久|我是|材料|流程|下一步|接下来|继续|再详细|再具体|具体呢|详细呢|这一步)/.test(query)
    const inherited = followup && options.previousQuery ? options.previousQuery.slice(0, 200) : ''
    const resolvedQuery = inherited ? `${inherited} ${query}` : query
    const subject = query.replace(/可以线上办吗|能不能|怎么弄|怎么办|线上|线下|办理|申请|请问|帮我|需要|材料|哪些|什么|在哪|哪里|电话|地址|周末|这个|那个|那|多久|多少钱|要带|吗|呢|行|能|办|去|带|的|\s|[\p{P}]/gu, '')
    if (!inherited && (!subject || /^(你好|您好|在吗|谢谢|谢谢你|好的|好|ok)$/i.test(normalize(query)))) return {query,resolvedQuery,anchors:[],hits:[]}
    const q = normalize(resolvedQuery)
    // Mentioning a timetable while asking about navigation/comparison is not a request
    // to enumerate courses. Explicit collection/managed scopes always take precedence.
    const timetableNavigation=/(?:日程.*(?:课表|课程安排)|(?:课表|课程安排).*日程|课表.*(?:区别|一回事)|(?:课表|课程安排).{0,8}(?:入口|怎么查|如何查|哪里看|哪里查|从哪查))/.test(resolvedQuery)
    const wantsCollective=collectiveIntent(resolvedQuery)&&!timetableNavigation
    const restrictToCourses=wantsCollective&&!options.managedOnly&&(!options.collection||options.collection===COURSE_COLLECTION)
      &&this.rows.some(r=>{const m=metadata(r);return m.collection===COURSE_COLLECTION&&(!m.agentId||m.agentId===options.agentId)})
    const eligible = (i:number) => {
      const m = metadata(this.rows[i])
      return (!m.agentId || m.agentId === options.agentId) && (!options.collection || m.collection === options.collection)
        && (!restrictToCourses||m.collection===COURSE_COLLECTION)
        && (m.collection!==COURSE_COLLECTION||matchesCourseConstraints(this.rows[i].extra?.courseCatalog,resolvedQuery))
        && (!options.topic || (m.sectionPath || []).some((s:string)=>normalize(s)===normalize(options.topic)))
        && (!options.managedOnly || String(m.collection).startsWith('base:'))
    }
    const anchors = [...this.phrases.keys()].filter(key => q.includes(key) && [...this.phrases.get(key)!].some(eligible)).sort((a,b) => b.length-a.length)
      .filter((key, i, all) => !all.slice(0,i).some(long => long.includes(key)))
    const qterms = terms(resolvedQuery).slice(0, 80)
    const scores = new Map<number, number>(), reasons = new Map<number, string[]>()
    const record = (i: number, score: number, reason?: string) => {
      if (!eligible(i)) return
      scores.set(i, (scores.get(i) || 0) + score)
      if (reason) reasons.set(i, [...(reasons.get(i) || []), reason])
    }
    for (const t of qterms) {
      const posting = this.postings.get(t)
      if (!posting) continue
      const idf = Math.log(1 + (this.rows.length - posting.size + 0.5) / (posting.size + 0.5))
      for (const [i, tf] of posting) record(i, idf * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * this.lengths[i] / this.average)) / Math.sqrt(Math.max(qterms.length, 1)))
    }
    // Timetable facets are structured predicates, not rare lexical matches.
    // Common weekday words must not fall below the generic document threshold.
    if(wantsCollective)for(let i=0;i<this.rows.length;i++)if(metadata(this.rows[i]).collection===COURSE_COLLECTION)record(i,8,'教务课程条件匹配')
    const anchored = new Set<number>()
    for (const phrase of anchors) for (const i of this.phrases.get(phrase)!) {
      if (!eligible(i)) continue
      anchored.add(i); record(i, 24 + Math.min(phrase.length, 12), `名称/别名:${phrase}`)
      const m = metadata(this.rows[i])
      for (const rel of m.relations || []) for (const j of this.related.get(rel) || []) {
        // Route FAQ/alias mentions back to the owning matter before expanding context.
        if (eligible(j) && this.rows[j].type === '事项') { anchored.add(j); record(j, 12, `关联:${rel}`) }
      }
    }
    const wantsTakeout = /外卖|食堂|吃什么|好吃|红榜|黑榜|避雷/.test(query)
    const wantsCourses = /课程|选课|老师|给分|工作量|测评/.test(query)
    const wantsFreshman = /新生|入学|报到|注册/.test(query)
    const wantsOverview = /几个|多少|哪些|概况|概览|介绍|一览|名单|有哪些/.test(query)
    let ranked = [...scores.entries()].filter(([i]) => {
      const m = metadata(this.rows[i])
      return eligible(i)
    }).map(([i, score]) => {
      const row = this.rows[i], m = metadata(row)
      const titleTerms = terms(row.title), coverage = qterms.filter(t => titleTerms.includes(t)).length / Math.max(qterms.length, 1)
      score += coverage * 8
      if (row.type === '事项') score += anchored.has(i) ? 12 : 1
      if (row.type === '事项' && m.collection === 'matters') score += 6
      if ((wantsTakeout && m.collection === 'takeout') || (wantsCourses && m.collection === 'courses') || (wantsFreshman && m.collection === 'freshman')) score += 6
      if (m.trust === 'official_index' || m.trust === 'handbook') score *= 1.05
      if (m.trust === 'reviewed') score *= 1.08
      if (wantsOverview && m.overview && terms((m.sectionPath || []).slice(-1).join('')).some(t=>!['学校','校内','校园','概况','概览','具体','里面','介绍'].includes(t) && q.includes(t))) {
        score += 30; (reasons.get(i) || reasons.set(i,[]).get(i)!).push('章节概览与完整子目录')
      }
      if (row.detailStatus === 'unavailable' || row.access === '已合并下线' || /已失效|过期/.test(m.validity || '')) score *= 0.3
      return {i, score, reasons: reasons.get(i) || ['BM25字段检索']}
    }).filter(r => r.score >= 3 && (anchors.length === 0 || anchored.has(r.i) || r.score >= 12))
      .sort((a,b) => b.score-a.score || this.rows[a.i].externalId-this.rows[b.i].externalId)
    // A query containing only generic procedure words is not a subject match.
    if (!qterms.length && !anchors.length) ranked = []
    const seen = new Set<string>(), hits: RankedRow[] = []
    for (const r of ranked) {
      const row = this.rows[r.i], meta = metadata(row)
      const key = `title:${normalize(row.title)}`
      if (seen.has(key)) continue
      seen.add(key)
      const neighborIds = new Set<number>()
      for (const rel of [`parent:${meta.parent}`, `title:${normalize(row.title)}`, ...(meta.children || []).map((key:string)=>`section:${key}`), ...(meta.relations || [])]) for (const j of this.related.get(rel) || []) if (j !== r.i) neighborIds.add(j)
      const neighbors = [...neighborIds].map(i => ({row:this.rows[i], score:scores.get(i) || 0}))
        .filter(n => (!metadata(n.row).agentId || metadata(n.row).agentId === options.agentId) && (!options.collection || metadata(n.row).collection === options.collection)
          && (!options.topic || (metadata(n.row).sectionPath || []).some((s:string)=>normalize(s)===normalize(options.topic)))
          && (!options.managedOnly || String(metadata(n.row).collection).startsWith('base:')))
        .sort((a,b) => {
          const facet = (n: KnowledgeRow) => /材料|表格|文档/.test(query) && n.type === '表单' ? 10 : /电话|地址|部门/.test(query) && n.type === '机构' ? 10 : n.type === '事项' ? 8 : n.type === '问答' ? 5 : 0
          return facet(b.row)-facet(a.row) || b.score-a.score || a.row.externalId-b.row.externalId
        }).slice(0, 4).map(n => n.row)
      hits.push({row, score:Math.round(r.score*100)/100, reasons:r.reasons, related:neighbors})
      if (hits.length >= Math.min(Math.max(options.limit || 5, 1), 20)) break
    }
    return {query, resolvedQuery, anchors, hits}
  }
}
