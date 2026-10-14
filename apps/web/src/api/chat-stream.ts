import {requestSse} from './sse'
import {campusOrigin} from "@/utils/campus-activity"
import { tokenStore,ensureAccessToken } from "./client"

const BASE_URL = import.meta.env.VITE_API_BASE || "/api"

export interface KnowledgeSource {
  id:string;citationId?:string;title:string;summary?:string;url?:string;collection:string;
  source:string;locator?:string;trust?:string;used:boolean;kind?:string
}

export interface ChatStreamMeta {
  conversationId: string
  userMessageId: string
  assistantMessageId: string
  model: { id: string; key: string; name: string; provider: string }
  title: string
}

export interface ChatStreamUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costUsd: number
  latencyMs: number
}

export interface ChatStreamDone {
  conversationId?: string
  assistantMessageId?: string
  status: string
  flagged?: boolean
  finishReason?: string | null
  toolCalls?: string[]
  runtime?:AgentRunMetrics
}

export interface ToolCallPayload {
  id: string
  name: string
  arguments?: string
}

export interface AgentRunMetrics {automaticRetries?:number;checkpointWrites?:number;nodeTransitions?:number;resumedFromCheckpoint?:boolean;checkpointAvailable?:boolean;cacheHit?:boolean;modelTurns:number;toolCalls:number;cachedCalls:number;failedTools:number;removedTurns:number;truncatedResults:number;peakInputTokens:number;latencyMs:number;limitReached:boolean}
export interface AgentRunProgress {stage:'preparing'|'context'|'model'|'tools'|'retrying'|'finalizing';round:number;maxRounds:number;inputTokens?:number;removedTurns?:number;truncatedResults?:number;retryAttempt?:number}

export interface ChatStreamHandlers {
  onUploadProgress?:(percent:number)=>void
  onRuntime?:(progress:AgentRunProgress)=>void
  onKb?: (payload:{hits:KnowledgeSource[];phase?:string}) => void
  onMeta?: (meta: ChatStreamMeta) => void
  onText?: (text: string) => void
  onReasoning?: (text: string) => void
  onToolCall?: (call: ToolCallPayload) => void
  onToolStart?: (payload: { id: string; name: string; arguments: Record<string, unknown> }) => void
  onToolResult?: (payload: { id: string; name: string; result: string;status?:string;isError?:boolean;cached?:boolean;durationMs?:number }) => void
  onUsage?: (usage: ChatStreamUsage) => void
  onDone?: (done: ChatStreamDone) => void
  onError?: (message: string) => void
}

export interface SendMessagePayload {
  outputPreference?:'cards'|'adaptive'|'text'
  bypassCache?:boolean
  conversationId?: string
  content: string
  modelId?: string
  agentId?: string
  images?: string[]
  skills?: string[]
  enableTools?: boolean
  temperature?: number
}

/**
 * 通过 fetch + ReadableStream 消费后端 SSE。
 * 相比 EventSource，fetch 支持 POST body 与 Authorization 头。
 * 返回一个 abort 函数用于中断生成。
 */
export function streamChat(payload:SendMessagePayload,handlers:ChatStreamHandlers){
 return chatRequest('/chat/completions',{...payload,origin:campusOrigin()},handlers)
}
function chatRequest(path:string,payload:unknown,handlers:ChatStreamHandlers){
 return requestSse({url:BASE_URL+path,body:payload,authorize:ensureAccessToken,onUploadProgress:(payload as SendMessagePayload).images?.length?handlers.onUploadProgress:undefined,headers:tokenStore.access?{Authorization:'Bearer '+tokenStore.access}:{},onError:message=>handlers.onError?.(message),onDone:result=>handlers.onDone?.(result),onFrame:({event,data})=>{
  const value=data as any
  switch(event){
   case 'runtime':handlers.onRuntime?.(value);break
   case 'kb':handlers.onKb?.(value);break
   case 'meta':handlers.onMeta?.(value);break
   case 'text':handlers.onText?.(value?.text||'');break
   case 'reasoning':handlers.onReasoning?.(value?.text||'');break
   case 'tool_call':handlers.onToolCall?.(value);break
   case 'tool_start':handlers.onToolStart?.(value);break
   case 'tool_result':handlers.onToolResult?.(value);break
   case 'usage':handlers.onUsage?.(value);break
  }
 }})
}
/** Regeneration targets the actual endpoint and preserves historical answers. */
export function regenerateChat(payload:{conversationId:string;messageId?:string;modelId?:string;outputPreference?:'cards'|'adaptive'|'text'},handlers:ChatStreamHandlers){return chatRequest('/chat/regenerate',{...payload,origin:campusOrigin()},handlers)}
