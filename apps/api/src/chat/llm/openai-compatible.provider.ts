import OpenAI from "openai"
import {providerCacheUsage} from './provider-cache'
import {
  estimateTokens,
  type LlmChatOptions,
  type LlmProvider,
  type LlmStreamEvent,
  type LlmToolCall
} from "./types"

/**
 * OpenAI 兼容协议实现。
 * DeepSeek / Moonshot / DashScope / OpenRouter / Groq / Ollama / vLLM
 * 都走这条链路，差异只在 baseUrl 与模型名。
 */
export class OpenAiCompatibleProvider implements LlmProvider {
  readonly type = "OPENAI_COMPATIBLE" as const

  async *stream(options: LlmChatOptions): AsyncGenerator<LlmStreamEvent> {
    const client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseUrl || undefined,
      timeout: 120_000,
      maxRetries: 1
    })

    const messages = options.messages.map((m) => {
      if (m.images && m.images.length > 0) {
        return {
          role: m.role,
          content: [
            { type: "text", text: m.content },
            ...m.images.map((url) => ({
              type: "image_url" as const,
              image_url: { url }
            }))
          ]
        }
      }
      if (m.role === "tool") {
        return {
          role: "tool" as const,
          content: m.content,
          tool_call_id: m.toolCallId || ""
        }
      }
      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        return {
          role: "assistant" as const,
          content: m.content || null,
          tool_calls: m.toolCalls.map((c) => ({
            id: c.id,
            type: "function" as const,
            function: { name: c.name, arguments: c.arguments }
          }))
        }
      }
      return { role: m.role, content: m.content }
    })

    const payload: any = {
      model: options.model,
      messages,
      stream: true,
      stream_options: { include_usage: true }
    }
    if (options.temperature !== undefined) payload.temperature = options.temperature
    if (options.maxTokens) payload.max_tokens = options.maxTokens
    if (options.tools && options.tools.length > 0) {
      payload.tools = options.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }
      }))
      payload.tool_choice = "auto"
    }
    if (options.extra?.topP !== undefined) payload.top_p = options.extra.topP

    let promptTokens = 0
    let completionTokens = 0
    let cacheUsage:ReturnType<typeof providerCacheUsage> = {}
    let finishReason: string | undefined
    let textLength = 0
    const toolBuffers = new Map<number, LlmToolCall>()
    const emittedToolIndexes = new Set<number>()

    try {
      const stream = await client.chat.completions.create(payload, {
        signal: options.signal
      })

      for await (const chunk of stream as any) {
        const choice = chunk.choices?.[0]

        if (chunk.usage) {
          promptTokens = chunk.usage.prompt_tokens ?? promptTokens
          completionTokens = chunk.usage.completion_tokens ?? completionTokens
          const reported=providerCacheUsage(chunk.usage)
          if(reported.promptCacheHitTokens!==undefined)cacheUsage=reported
        }

        if (!choice) continue

        if (choice.finish_reason) finishReason = choice.finish_reason

        const delta = choice.delta || {}

        // 深度思考内容（DeepSeek reasoner / Claude thinking 等）
        const reasoning =
          delta.reasoning_content ?? delta.reasoning ?? undefined
        if (typeof reasoning === "string" && reasoning.length > 0) {
          yield { type: "reasoning", text: reasoning }
        }

        if (typeof delta.content === "string" && delta.content.length > 0) {
          textLength += delta.content.length
          yield { type: "text", text: delta.content }
        }

        // 增量拼接工具调用
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0
            if (!toolBuffers.has(idx)) {
              toolBuffers.set(idx, {
                id: tc.id || `call_${idx}_${Date.now()}`,
                name: tc.function?.name || "",
                arguments: ""
              })
            }
            const buf = toolBuffers.get(idx)!
            if (tc.id) buf.id = tc.id
            if (tc.function?.name) buf.name = tc.function.name
            if (tc.function?.arguments) buf.arguments += tc.function.arguments
          }
        }
      }

      // 流结束后一次性发出完整的工具调用
      for (const [idx, call] of toolBuffers) {
        if (emittedToolIndexes.has(idx)) continue
        emittedToolIndexes.add(idx)
        if (call.name) yield { type: "tool_call", call }
      }

      const usage = {
        ...cacheUsage,
        promptTokens: promptTokens || estimateTokens(
          options.messages.map((m) => m.content).join("\n")
        ),
        completionTokens: completionTokens || Math.ceil(textLength / 3),
        totalTokens: 0
      }
      usage.totalTokens = usage.promptTokens + usage.completionTokens
      yield { type: "usage", usage }
      yield { type: "done", finishReason }
    } catch (err) {
      const message = normalizeError(err)
      if (isAbort(err)) {
        yield { type: "done", finishReason: "aborted" }
        return
      }
      yield { type: "error", message }
    }
  }
}

export function isAbort(err: unknown): boolean {
  const e = err as any
  return (
    e?.name === "AbortError" ||
    e?.code === "ABORT_ERR" ||
    e?.message === "Request was aborted."
  )
}

export function normalizeError(err: unknown): string {
  const e = err as any
  const status = e?.status || e?.response?.status
  const detail =
    e?.error?.message ||
    e?.response?.data?.error?.message ||
    e?.message ||
    "未知错误"

  if (status === 401) return "API Key 无效或已过期"
  if (status === 403) return "该 API Key 无权访问此模型"
  if (status === 404) return `模型不存在或接口地址错误：${detail}`
  if (status === 429) return "触发供应商限流，请稍后重试"
  if (status === 400) return `请求被拒绝：${detail}`
  if (status && status >= 500) return `供应商服务异常（${status}）：${detail}`
  if (e?.code === "ENOTFOUND" || e?.code === "ECONNREFUSED") {
    return "无法连接供应商接口，请检查网络或接口地址"
  }
  return String(detail)
}
