import {BadRequestException} from '@nestjs/common'
import {createHash} from 'node:crypto'
import {load} from 'cheerio'
import {z} from 'zod'
import {isVerificationPage} from './wechat-content'

const endpoint=z.string().max(1000).refine(value=>{
  try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&!u.hash&&![...u.searchParams.keys()].some(k=>/token|password|secret|^ak$|^key$/i.test(k))}catch{return false}
},'只接受无内嵌凭据的 http(s) 地址，访问令牌请填写专用栏')
const common={maxArticles:z.number().int().min(1).max(100).default(30),autoSync:z.boolean().default(false)}
export const wechatConnectionSchema=z.discriminatedUnion('mode',[
  z.object({mode:z.literal('API'),managed:z.boolean().default(false),baseUrl:endpoint,apiPath:z.string().regex(/^\/[a-zA-Z0-9_/-]+$/).refine(s=>!s.includes('//')).default('/api/v1/wx'),
    accountIds:z.array(z.string().min(1).max(150)).max(10).default([]),accountNames:z.record(z.string().max(120)).default({}),...common}),
  z.object({mode:z.literal('RSS'),feedUrl:endpoint,accountName:z.string().max(120).default(''),...common})
])
export type WechatConnection=z.infer<typeof wechatConnectionSchema>
export interface WechatArticle {id:string;title:string;body:string;url:string;account:string;published:string}
export interface WechatResult {articles:WechatArticle[];warnings:string[];scanned:number;skipped:number;limited:boolean}
const MAX_BYTES=2*1024*1024

/** No redirect carries the configured collector credential to a different endpoint. */
async function read(url:string,secret:string,signal:AbortSignal):Promise<string>{
  let response:Response
  try{response=await fetch(url,{headers:{Accept:'application/json, application/rss+xml, application/atom+xml, text/xml;q=0.9',...(secret?{Authorization:'Bearer '+secret}:{})},redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(12000)])})}
  catch{throw new BadRequestException('公众号信息源连接失败或超时，请检查服务器地址与网络')}
  if(response.status===401||response.status===403)throw new BadRequestException('采集器访问令牌无效或已过期，请更新令牌')
  if(!response.ok){await response.body?.cancel();throw new BadRequestException('公众号信息源返回异常，请检查采集器运行状态')}
  if(Number(response.headers.get('content-length'))>MAX_BYTES){await response.body?.cancel();throw new BadRequestException('信息源响应过大，请减小同步范围')}
  const reader=response.body?.getReader();if(!reader)throw new BadRequestException('信息源返回空内容')
  const parts:Uint8Array[]=[];let size=0
  try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>MAX_BYTES)throw new BadRequestException('信息源响应过大，请减小同步范围');parts.push(chunk.value)}}finally{await reader.cancel().catch(()=>{})}
  return Buffer.concat(parts.map(p=>Buffer.from(p))).toString('utf8')
}
function apiUrl(config:Extract<WechatConnection,{mode:'API'}>,path:string){
  const root=new URL(config.baseUrl)
  return new URL(config.apiPath.replace(/\/$/,'')+path,root.origin).toString()
}
async function json(url:string,secret:string,signal:AbortSignal){
  let result:any
  try{result=JSON.parse(await read(url,secret,signal))}catch(e){if(e instanceof BadRequestException)throw e;throw new BadRequestException('采集器未返回有效 JSON，请检查 API 路径')}
  if(result?.code!==0)throw new BadRequestException('采集器接口返回失败，请检查访问令牌与公众号授权')
  return result.data
}
export function articleUrl(value:string):{url:string;identity:string}|null{
  try{const u=new URL(value);if(u.protocol!=='https:'||u.hostname!=='mp.weixin.qq.com'||u.port||u.username||u.password||!/^\/s(?:\/[-\w]+)?\/?$/.test(u.pathname))return null
    const clean=new URL('https://mp.weixin.qq.com'+u.pathname)
    for(const key of ['__biz','mid','idx','sn']){const v=u.searchParams.get(key);if(v)clean.searchParams.set(key,v)}
    if(clean.pathname.replace(/\/$/,'')==='/s'&&!['__biz','mid'].every(k=>clean.searchParams.has(k)))return null
    const identity=new URL(clean);if(identity.searchParams.has('__biz')&&identity.searchParams.has('mid'))identity.searchParams.delete('sn')
    if(clean.toString().length>600)return null
    return {url:clean.toString(),identity:identity.toString()}
  }catch{return null}
}
/** Extract text, never store executable HTML, tracking pixels or hidden form data. */
export function articleText(raw:string):string{
  if(!raw.trim()||['DELETED','FAILED','NULL'].includes(raw.trim().toUpperCase()))return ''
  const $=load(raw),root=$('#js_content').length?$('#js_content'):$('body')
  root.find('script,style,iframe,form,input,button,nav,footer,[hidden],[aria-hidden="true"]').remove()
  root.find('[style]').each((_,el)=>{if(/display\s*:\s*none|visibility\s*:\s*hidden/i.test($(el).attr('style')||''))$(el).remove()})
  root.find('br').replaceWith('\n');root.find('td,th').append('\t')
  root.find('p,div,section,article,li,h1,h2,h3,h4,h5,h6,tr,blockquote,pre').append('\n')
  return root.text().replace(/\r/g,'').replace(/[ \t]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim()
}
function date(value:unknown):string{
  const n=typeof value==='number'?value:typeof value==='string'&&/^\d{10,13}$/.test(value)?Number(value):null
  const d=n===null?new Date(String(value||'')):new Date(n>1e11?n:n*1000)
  return Number.isFinite(d.getTime())?d.toISOString().slice(0,10):''
}
function normalizeArticle(input:any,account:string):WechatArticle|null{
  const url=articleUrl(String(input.url||input.link||'')),title=articleText(String(input.title||'')).slice(0,500)
  const raw=String(input.content||input.content_html||'')
  if(isVerificationPage(raw))return null
  const body=articleText(raw)
  if(!url||!title||body.length<20)return null
  return {id:createHash('sha256').update(url.identity).digest('hex'),title,body,url:url.url,account:account.slice(0,120),published:date(input.publish_time||input.pubDate||input.published||input.updated)}
}
export async function wechatAccounts(config:WechatConnection,secret:string,keyword='',outerSignal?:AbortSignal){
  if(config.mode!=='API')throw new BadRequestException('RSS 模式无需选择采集器公众号')
  const signal=AbortSignal.any([AbortSignal.timeout(20000),...(outerSignal?[outerSignal]:[])]),url=new URL(apiUrl(config,'/mps'));url.search=new URLSearchParams({offset:'0',limit:'100',kw:keyword.slice(0,100),status:'1'}).toString()
  const data=await json(url.toString(),secret,signal)
  if(!Array.isArray(data?.list))throw new BadRequestException('采集器公众号列表格式不兼容')
  return {items:data.list.map((p:any)=>({id:String(p.id||p.mp_id||''),name:String(p.mp_name||p.name||'').slice(0,120),description:String(p.mp_intro||'').slice(0,300)})).filter((p:any)=>p.id&&p.name),total:Number(data.total)||data.list.length}
}
export function parseWechatFeed(xml:string,maxArticles:number,accountName=''):WechatResult{
  if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw new BadRequestException('不支持包含 DTD/实体声明的订阅源')
  const $=load(xml,{xmlMode:true}),rss=$('rss > channel'),atom=$('feed')
  if(!rss.length&&!atom.length)throw new BadRequestException('信息源不是有效的 RSS 或 Atom，请检查订阅地址')
  const items=rss.length?rss.children('item'):atom.children('entry'),articles:WechatArticle[]=[];let skipped=0
  const feedName=accountName||(rss.length?rss:atom).children('title').first().text()
  for(const el of items.toArray().slice(0,maxArticles)){
    const node=$(el),child=(names:string[])=>node.children().filter((_,e)=>names.includes(e.name)).first()
    const content=child(['content:encoded','content']),link=node.children('link').filter((_,e)=>!$(e).attr('rel')||$(e).attr('rel')==='alternate').first()
    const article=normalizeArticle({title:node.children('title').first().text(),content:content.attr('type')==='xhtml'?content.html()||'':content.text()||content.html()||'',url:link.attr('href')||link.text(),published:child(['pubDate','published','updated']).text()},feedName||'公众号')
    if(article)articles.push(article);else skipped++
  }
  return {articles,scanned:Math.min(items.length,maxArticles),skipped,limited:items.length>maxArticles,warnings:skipped?['部分文章缺少有效公众号原文或可用正文，未导入']:[]}
}
export async function readWechatSource(config:WechatConnection,secret:string,outerSignal?:AbortSignal):Promise<WechatResult>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000)
  if(outerSignal){if(outerSignal.aborted)controller.abort();else outerSignal.addEventListener('abort',abort,{once:true})}
  function abort(){controller.abort()}
  try{
    if(config.mode==='RSS')return parseWechatFeed(await read(config.feedUrl,secret,controller.signal),config.maxArticles,config.accountName)
    if(!config.accountIds.length||config.accountIds.length>config.maxArticles)throw new BadRequestException('请选择公众号，同步数量不能小于公众号数量')
    const articles:WechatArticle[]=[],warnings:string[]=[],ids=new Set<string>();let scanned=0,skipped=0,limited=false
    // Equal per-account window prevents the first account from starving later sources.
    const quota=Math.max(1,Math.floor(config.maxArticles/config.accountIds.length)),listed:any[]=[]
    for(const accountId of [...new Set(config.accountIds)]){
      const url=new URL(apiUrl(config,'/articles'));url.search=new URLSearchParams({mp_id:accountId,offset:'0',limit:String(quota)}).toString()
      const data=await json(url.toString(),secret,controller.signal)
      if(!Array.isArray(data?.list))throw new BadRequestException('采集器文章列表格式不兼容')
      if(Number(data.total)>quota)limited=true
      for(const item of data.list.slice(0,quota)){
        if(String(item.mp_id)!==accountId)throw new BadRequestException('采集器返回了非选定公众号的文章，同步已停止')
        if(!item.id)throw new BadRequestException('采集器文章缺少稳定 ID')
        listed.push({...item,accountId})
      }
    }
    let cursor=0
    const workers=Array.from({length:Math.min(3,listed.length)},async()=>{
      while(cursor<listed.length){const item=listed[cursor++];scanned++
        const detail=await json(apiUrl(config,'/articles/'+encodeURIComponent(String(item.id))+'?content=true'),secret,controller.signal)
        if(detail?.mp_id&&String(detail.mp_id)!==item.accountId)throw new BadRequestException('文章正文的公众号归属不一致，同步已停止')
        const article=normalizeArticle({...item,...detail},String(item.mp_name||config.accountNames[item.accountId]||'公众号'))
        if(!article){skipped++;continue}if(ids.has(article.id))continue;ids.add(article.id);articles.push(article)
      }
    })
    const results=await Promise.allSettled(workers.map(p=>p.catch(e=>{controller.abort();throw e})))
    const failed=results.find(r=>r.status==='rejected');if(failed?.status==='rejected')throw failed.reason
    if(skipped)warnings.push('部分文章仅有摘要、采集未完成或原文无效，未导入；请在采集器补全正文后重试')
    return {articles:articles.sort((a,b)=>a.id.localeCompare(b.id)),scanned,skipped,limited,warnings}
  }finally{clearTimeout(timer);outerSignal?.removeEventListener('abort',abort)}
}

/** Read-only probe: at most three recent articles per account, never imports. */
export async function testWechatSource(config:WechatConnection,secret:string){
  const started=Date.now(),signal=AbortSignal.timeout(40000),accounts: {id:string;name:string;status:string;scanned:number;skipped:number;message:string;sample?:{title:string;url:string;published:string;excerpt:string}}[]=[]
  let totalAccounts=0
  if(config.mode==='API'){
    const available=await wechatAccounts(config,secret,'',signal);totalAccounts=available.total
    let cursor=0;const selected=[...new Set(config.accountIds)]
    await Promise.all(Array.from({length:Math.min(3,selected.length)},async()=>{
      while(cursor<selected.length){const id=selected[cursor++],name=config.accountNames[id]||available.items.find(a=>a.id===id)?.name||id
        try{const result=await readWechatSource({...config,accountIds:[id],maxArticles:Math.min(3,config.maxArticles)},secret,signal),article=result.articles[0]
          accounts.push({id,name,status:article?'READY':result.skipped?'NO_BODY':'EMPTY',scanned:result.scanned,skipped:result.skipped,message:article?(result.skipped?'部分样例正文可读取，已跳过不可读文章':'原文链接和正文可读取'):result.skipped?'最近样例缺少有效链接或完整正文':'采集器尚无文章。请先采集最新文章，完成后再测试正文',...(article?{sample:{title:article.title,url:article.url,published:article.published,excerpt:article.body.slice(0,600)}}:{})})
        }catch(error){accounts.push({id,name,status:'FAILED',scanned:0,skipped:0,message:error instanceof BadRequestException?error.message:'正文测试失败，请检查采集器状态'})}
      }
    }))
    accounts.sort((a,b)=>selected.indexOf(a.id)-selected.indexOf(b.id))
  }else{
    const result=await readWechatSource({...config,maxArticles:Math.min(3,config.maxArticles)},secret,signal),article=result.articles[0]
    accounts.push({id:'rss',name:config.accountName||article?.account||'RSS / Atom',status:article?'READY':result.skipped?'NO_BODY':'EMPTY',scanned:result.scanned,skipped:result.skipped,message:article?'订阅正文和原文链接可读取':result.skipped?'订阅仅含摘要或缺少原文，不能导入':'订阅没有可读取的文章',...(article?{sample:{title:article.title,url:article.url,published:article.published,excerpt:article.body.slice(0,600)}}:{})})
  }
  return {connected:true,mode:config.mode,totalAccounts,testedAccounts:accounts.length,ready:accounts.filter(a=>a.status==='READY').length,elapsedMs:Date.now()-started,checkedAt:new Date().toISOString(),accounts,tip:accounts.length?'测试只读取最新样例，不保存、同步或发布知识条目':'连接与列表读取成功，请选择公众号后测试正文'}
}
export function wechatEntryParts(article:WechatArticle){
  const chunks:string[]=[];let rest=article.body
  while(rest.length){let end=Math.min(16000,rest.length);if(end<rest.length){const boundary=rest.lastIndexOf('\n',end);if(boundary>end/2)end=boundary+1}chunks.push(rest.slice(0,end).trim());rest=rest.slice(end)}
  const prefix='wechat:'+article.id+':'
  return chunks.map((body,i)=>({externalKey:prefix+i,articlePrefix:prefix,title:article.title.slice(0,480)+(chunks.length>1?`（${i+1}/${chunks.length}）`:''),
    question:`${article.title.slice(0,350)} · ${article.url}${chunks.length>1?' · 第'+(i+1)+'部分':''}`,
    answer:`公众号：${article.account}\n发布日期：${article.published||'来源未提供'}\n\n${body}`,url:article.url,source:`微信公众号 · ${article.account}${article.published?' · '+article.published:''}`,mode:'RAG' as const,aliases:[article.title.slice(0,300),article.account].filter(Boolean)}))
}
