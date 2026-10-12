import {Injectable} from '@nestjs/common'
import {createHash,randomUUID} from 'node:crypto'
import {mkdir,readFile,writeFile,rename,readdir,stat,unlink} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {PrismaService} from '../prisma/prisma.service'
import {SettingsService} from '../settings/settings.service'
import type {KnowledgeSource} from '../campus/knowledge-evidence'
import {stripToolMarkup} from '../presentation/output-boundary'
import {parseCardJson} from '../presentation/card-json'
export function cacheableAnswer(content:string){if(!content.trim()||content.includes('这部分回答未完整生成，请重新生成以补全内容。')||stripToolMarkup(content)!==content)return false;let inside=false,body='';for(const line of content.split('\n')){if(!inside&&/^\s*```(?:card|json)\s*$/i.test(line)){inside=true;body='';continue}if(inside&&/^\s*```\s*$/.test(line)){try{parseCardJson(body)}catch{return false}inside=false;continue}if(inside)body+=line+'\n'}return !inside}
export interface CachedAnswer {content:string;sources:KnowledgeSource[];presentation:any;createdAt:number}
export const normalizedCacheQuestion=(text:string)=>text.normalize('NFC').trim().replace(/\r\n/g,'\n')
/** Exact-question reuse is deliberately independent of conversation history. */
export function cacheHistory(_history:{role:string;content:string}[],_question:string){return []}
export function cacheEligible(query:string,images?:string[],bypass?:boolean){return !bypass&&!images?.length&&query.length<=6000&&!/今天|明天|昨天|今晚|本周|周末|最近|最新|现在|当前|天气|今日|本月|下周|今年|提醒|课表|几点|截止|日程|随机|抽签|换一个|重新生成|记录|保存|添加|修改|删除|提交|发送|订阅|更新|创建|自杀|自伤|不想活|\b(?:today|tomorrow|yesterday|tonight|current|latest|weather|random|remind|save|add|modify|delete|submit|send|subscribe|update|create)\b/i.test(query)}
@Injectable()
export class ResponseCacheService {
 private readonly directory=resolve(process.cwd(),'storage','.private','answer-cache');private lastClean=0
 constructor(private readonly prisma:PrismaService,private readonly settings:SettingsService){}
 async prepare(context:Record<string,unknown>):Promise<{key:string;days:number}|null>{
  try{
   if(!await this.settings.get<boolean>('answer_cache_enabled'))return null
   const days=Number(await this.settings.get('answer_cache_days'));if(!Number.isInteger(days)||days<1||days>30)return null
   const revision=await Promise.all([
    this.prisma.knowledgeBase.aggregate({_count:true,_max:{updatedAt:true}}),this.prisma.knowledgeEntry.aggregate({_count:true}),
    this.prisma.campusGuideItem.aggregate({_count:true,_max:{updatedAt:true}}),this.prisma.setting.aggregate({_count:true,_max:{updatedAt:true}}),this.prisma.skill.aggregate({_count:true,_max:{updatedAt:true}})
   ]) // Entry hit counters change updatedAt; semantic edits also bump knowledge_revision in settings.
   const {history:_,trialScope:__,...stable}=context
   const key=createHash('sha256').update(JSON.stringify({version:'answer-cache-v5',context:stable,revision})).digest('hex');return {key,days}
  }catch{return null}
 }
 async get(ticket:{key:string;days:number}|null):Promise<CachedAnswer|null>{
  if(!ticket||!/^[a-f0-9]{64}$/.test(ticket.key))return null
  try{const raw=await readFile(join(this.directory,ticket.key+'.json'),'utf8');if(Buffer.byteLength(raw)>128*1024)return null;const value=JSON.parse(raw);if(value.key!==ticket.key||!Number.isFinite(value.createdAt)||Date.now()-value.createdAt>=ticket.days*86400000||value.createdAt>Date.now()||typeof value.content!=='string'||!cacheableAnswer(value.content)||!Array.isArray(value.sources)||value.sources.length>64||value.sources.some((s:any)=>!s||typeof s.id!=='string'||typeof s.title!=='string'||typeof s.collection!=='string'||typeof s.source!=='string'||typeof s.used!=='boolean')||value.presentation?.valid!==true)return null;return value}catch{return null}
 }
 async put(ticket:{key:string;days:number}|null,answer:Omit<CachedAnswer,'createdAt'>){
  if(!ticket||!/^[a-f0-9]{64}$/.test(ticket.key)||!cacheableAnswer(answer.content)||answer.presentation?.valid!==true)return
  const content=JSON.stringify({...answer,key:ticket.key,createdAt:Date.now()});if(Buffer.byteLength(content)>128*1024)return
  let temporary:string|undefined
  try{await mkdir(this.directory,{recursive:true,mode:0o700});temporary=join(this.directory,ticket.key+'.'+randomUUID()+'.tmp');await writeFile(temporary,content,{mode:0o600});await rename(temporary,join(this.directory,ticket.key+'.json'));temporary=undefined;await this.clean(ticket.days)}catch{}finally{if(temporary)await unlink(temporary).catch(()=>undefined)}
 }
 private async clean(days:number){if(Date.now()-this.lastClean<60000)return;this.lastClean=Date.now();const names=(await readdir(this.directory)).filter(n=>/^[a-f0-9]{64}\.json$/.test(n));const files=await Promise.all(names.map(async name=>({name,modified:(await stat(join(this.directory,name))).mtimeMs})));files.sort((a,b)=>b.modified-a.modified);await Promise.all(files.filter((f,i)=>i>=256||Date.now()-f.modified>=days*86400000).map(f=>unlink(join(this.directory,f.name)).catch(()=>undefined)))}
}
