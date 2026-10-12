import {BadRequestException,Injectable} from '@nestjs/common'
import {PrismaService} from '../prisma/prisma.service'
import {estimateTokens,type ChatMessage,type LlmToolDef} from './llm/types'
import {contextTurns,fitContext,messageTokens} from './runtime/context-budget'
import {isUiDocument,uiContentText,validateUiDocument} from '../presentation/agent-ui'

export interface ResolvedModel {
 id:string;key:string;name:string;providerId:string;providerKey:string;providerName:string;providerType:string;
 contextWindow:number;maxOutputTokens:number;supportsVision:boolean;supportsTools:boolean;inputPricePerM:number;outputPricePerM:number;temperature:number
}
export interface HistoryMessage extends ChatMessage {seq?:number}

/** History, display content and model context are distinct; trimming preserves complete turns. */
@Injectable()
export class ContextBuilderService {
 constructor(private readonly prisma:PrismaService){}
 build(params:{systemPrompts:string[];history:HistoryMessage[];budgetTokens:number;maxOutputTokens:number;currentQuery?:string;tools?:LlmToolDef[]}):ChatMessage[] {
  const system=params.systemPrompts.map(p=>(p||'').trim()).filter(Boolean).join('\n\n')
  const prefix:ChatMessage[]=system?[{role:'system',content:system}]:[]
  const turns=contextTurns(params.history),last=turns.at(-1)
  if(!last)return prefix
  const schemaCost=params.tools?.length?estimateTokens(JSON.stringify(params.tools))+32:0
  let budget=Math.floor((params.budgetTokens-params.maxOutputTokens)*0.85)-schemaCost-128-prefix.reduce((n,m)=>n+messageTokens(m),0)-last.reduce((n,m)=>n+messageTokens(m),0)
  const words=(params.currentQuery||'').toLowerCase().match(/[a-z0-9_]{3,}|[\u4e00-\u9fff]{2,}/g)||[]
  const ranked=turns.slice(0,-1).map((turn,index)=>{
    const text=turn.map(m=>m.content).join(' ').toLowerCase()
    const score=(index===turns.length-2?100:0)+(index+1)/turns.length+words.filter(word=>text.includes(word)).length*0.2
    return {turn,index,score,cost:turn.reduce((n,m)=>n+messageTokens(m),0)}
  }).sort((a,b)=>b.score-a.score)
  const picked=ranked.filter(item=>{if(item.cost>budget)return false;budget-=item.cost;return true}).sort((a,b)=>a.index-b.index)
  try{return fitContext([...prefix,...picked.flatMap(item=>item.turn),...last],params.tools||[],params.budgetTokens,params.maxOutputTokens).messages}
  catch(error){throw new BadRequestException((error as Error).message)}
 }
 async loadHistory(conversationId:string,excludeMessageId?:string,limit=40,beforeSeq?:number):Promise<HistoryMessage[]> {
  const rows=await this.prisma.message.findMany({where:{conversationId,...(beforeSeq?{seq:{lt:beforeSeq}}:{}),status:{in:['SUCCESS','ABORTED']},...(excludeMessageId?{id:{not:excludeMessageId}}:{})},orderBy:{seq:'desc'},take:Math.min(200,Math.max(2,limit||40)),select:{id:true,role:true,content:true,seq:true,attachments:true}})
  return rows.sort((a,b)=>a.seq-b.seq).filter(r=>r.role!=='system').flatMap(row=>{
    const attachments=row.attachments as any
    const transcript=attachments?.modelMessages
    if(row.role==='assistant'&&Array.isArray(transcript)&&validTranscript(transcript))return transcript.map(m=>({...m,content:modelText(m),seq:row.seq}))
    return [{role:row.role as ChatMessage['role'],content:modelText(row),seq:row.seq,...(row.role==='user'&&Array.isArray(attachments?.images)?{images:attachments.images.filter((x:any)=>typeof x==='string').slice(0,8)}:{})}]
  })
 }
 buildTools(supportsTools:boolean,defs:LlmToolDef[]):LlmToolDef[]|undefined {return supportsTools&&defs.length?defs:undefined}
 async generateSummary(conversationId:string,maxMessages=10):Promise<string> {
  const history=await this.loadHistory(conversationId,undefined,maxMessages)
  return '历史对话摘录（并非完整摘要）：\n'+history.filter(m=>m.role==='user'||m.role==='assistant').map(m=>`${m.role==='user'?'用户':'助手'}：${m.content.slice(0,160)}`).join('\n')
 }
}
function modelText(message:{role:string;content:string}):string {
 if(message.role!=='assistant')return message.content
 // Keep validated compact structure as well as facts: flattening teaches follow-ups to emit plain text.
 // Prior citation IDs are turn-local, so do not feed stale references back to the model.
 return message.content.replace(/```(?:card|json)\s*\n([\s\S]*?)\n```/gi,(whole,raw)=>{
  try{const value=JSON.parse(raw);if(!isUiDocument(value))return whole;const checked=validateUiDocument(value);if(!checked.page)return uiContentText(value);const clean=(node:any):any=>{const {sourceRefs,...fields}=node;return {...fields,...(node.children?{children:node.children.map(clean)}:{})}};return '```card\n'+JSON.stringify(clean(checked.page))+'\n```'}catch{return whole}
 }).trim()
}
function validTranscript(value:any[]):boolean {
 if(!value.length||value.length>260)return false
 const pending=new Set<string>()
 for(const message of value){
  if(!message||!['assistant','tool'].includes(message.role)||typeof message.content!=='string')return false
  if(message.role==='assistant'){
   if(pending.size)return false
   if(message.toolCalls){if(!Array.isArray(message.toolCalls)||message.toolCalls.length>12)return false;for(const call of message.toolCalls){if(!call||typeof call.id!=='string'||typeof call.name!=='string'||typeof call.arguments!=='string'||pending.has(call.id))return false;pending.add(call.id)}}
  }else{if(!pending.delete(message.toolCallId))return false}
 }
 return pending.size===0&&value.at(-1).role==='assistant'
}
