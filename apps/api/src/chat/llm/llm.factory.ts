import { Injectable } from "@nestjs/common"
import type { ProviderType } from "@prisma/client"
import { OpenAiCompatibleProvider } from "./openai-compatible.provider"
import { AnthropicProvider } from "./anthropic.provider"
import { GoogleProvider } from "./google.provider"
import type { LlmProvider } from "./types"

/** 按供应商类型选择协议实现 */
@Injectable()
export class LlmFactory {
  private readonly openai = new OpenAiCompatibleProvider()
  private readonly anthropic = new AnthropicProvider()
  private readonly google = new GoogleProvider()

  resolve(type: ProviderType): LlmProvider {
    switch (type) {
      case "ANTHROPIC":
        return this.anthropic
      case "GOOGLE":
        return this.google
      // Ollama 与 Azure 都提供 OpenAI 兼容端点
      case "OLLAMA":
      case "AZURE_OPENAI":
      case "OPENAI_COMPATIBLE":
      default:
        return this.openai
    }
  }
}