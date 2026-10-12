import {createHash} from 'node:crypto'
import type {ChatMessage,LlmToolCall} from '../llm/types'
import type {RunOptions,RunResult,ToolOutcome} from './agent-runtime'
export type RuntimeNode='context'|'model'|'tools'|'finalize'|'end'
export interface RuntimeState {
 version:1;runId:string;scopeKey:string;contract:string;sequence:number;node:RuntimeNode;round:number;limit:number;
 messages:ChatMessage[];result:RunResult;pendingCalls:LlmToolCall[];completed:Record<string,ChatMessage>;
 inFlight:Record<string,{name:string;readOnly:boolean}>;writeLedger:string[];toolCache:{key:string;outcome:ToolOutcome}[];
 modelStart?:{text:number;reasoning:number};protocolRecoveryPending?:boolean;budget?:{inputTokens:number;removedTurns:number;truncatedResults:number};updatedAt:number
}
export interface RuntimeCheckpointOptions {runId:string;scopeKey:string;save:(state:RuntimeState)=>Promise<boolean|void>;resume?:RuntimeState}
export const runtimeGraph={version:1,nodes:['context','model','tools','finalize','end'],edges:[['context','model'],['model','tools'],['model','context'],['model','finalize'],['tools','context'],['finalize','end']]} as const
export function runtimeContract(options:RunOptions){return createHash('sha256').update(JSON.stringify({version:1,protocolRetryLimit:1,model:options.request.model,temperature:options.request.temperature,maxTokens:options.request.maxTokens,contextWindow:options.contextWindow,maxToolRounds:options.maxToolRounds,tools:options.tools.map(t=>({name:t.name,parameters:t.parameters,readOnly:t.readOnly===true}))})).digest('hex')}
export function copyState(state:RuntimeState):RuntimeState{return JSON.parse(JSON.stringify(state))}
export function validRuntimeState(value:any):value is RuntimeState {
 if(value?.protocolRecoveryPending!==undefined&&typeof value.protocolRecoveryPending!=='boolean')return false
 const retries=value?.result?.metrics?.automaticRetries
 if(retries!==undefined&&(!Number.isSafeInteger(retries)||retries<0||retries>1))return false
 const message=(m:any)=>m&&['system','user','assistant','tool'].includes(m.role)&&typeof m.content==='string'&&(!m.toolCalls||Array.isArray(m.toolCalls)&&m.toolCalls.every(call))
 function call(c:any){return c&&typeof c.id==='string'&&typeof c.name==='string'&&typeof c.arguments==='string'}
 return !!value&&value.version===1&&/^[a-zA-Z0-9_-]{1,120}$/.test(value.runId)&&/^[a-f0-9]{64}$/.test(value.scopeKey)&&/^[a-f0-9]{64}$/.test(value.contract)&&Number.isSafeInteger(value.sequence)&&value.sequence>=0&&runtimeGraph.nodes.includes(value.node)&&Number.isSafeInteger(value.round)&&value.round>=0&&Number.isSafeInteger(value.limit)&&value.limit>=1&&value.limit<=20&&value.round<=value.limit&&Array.isArray(value.messages)&&value.messages.every(message)&&Array.isArray(value.pendingCalls)&&value.pendingCalls.length<=12&&value.pendingCalls.every(call)&&value.completed&&typeof value.completed==='object'&&!Array.isArray(value.completed)&&Object.values(value.completed).every(message)&&value.inFlight&&typeof value.inFlight==='object'&&!Array.isArray(value.inFlight)&&Object.values(value.inFlight).every((v:any)=>v&&typeof v.name==='string'&&typeof v.readOnly==='boolean')&&Array.isArray(value.writeLedger)&&value.writeLedger.every((s:any)=>typeof s==='string')&&Array.isArray(value.toolCache)&&value.toolCache.every((c:any)=>c&&typeof c.key==='string'&&typeof c.outcome?.text==='string')&&typeof value.result?.text==='string'&&typeof value.result?.reasoning==='string'&&Number.isFinite(value.result?.promptTokens)&&Number.isFinite(value.result?.completionTokens)&&Array.isArray(value.result?.tools)&&Array.isArray(value.result?.modelMessages)&&value.result.modelMessages.every(message)&&Object.values(value.result?.metrics||{}).length>=10&&Number.isFinite(value.result?.metrics?.modelTurns)&&Number.isFinite(value.updatedAt)
}
/** Restore only into the same authorized owner, model/tool contract and workflow version. */
export function restoreRuntime(options:RunOptions,checkpoint:RuntimeCheckpointOptions):RuntimeState{
 const state=checkpoint.resume
 if(!validRuntimeState(state)||state.runId!==checkpoint.runId||state.scopeKey!==checkpoint.scopeKey||state.contract!==runtimeContract(options))throw new Error('任务检查点与当前用户、模型或工具权限不一致，不能恢复。')
 if(state.node==='end'||state.node==='finalize')throw new Error('任务已结束，请读取原回答或发起新任务。')
 if(Object.values(state.inFlight).some(t=>!t.readOnly))throw new Error('中断时存在结果未确认的写操作，请管理员核对；禁止自动重放。')
 const restored=copyState(state);restored.result.failure=undefined;restored.result.providerError=undefined;restored.result.aborted=false
 if(restored.node==='model'&&restored.modelStart){restored.result.text=restored.result.text.slice(0,restored.modelStart.text);restored.result.reasoning=restored.result.reasoning.slice(0,restored.modelStart.reasoning)}
 return restored
}
