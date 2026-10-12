import type { ProviderType } from "@prisma/client"

export type ChatRole = "system" | "user" | "assistant" | "tool"

export interface ChatMessage {
  role: ChatRole
  content: string
  name?: string
  toolCallId?: string
  /** 多模态图片（data URL 或公网地址） */
  images?: string[]
  toolCalls?: LlmToolCall[]
}

export interface LlmToolCall {
  id: string
  name: string
  arguments: string
}

export interface LlmToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
  /** Execution hint; adapters only expose the schema to providers. */
  readOnly?:boolean
  /** Internal hint, never exposed in provider tool schemas. */
  knowledgeRetrieval?:boolean
}

export interface LlmUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export type LlmStreamEvent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool_call"; call: LlmToolCall }
  | { type: "usage"; usage: LlmUsage }
  | { type: "done"; finishReason?: string }
  | { type: "error"; message: string }

export interface LlmChatOptions {
  model: string
  messages: ChatMessage[]
  apiKey: string
  baseUrl?: string | null
  temperature?: number
  maxTokens?: number
  tools?: LlmToolDef[]
  signal?: AbortSignal
  extra?: Record<string, unknown> | null
}

export interface LlmProvider {
  readonly type: ProviderType
  stream(options: LlmChatOptions): AsyncGenerator<LlmStreamEvent>
}

/** 粗略估算 token（无 tiktoken 时的兜底，中文按 1.5 字符/token 计） */
export function estimateTokens(text: string): number {
  if (!text) return 0
  const cjk = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  const rest = text.length - cjk
  return Math.ceil(cjk / 1.5 + rest / 4)
}
