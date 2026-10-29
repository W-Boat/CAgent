import {createHash} from 'node:crypto'
import {load} from 'cheerio'
import {z} from 'zod'
import {DEFAULT_LECTURE_SOURCES} from './lecture-sources'

export const LECTURE_FILE='讲座聚合/lectures.json', LECTURE_COLLECTION='lectures'
export function lectureUrl(value:string){
 try{const u=new URL(value);if(u.protocol!=='https:'||u.port||u.username||u.password||!(u.hostname==='ucass.edu.cn'||u.hostname.endsWith('.ucass.edu.cn')||u.hostname==='mp.weixin.qq.com'))return null
  u.hash='';return u.href
 }catch{return null}
}
const endpoint=z.string().max(1000).refine(value=>!!lectureUrl(value),'仅支持学校公开网站及微信公众号 HTTPS 地址')
export const collectorSchema=z.object({
 enabled:z.boolean().default(false),intervalMinutes:z.number().int().min(60).max(10080).default(720),
 campusNetwork:z.boolean().default(false),
 maxPages:z.number().int().min(1).max(5).default(1),maxArticles:z.number().int().min(1).max(100).default(30),
 sources:z.array(z.object({id:z.string().regex(/^[\w-]{1,60}$/),name:z.string().min(1).max(150),url:endpoint,mode:z.enum(['all','filter']).default('filter'),enabled:z.boolean().default(true)})).min(1).max(50)
}).strict().refine(c=>new Set(c.sources.map(s=>s.id)).size===c.sources.length,'信息源标识不可重复')
export type CollectorConfig=z.infer<typeof collectorSchema>
export const defaultCollectorConfig=()=>collectorSchema.parse({sources:DEFAULT_LECTURE_SOURCES})
export function plain(value:unknown,max=1000):string{
 if(typeof value!=='string'&&typeof value!=='number')return ''
 const $=load(String(value));$('script,style,iframe,form,input').remove()
 return $.root().text().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/[ \t]+/g,' ').trim().slice(0,max)
}
export function dateOnly(value:unknown){
 const text=typeof value==='string'?value:''
 if(!/^20\d{2}-\d{2}-\d{2}$/.test(text))return ''
 const d=new Date(text+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===text?text:''
}
export type Lecture = {
 id:string;title:string;url:string;source_id:string;source_name:string;org:string;published:string;event_date:string;time_text:string;
 location:string;campus:string;speaker:string;organizer:string;type:string;summary:string;excerpt:string;content_kind:string;date_confidence:string
}
export function normalizeLecture(raw:any):Lecture {
 if(!raw||typeof raw!=='object')throw new Error('讲座条目必须为对象')
 const url=lectureUrl(raw.url),title=plain(raw.title,500)
 if(!url||!title)throw new Error('讲座标题或公开来源链接无效')
 const hash=createHash('sha256').update(url).digest('hex')
 return {id:'lecture-'+hash.slice(0,32),url,title,source_id:plain(raw.source_id,60),source_name:plain(raw.source_name,150),org:plain(raw.org,150),published:dateOnly(raw.published),
  event_date:dateOnly(raw.event_date),time_text:plain(raw.time_text,100),location:plain(raw.location,500),campus:plain(raw.campus,40)||'未注明',speaker:plain(raw.speaker,300),
  organizer:plain(raw.organizer,300),type:plain(raw.type,50)||'讲座',summary:plain(raw.summary,1500),excerpt:plain(raw.excerpt,12000),
  content_kind:['preview','review','info'].includes(raw.content_kind)?raw.content_kind:'info',date_confidence:raw.date_confidence==='explicit'?'explicit':raw.date_confidence==='inferred'?'inferred':'source_extracted'}
}
export function lectureRow(lecture:Lecture,capturedAt:string){
 const l=lecture,hash=createHash('sha256').update(l.url).digest('hex')
 const detail=[l.title,`类型：${l.type}；${l.content_kind==='review'?'活动回顾，不是报名预告':l.content_kind==='preview'?'活动预告':'活动资料'}`,
  `活动日期：${l.event_date||'未明确，不能用发布日期代替'}；时间：${l.time_text||'未注明'}`,`校区：${l.campus}；地点：${l.location||'未注明'}`,
  `主讲人：${l.speaker||'未注明'}；组织单位：${l.organizer||l.org||l.source_name||'未注明'}`,`发布日期：${l.published||'未注明'}；资料采集：${capturedAt}`,
  l.summary,l.excerpt,'资料由公开页面提取，日期与活动状态请以原通知为准；历史记录不代表仍可报名。'].filter(Boolean).join('\n')
 return {id:l.id,externalId:1_200_000_000+parseInt(hash.slice(0,8),16)%100_000_000,title:l.title,url:l.url,cat:'校园讲座',type:l.type,source:l.source_name||l.org||'公开讲座通知',
  name:l.title,dept:l.organizer||l.org,place:l.location,campus:l.campus,officeTime:[l.event_date,l.time_text].filter(Boolean).join(' '),access:'公网',detailStatus:'full',
  detail,summaryShort:detail.slice(0,1600),searchText:detail.toLowerCase(),verifiedAt:capturedAt,note:'公开资料自动抽取，时间地点以原通知为准。',
  extra:{kb:{schema:'kb/v2',collection:LECTURE_COLLECTION,parent:l.id,file:LECTURE_FILE,locator:l.url,trust:'public_web',entryKind:'source',sectionPath:[l.source_name,l.type].filter(Boolean),aliases:[l.title,l.speaker,l.campus,'校园讲座','学术活动'].filter(Boolean),relations:[]},lecture:l}}
}
export function shanghaiToday(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}
export function filterLectures(rows:Lecture[],query:Record<string,string>,today=shanghaiToday()){
 const term=String(query.q||'').normalize('NFKC').toLowerCase().slice(0,100),month=/^20\d{2}-(0[1-9]|1[0-2])$/.test(query.month||'')?query.month:'',day=dateOnly(query.date)
 return rows.filter(l=>(!term||[l.title,l.speaker,l.organizer,l.location,l.excerpt,l.source_name].join(' ').normalize('NFKC').toLowerCase().includes(term))&&(!query.campus||l.campus===query.campus)&&(!query.source||l.source_id===query.source)&&(!query.type||l.type===query.type)
  &&(!query.kind||l.content_kind===query.kind)&&(!month||l.event_date.startsWith(month))&&(!day||l.event_date===day)
  &&(query.scope!=='upcoming'||!!l.event_date&&l.event_date>=today&&l.content_kind==='preview')&&(query.scope!=='undated'||!l.event_date))
  .sort((a,b)=>(b.event_date||b.published||'').localeCompare(a.event_date||a.published||'')||a.id.localeCompare(b.id))
}
