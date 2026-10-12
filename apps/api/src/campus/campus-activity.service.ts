import {appOrigin} from '../common/app-origin'
import {BadRequestException,Injectable,Logger,UnauthorizedException} from '@nestjs/common'
import {Prisma} from '@prisma/client'
import {JwtService} from '@nestjs/jwt'
import {PrismaService} from '../prisma/prisma.service'
import type {KnowledgeSource} from './knowledge-evidence'

export const ACTIVITY_TYPES=['QUERY','CONTENT_VIEW','LINK_CLICK','MAP_VIEW','RENDER_ERROR','RENDER_RECOVERED'] as const
export const ACTIVITY_ORIGINS=['student-chat','admin-chat','trial-chat','campus-guide','campus-map','presentation-lab','api'] as const
export function activityDay(date=new Date()){return new Date(date.getTime()+8*3600000).toISOString().slice(0,10)}
export function activitySince(days:number){return new Date(activityDay(new Date(Date.now()-(days-1)*86400000))+'T00:00:00+08:00')}
export function activityUrl(value?:string){
 if(!value)return ''
 try{const u=new URL(value,appOrigin());if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return '';for(const key of [...u.searchParams.keys()])if(/token|password|secret|authorization/i.test(key))u.searchParams.delete(key);return u.href.slice(0,2000)}catch{return ''}
}
@Injectable()
export class CampusActivityService {
 private readonly logger=new Logger(CampusActivityService.name)
 private rates=new Map<string,{at:number;count:number}>()
 constructor(private readonly prisma:PrismaService,private readonly jwt:JwtService){}
 async write(data:{requestId?:string;userId?:string|null;eventType:string;origin:string;entryId?:string;collection?:string;title?:string;url?:string;query?:string;resultCount?:number;references?:unknown;success?:boolean}){
  try{
   const record={...data,entryId:data.entryId||(data.eventType==='LINK_CLICK'?'url:'+activityUrl(data.url):undefined),url:activityUrl(data.url),title:(data.title||'').slice(0,240),query:(data.query||'').slice(0,240),collection:(data.collection||'').slice(0,160),references:(data.references||[]) as Prisma.InputJsonValue}
   return await this.prisma.campusActivity.create({data:record})
  }catch(e){if((e as any)?.code!=='P2002')this.logger.warn('校园使用记录写入失败');return null}
 }
 async chat(userId:string|null,origin:string,requestId:string,query:string,sources:KnowledgeSource[],success:boolean){
  const record={userId,origin,eventType:'QUERY',requestId:'chat:'+requestId,query:query.slice(0,240),resultCount:sources.length,success,
   references:sources.map(s=>({id:s.id,title:s.title,collection:s.collection,url:activityUrl(s.url),used:s.used,kind:s.kind})) as Prisma.InputJsonValue}
  try{return await this.prisma.campusActivity.upsert({where:{requestId:record.requestId},create:record,update:record})}catch{this.logger.warn('校园查询记录写入失败');return null}
 }
 async client(dto:any,bearer:string|undefined,ip:string){
  const now=Date.now(),rate=this.rates.get(ip)
  if(rate&&now-rate.at<60000){if(++rate.count>120)throw new BadRequestException('使用记录过于频繁')}else this.rates.set(ip,{at:now,count:1})
  if(this.rates.size>4096)for(const [key,value] of this.rates){if(now-value.at>60000)this.rates.delete(key)}
  if(this.rates.size>8192)this.rates.delete(this.rates.keys().next().value!)
  let userId:string|null=null
  if(bearer){
   try{const token=await this.jwt.verifyAsync(bearer.replace(/^Bearer\s+/i,''));if(token.type!=='access')throw new Error();const user=await this.prisma.user.findUnique({where:{id:token.sub},select:{id:true,status:true}});if(!user||user.status==='DISABLED')throw new Error();userId=user.id}catch{throw new UnauthorizedException('登录已过期')}
  }
  if(dto.eventType==='LINK_CLICK'&&!activityUrl(dto.url))throw new BadRequestException('链接无效')
  const {component,errorType,retryMode,attempt,messageId,...input}=dto
  if(dto.eventType==='RENDER_ERROR'||dto.eventType==='RENDER_RECOVERED'){
   if(!component||!errorType||!retryMode||!Number.isInteger(attempt))throw new BadRequestException('渲染诊断不完整')
   input.collection='presentation';input.title=component+' · '+errorType+' · '+retryMode+' #'+attempt;input.entryId=messageId||component;input.success=dto.eventType==='RENDER_RECOVERED';input.url=''
   input.references=[{component,errorType,retryMode,attempt,messageId:messageId||''}]
  }
  const event=await this.write({...input,userId,requestId:'client:'+(userId||'anonymous')+':'+dto.requestId})
  return {recorded:!!event}
 }
 async list(query:any){
  const where:Prisma.CampusActivityWhereInput={}
  if(query.eventType)where.eventType=query.eventType
  if(query.origin)where.origin=query.origin
  if(query.collection)where.collection=query.collection
  if(query.days)where.createdAt={gte:activitySince(Math.min(90,Math.max(1,Number(query.days)||14)))}
  if(query.keyword)where.OR=['title','query','url'].map(key=>({[key]:{contains:String(query.keyword).slice(0,160),mode:'insensitive'}}))
  return this.prisma.paginate(this.prisma.campusActivity,{where,orderBy:[{createdAt:'desc'},{id:'desc'}],include:{user:{select:{id:true,name:true,email:true}}}},Math.max(1,Number(query.page)||1),Math.min(100,Math.max(1,Number(query.pageSize)||20)))
 }
 async stats(days=14){
  days=Math.min(90,Math.max(1,Math.floor(days)||14));const since=activitySince(days),where={createdAt:{gte:since}}
  const [types,origins,users,daily,ranking,collections]=await Promise.all([
   this.prisma.campusActivity.groupBy({by:['eventType'],where,_count:{_all:true}}),
   this.prisma.campusActivity.groupBy({by:['origin','eventType'],where,_count:{_all:true}}),
   this.prisma.campusActivity.groupBy({by:['userId'],where:{...where,userId:{not:null}},_count:{_all:true}}),
   this.prisma.$queryRaw<{date:string;eventType:string;count:bigint}[]>`SELECT to_char(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') AS date,event_type AS "eventType",COUNT(*) AS count FROM campus_activities WHERE created_at>=${since} GROUP BY 1,2 ORDER BY 1`,
   this.prisma.campusActivity.groupBy({by:['entryId','title','collection','eventType'],where:{...where,eventType:{in:['CONTENT_VIEW','LINK_CLICK','MAP_VIEW']}},_count:{_all:true},orderBy:{_count:{id:'desc'}},take:100}),
   this.prisma.$queryRaw<{collection:string;matches:bigint;used:bigint}[]>`SELECT ref->>'collection' AS collection,COUNT(*) AS matches,COUNT(*) FILTER (WHERE ref->>'used'='true') AS used FROM campus_activities CROSS JOIN LATERAL jsonb_array_elements("references") ref WHERE created_at>=${since} AND event_type='QUERY' GROUP BY 1 ORDER BY 2 DESC`
  ])
  const counts=Object.fromEntries(types.map(r=>[r.eventType,r._count._all]))
  const top=new Map<string,any>()
  for(const r of ranking){const key=r.entryId||r.title;if(!key)continue;const item=top.get(key)||{id:key,title:r.title,collection:r.collection,views:0,clicks:0,maps:0};item[r.eventType==='LINK_CLICK'?'clicks':r.eventType==='MAP_VIEW'?'maps':'views']+=r._count._all;top.set(key,item)}
  return {since:since.toISOString(),days,startedAt:(await this.prisma.campusActivity.findFirst({orderBy:{createdAt:'asc'},select:{createdAt:true}}))?.createdAt||null,
   queries:counts.QUERY||0,contentViews:counts.CONTENT_VIEW||0,linkClicks:counts.LINK_CLICK||0,mapViews:counts.MAP_VIEW||0,users:users.length,renderErrors:counts.RENDER_ERROR||0,renderRecovered:counts.RENDER_RECOVERED||0,
   byOrigin:origins.map(r=>({origin:r.origin,eventType:r.eventType,count:r._count._all})),
   trend:Array.from({length:days},(_,i)=>{const date=activityDay(new Date(since.getTime()+i*86400000));const rows=daily.filter(r=>r.date===date);return {date,...Object.fromEntries(ACTIVITY_TYPES.map(type=>[type,Number(rows.find(r=>r.eventType===type)?.count||0)]))}}),
   byCollection:collections.map(r=>({collection:r.collection||'未分类',matches:Number(r.matches),used:Number(r.used)})),topItems:[...top.values()].sort((a,b)=>(b.clicks+b.views+b.maps)-(a.clicks+a.views+a.maps)).slice(0,20)}
 }
}
