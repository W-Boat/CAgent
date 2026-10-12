import {anthropicMessages} from './message-adapters'
import Anthropic from "@anthropic-ai/sdk"
import {
  estimateTokens,
  type LlmChatOptions,
  type LlmProvider,
  type LlmStreamEvent,
  type LlmToolCall
} from "./types"
import { isAbort, normalizeError } from "./openai-compatible.provider"

export class AnthropicProvider implements LlmProvider {
  readonly type = "ANTHROPIC" as const

  async *stream(options: LlmChatOptions): AsyncGenerator<LlmStreamEvent> {
    const client = new Anthropic({
      apiKey: options.apiKey,
      baseURL: options.baseUrl || undefined,
      timeout: 120_000,
      maxRetries: 1
    })

    // Claude 把 system 从 messages 中抽出来单独传
    const systemParts = options.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)

    const messages = anthropicMessages(options.messages)

    let promptTokens = 0
    let completionTokens = 0
    let textLength = 0
    let finishReason: string | undefined

    const toolCalls: LlmToolCall[] = []
    const toolAcc = new Map<number, { id: string; name: string; json: string; initial: unknown }>()

    try {
      const stream = await client.messages.create(
        {
          model: options.model,
          max_tokens: options.maxTokens || 4096,
          temperature: options.temperature ?? 0.7,
          system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
          messages: messages as any,
          tools:
            options.tools && options.tools.length > 0
              ? (options.tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  input_schema: t.parameters as any
                })) as any)
              : undefined,
          stream: true
        } as any,
        { signal: options.signal }
      )

      for await (const event of stream as any) {
        if (event.type === "message_start") {
          promptTokens = event.message?.usage?.input_tokens ?? 0
        } else if (event.type === "content_block_start") {
          const block = event.content_block
          if (block?.type === "tool_use") {
            toolAcc.set(event.index, {
              id: block.id,
              name: block.name,
              json: "", initial:block.input || {}
            })
          }
        } else if (event.type === "content_block_delta") {
          const delta = event.delta
          if (delta?.type === "text_delta" && delta.text) {
            textLength += delta.text.length
            yield { type: "text", text: delta.text }
          } else if (delta?.type === "thinking_delta" && delta.thinking) {
            yield { type: "reasoning", text: delta.thinking }
          } else if (delta?.type === "input_json_delta") {
            const acc = toolAcc.get(event.index)
            if (acc) acc.json += delta.partial_json || ""
          }
        } else if (event.type === "content_block_stop") {
          const acc = toolAcc.get(event.index)
          if (acc) {
            toolCalls.push({ id: acc.id, name: acc.name, arguments: acc.json || JSON.stringify(acc.initial) })
          }
        } else if (event.type === "message_delta") {
          completionTokens = event.usage?.output_tokens ?? completionTokens
          finishReason = event.delta?.stop_reason ?? finishReason
        }
      }

      for (const call of toolCalls) {
        yield { type: "tool_call", call }
      }

      const usage = {
        promptTokens:
          promptTokens ||
          estimateTokens(options.messages.map((m) => m.content).join("\n")),
        completionTokens: completionTokens || Math.ceil(textLength / 3),
        totalTokens: 0
      }
      usage.totalTokens = usage.promptTokens + usage.completionTokens
      yield { type: "usage", usage }
      yield { type: "done", finishReason }
    } catch (err) {
      if (isAbort(err)) {
        yield { type: "done", finishReason: "aborted" }
        return
      }
      yield { type: "error", message: normalizeError(err) }
    }
  }
}
