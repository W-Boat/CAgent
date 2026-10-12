import {googleContents,googleTools} from './message-adapters'
import {
  GoogleGenerativeAI,
  type Content,
  type Part
} from "@google/generative-ai"
import {
  estimateTokens,
  type LlmChatOptions,
  type LlmProvider,
  type LlmStreamEvent
} from "./types"
import { isAbort, normalizeError } from "./openai-compatible.provider"

export class GoogleProvider implements LlmProvider {
  readonly type = "GOOGLE" as const

  async *stream(options: LlmChatOptions): AsyncGenerator<LlmStreamEvent> {
    const genAI = new GoogleGenerativeAI(options.apiKey)

    const model = genAI.getGenerativeModel(
      {
        model: options.model,
        systemInstruction: options.messages
          .filter((m) => m.role === "system")
          .map((m) => m.content)
          .join("\n\n") || undefined,
        generationConfig: {
          temperature: options.temperature ?? 0.7,
          maxOutputTokens: options.maxTokens || 4096
        }
      },
      { baseUrl: options.baseUrl || undefined }
    )

    const contents = googleContents(options.messages)

    let textLength = 0
    let promptTokens = 0
    let completionTokens = 0

    try {
      const result = await model.generateContentStream(
        { contents:contents as Content[], ...(options.tools?.length?{tools:googleTools(options.tools) as any}: {}) },
        { signal: options.signal }
      )

      for await (const chunk of result.stream) {
        const parts=chunk.candidates?.[0]?.content?.parts||[]
        const text=parts.filter((part:any)=>typeof part.text==='string'&&!part.thought).map((part:any)=>part.text).join('')
        for(const part of parts)if((part as any).thought&&typeof (part as any).text==='string')yield {type:'reasoning',text:(part as any).text}
        if (text) {
          textLength += text.length
          yield { type: "text", text }
        }
        const meta = chunk.usageMetadata
        if (meta) {
          promptTokens = meta.promptTokenCount ?? promptTokens
          completionTokens = meta.candidatesTokenCount ?? completionTokens
        }
      }

      const final = await result.response
      for(const [index,call] of (final.functionCalls()||[]).entries())yield {type:'tool_call',call:{id:'google_'+Date.now()+'_'+index,name:call.name,arguments:JSON.stringify(call.args||{})}}
      const finalMeta = final.usageMetadata
      if (finalMeta) {
        promptTokens = finalMeta.promptTokenCount ?? promptTokens
        completionTokens = finalMeta.candidatesTokenCount ?? completionTokens
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
      yield { type: "done" }
    } catch (err) {
      if (isAbort(err)) {
        yield { type: "done", finishReason: "aborted" }
        return
      }
      yield { type: "error", message: normalizeError(err) }
    }
  }
}
