import type {RuntimeCheckpointOptions} from './runtime-state'
import type {ProviderCacheSummary} from '../llm/provider-cache'
import type {ChatMessage,LlmChatOptions,LlmProvider,LlmToolCall,LlmToolDef} from '../llm/types'

export type RunStage='preparing'|'context'|'model'|'tools'|'retrying'|'finalizing'
export interface RunProgress {stage:RunStage;round:number;maxRounds:number;inputTokens?:number;removedTurns?:number;truncatedResults?:number;node?:string;stateVersion?:number;resumed?:boolean;retryAttempt?:number}
export interface ToolOutcome {text:string;isError?:boolean}
export interface RuntimeTool extends LlmToolDef {
  /** Only explicitly classified read-only tools may be cached or run in parallel. */
  readOnly?:boolean
  /** Trusted runtime gate, rechecked before each execution. */
  available?:()=>boolean
  execute:(args:Record<string,unknown>,signal:AbortSignal)=>Promise<string|ToolOutcome>
}
export interface ToolRecord {id:string;name:string;arguments:string;result:string;status:'SUCCESS'|'FAILED'|'ABORTED';durationMs:number;cached:boolean;round:number}
export interface RunMetrics {modelTurns:number;toolCalls:number;cachedCalls:number;failedTools:number;removedTurns:number;truncatedResults:number;peakInputTokens:number;latencyMs:number;limitReached:boolean;checkpointWrites?:number;nodeTransitions?:number;resumedFromCheckpoint?:boolean;checkpointAvailable?:boolean;automaticRetries?:number;providerCache?:ProviderCacheSummary}
export interface RuntimeHooks {
  /** Trusted application hooks. Untrusted knowledge never registers executable hooks. */
  beforeModel?:(context:{messages:ChatMessage[];round:number},signal:AbortSignal)=>Promise<ChatMessage[]|void>
  beforeTool?:(tool:RuntimeTool,args:Record<string,unknown>,signal:AbortSignal)=>Promise<void>
  afterTool?:(tool:RuntimeTool,result:ToolOutcome,signal:AbortSignal)=>Promise<ToolOutcome|void>
}
export interface RunOptions {
  provider:LlmProvider
  request:Omit<LlmChatOptions,'messages'|'tools'|'signal'>
  messages:ChatMessage[]
  tools:RuntimeTool[]
  contextWindow:number
  maxToolRounds:number
  signal:AbortSignal
  checkpoint?:RuntimeCheckpointOptions
  hooks?:RuntimeHooks
  emit:(event:string,data:any)=>void
}
export interface RunResult {text:string;reasoning:string;promptTokens:number;completionTokens:number;finishReason?:string;failure?:string;providerError?:boolean;aborted:boolean;tools:ToolRecord[];metrics:RunMetrics;modelMessages:ChatMessage[]}

/** Explicit state graph; public runtime interface remains stable. */
export {AgentRuntime} from './agent-graph'
