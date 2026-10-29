import {get} from 'node:https'
import {lookup} from 'node:dns/promises'
import {load} from 'cheerio'
import {type CollectorConfig,plain,dateOnly,lectureUrl,normalizeLecture} from './lecture-data'
import {isVerificationPage} from '../knowledge/wechat-content'

export class LectureContentBlocked extends Error {}

export function publicAddress(address:string){
 if(address.includes(':'))return /^[23][0-9a-f]{0,3}:/i.test(address)&&!address.toLowerCase().startsWith('2001:db8:')
 const n=address.split('.').map(Number);if(n.length!==4||n.some(x=>!Number.isInteger(x)||x<0||x>255))return false
 return ![0,10,127].includes(n[0])&&n[0]<224&&!(n[0]===169&&n[1]===254)&&!(n[0]===172&&n[1]>=16&&n[1]<=31)&&!(n[0]===192&&(n[1]===168||n[1]===0))&&!(n[0]===100&&n[1]>=64&&n[1]<=127)&&!(n[0]===198&&[18,19].includes(n[1]))
}
/** Every redirect is revalidated; connect to the checked address, not a second DNS result. */
export async function readLecturePage(input:string,signal:AbortSignal,redirects=0,campusNetwork=false):Promise<string>{
 const safe=lectureUrl(input);if(!safe||signal.aborted)throw new Error('来源地址不允许或任务已超时')
 const url=new URL(safe),addresses=await lookup(url.hostname,{all:true})
 const campusHost=url.hostname==='ucass.edu.cn'||url.hostname.endsWith('.ucass.edu.cn')
 if(!addresses.length||addresses.some(a=>!publicAddress(a.address)&&!(campusNetwork&&campusHost&&/^10\.27\.\d{1,3}\.\d{1,3}$/.test(a.address))))throw new Error('解析到内网地址；校内来源可启用校园网直连后重试')
 const address=addresses.find(a=>a.family===4)||addresses[0]
 return new Promise((resolve,reject)=>{
  const request=get(url,{signal,timeout:10000,family:address.family,lookup:((_host:any,_options:any,callback:any)=>callback(null,address.address,address.family)) as any,
   headers:{'User-Agent':'CAgent-LectureCollector/1.0','Accept':'text/html','Accept-Language':'zh-CN,zh;q=0.9'}},response=>{
   const status=response.statusCode||0
   if(status>=300&&status<400){response.resume();if(redirects>=3||!response.headers.location)return reject(new Error('重定向次数过多'));readLecturePage(new URL(response.headers.location,url).href,signal,redirects+1,campusNetwork).then(resolve,reject);return}
   if(status!==200){response.resume();reject(new Error('来源返回 HTTP '+status));return}
   if(Number(response.headers['content-length'])>2_000_000){response.destroy();reject(new Error('页面超过采集大小上限'));return}
   const parts:Buffer[]=[];let size=0
   response.on('data',(part:Buffer)=>{size+=part.length;if(size>2_000_000){response.destroy();reject(new Error('页面超过采集大小上限'))}else parts.push(part)})
   response.on('error',()=>reject(new Error('页面读取失败')))
   response.on('end',()=>{
    const bytes=Buffer.concat(parts),hint=String(response.headers['content-type']||'')+' '+bytes.subarray(0,2000).toString('ascii'),encoding=/charset\s*=\s*["']?(gbk|gb2312|gb18030)/i.test(hint)?'gb18030':'utf-8'
    try{resolve(new TextDecoder(encoding).decode(bytes))}catch{reject(new Error('页面字符编码不支持'))}
   })
  })
  request.on('timeout',()=>request.destroy(new Error('来源请求超时')));request.on('error',()=>reject(new Error('来源连接失败或超时')))
 })
}
const lectureWords=/讲座|沙龙|论坛|研讨|报告会|工作坊|学术活动|学术交流|圆桌|名家讲坛/
export function parseLectureListing(html:string,url:string,mode:string){
 if(isVerificationPage(html))throw new LectureContentBlocked('栏目要求访问验证，未读取真实列表')
 const $=load(html),items=new Map<string,{url:string;title:string;published:string}>(),pages=new Set<string>()
 $('a[href]').each((_,el)=>{
  const a=$(el),href=a.attr('href')||'';let target:URL;try{target=new URL(href,url)}catch{return}
  if(!lectureUrl(target.href))return
  const title=plain(a.attr('title')||a.text(),500)
  if(/\/info\/\d+\/\d+\.htm$/.test(target.pathname)||target.hostname==='mp.weixin.qq.com'&&target.pathname.startsWith('/s')){
   if(title.length<4||mode!=='all'&&!lectureWords.test(title))return
   const date=a.parent().text().match(/20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}/)?.[0]||''
   const published=date?dateOnly(date.split(/[-/.]/).map((x,i)=>i?x.padStart(2,'0'):x).join('-')):''
   target.hash='';items.set(target.href,{url:target.href,title,published})
  }else if(target.origin===new URL(url).origin&&/\/\d+\.htm$/.test(target.pathname)&&/首页|上页|下一页|下页|尾页|\d+/.test(a.text()))pages.add(target.href)
 })
 return {items:[...items.values()],pages:[...pages]}
}
export function parseLectureDetail(html:string,item:{url:string;title:string;published:string},source:{id:string;name:string}){
 if(isVerificationPage(html))throw new LectureContentBlocked('正文要求访问验证，未导入验证页')
 const $=load(html),meta=plain($('meta[name="ArticleTitle"]').attr('content')||$('#activity-name').text(),500)
 const documentTitle=plain($('title').text(),600).replace(/[-–—_][^-–—_]{0,60}(?:学院|大学|科研处)\s*$/,'').trim()
 const heading=meta||documentTitle||plain($('h1').first().text(),500)||plain(item.title,500)
 const title=heading&&!/^(?:上一篇|下一篇)(?:[：:\s]|$)|^(?:网站首页|首页|内容简介|主讲人介绍|报告人简介)$/.test(heading)?heading:plain(item.title,500)
 const root=$('.v_news_content,#vsb_content,#js_content,article').first(),content=root.length?root:$('body')
 if(new URL(item.url).hostname==='mp.weixin.qq.com'&&!$('#js_content,.rich_media_content').length)throw new LectureContentBlocked('公众号正文不可读，不能用目录或验证页代替')
 content.find('script,style,iframe,nav,footer,header,form,input,[hidden]').remove();content.find('br').replaceWith('\n');content.find('p,div,li').append('\n')
 const body=plain(content.text(),12000),published=item.published||dateOnly(($('meta[name="PubDate"]').attr('content')||'').slice(0,10))
 const timeLine=body.match(/(?:^|[\n\r\s，；。、])(?:活动时间|讲座时间|报告时间|举办时间|时间|日期|定于)[：:\s]*([^\n]{0,100})/)?.[1]||''
 const date=timeLine.match(/(20\d{2})[年/.-]\s*(\d{1,2})[月/.-]\s*(\d{1,2})日?/)
 let eventDate=date?dateOnly(`${date[1]}-${date[2].padStart(2,'0')}-${date[3].padStart(2,'0')}`):'',confidence='explicit'
 if(!eventDate){
  // A dated event sentence is valid evidence; timestamps, navigation and biographies are not.
  const eventSentence=body.slice(0,2000).match(/(?:^|[。\n；])[^。\n]{0,30}?(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日?[^。\n]{0,100}?(?:举办|举行|召开|开讲)/)
  if(eventSentence)eventDate=dateOnly(`${eventSentence[1]}-${eventSentence[2].padStart(2,'0')}-${eventSentence[3].padStart(2,'0')}`)
 }
 if(!eventDate){const short=timeLine.match(/(\d{1,2})月\s*(\d{1,2})日/);if(short&&published){eventDate=dateOnly(`${published.slice(0,4)}-${short[1].padStart(2,'0')}-${short[2].padStart(2,'0')}`);confidence='inferred'}}
 const time=timeLine.match(/(?:上午|下午|晚上|晚间)?\s*\d{1,2}[:：]\d{2}(?:\s*[-—~至]\s*\d{1,2}[:：]\d{2})?/)?.[0]?.trim()||''
 const location=body.match(/(?:活动地点|讲座地点|地点)[：:\s]*([^\n]{2,120})/)?.[1]?.trim()||''
 const speaker=body.match(/(?:主讲人|主讲嘉宾|报告人|主讲)[：:\s]*([^\n]{2,100})/)?.[1]?.trim()||''
 const campus=/望京/.test(location)?'望京校区':/良乡/.test(location)?'良乡校区':/线上|腾讯会议|Zoom|在线/i.test(location)?'线上':'未注明'
 return normalizeLecture({...item,title,source_id:source.id,source_name:source.name,org:source.name,published,event_date:eventDate,time_text:time,location,campus,speaker,
  excerpt:body,content_kind:/回顾|纪要|圆满|成功举办/.test(title)?'review':/预告|通知|邀请|报名/.test(title)?'preview':'info',date_confidence:confidence,type:/沙龙/.test(title)?'学术沙龙':/论坛/.test(title)?'论坛':/研讨/.test(title)?'研讨会':'讲座'})
}
export async function crawlLectures(config:CollectorConfig,test=false,onProgress?:(progress:any)=>void,startOffset=0){
 const signal=AbortSignal.timeout(test?25000:150000),records:any[]=[],warnings:string[]=[],seen=new Set<string>();let scanned=0,requests=0,blocked=0
 const limit=test?3:config.maxArticles,enabled=config.sources.filter(s=>s.enabled).slice(0,test?1:50),offset=enabled.length?startOffset%enabled.length:0,sources=[...enabled.slice(offset),...enabled.slice(0,offset)]
 const perSource=Math.max(1,Math.ceil(limit/Math.max(1,sources.length)));let attempted=0
 for(const source of sources){
  if(signal.aborted||records.length>=limit||requests>=100)break
  attempted++
  try{
   requests++;const first=await readLecturePage(source.url,signal,0,config.campusNetwork),listing=parseLectureListing(first,source.url,source.mode)
   let entries=listing.items
   for(const page of listing.pages.slice(0,test?0:config.maxPages-1)){
    if(signal.aborted||requests>=100)break
    try{requests++;entries.push(...parseLectureListing(await readLecturePage(page,signal,0,config.campusNetwork),page,source.mode).items)}catch{warnings.push(source.name+'：部分分页未能读取')}
   }
   let sourceCollected=0,sourceScanned=0
   for(const entry of entries){
    if(records.length>=limit||signal.aborted||requests>=100)break
    if(!test&&(sourceCollected>=perSource||sourceScanned>=perSource*3))break
    if(seen.has(entry.url))continue;seen.add(entry.url);scanned++
    sourceScanned++
    try{requests++;records.push(parseLectureDetail(await readLecturePage(entry.url,signal,0,config.campusNetwork),entry,source));sourceCollected++}catch(e){if(e instanceof LectureContentBlocked){blocked++;warnings.push(source.name+'：正文需要验证或缺失，未导入；保留已有资料')}else warnings.push(source.name+'：一篇详情读取失败，保留已有资料')}
    onProgress?.({scanned,collected:records.length,source:source.name});await new Promise(r=>setTimeout(r,250))
   }
   if(!listing.items.length)warnings.push(source.name+'：未找到匹配文章，请核对栏目或筛选模式')
  }catch(e){const campus=/解析到内网地址/.test((e as Error).message);if(e instanceof LectureContentBlocked){blocked++;warnings.push(source.name+'：栏目要求访问验证，未读取真实文章列表')}else warnings.push(source.name+'：'+(campus?'域名解析为校园网地址，请按需开启校园网直连。':'栏目连接失败或无法解析'))}
 }
 if(signal.aborted)warnings.push('已达到本次采集时间上限；部分结果可保留，历史资料未删除')
 return {records,warnings:[...new Set(warnings)].slice(0,50),scanned,requests,blocked,limited:records.length>=limit||requests>=100||signal.aborted,nextSource:enabled.length?(offset+attempted)%enabled.length:0}
}
