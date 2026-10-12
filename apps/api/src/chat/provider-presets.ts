import type { ProviderType } from "@prisma/client"

export interface ProviderPreset {
  key: string
  name: string
  type: ProviderType
  baseUrl: string | null
  description: string
  /** 该供应商的常用模型，仅用于初始化 */
  models: {
    key: string
    name: string
    contextWindow: number
    maxOutputTokens: number
    supportsVision?: boolean
    supportsTools?: boolean
    inputPricePerM?: number
    outputPricePerM?: number
    description?: string
  }[]
}

/**
 * 内置供应商预设。种子数据与「一键恢复默认」都从这里读取，
 * 使后台在没有任何配置的情况下也能直接跑起来。
 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    key: "deepseek",
    name: "DeepSeek",
    type: "OPENAI_COMPATIBLE",
    baseUrl: "https://api.deepseek.com/v1",
    description: "深度求索，国内直连，性价比高",
    models: [
      {
        key: "deepseek-chat",
        name: "DeepSeek Chat",
        contextWindow: 65536,
        maxOutputTokens: 8192,
        supportsTools: true,
        inputPricePerM: 0.27,
        outputPricePerM: 1.1,
        description: "通用对话模型，适合校园问答与写作"
      },
      {
        key: "deepseek-reasoner",
        name: "DeepSeek Reasoner",
        contextWindow: 65536,
        maxOutputTokens: 8192,
        supportsTools: false,
        inputPricePerM: 0.55,
        outputPricePerM: 2.19,
        description: "深度推理模型，返回思维链"
      }
    ]
  },
  {
    key: "openai",
    name: "OpenAI",
    type: "OPENAI_COMPATIBLE",
    baseUrl: "https://api.openai.com/v1",
    description: "OpenAI 官方接口，需要海外网络",
    models: [
      {
        key: "gpt-4o-mini",
        name: "GPT-4o mini",
        contextWindow: 128000,
        maxOutputTokens: 16384,
        supportsVision: true,
        supportsTools: true,
        inputPricePerM: 0.15,
        outputPricePerM: 0.6
      },
      {
        key: "gpt-4o",
        name: "GPT-4o",
        contextWindow: 128000,
        maxOutputTokens: 16384,
        supportsVision: true,
        supportsTools: true,
        inputPricePerM: 2.5,
        outputPricePerM: 10
      }
    ]
  },
  {
    key: "dashscope",
    name: "阿里云百炼（通义千问）",
    type: "OPENAI_COMPATIBLE",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    description: "阿里云通义千问，OpenAI 兼容模式",
    models: [
      {
        key: "qwen-plus",
        name: "通义千问 Plus",
        contextWindow: 131072,
        maxOutputTokens: 8192,
        supportsTools: true,
        inputPricePerM: 0.11,
        outputPricePerM: 0.28
      },
      {
        key: "qwen-max",
        name: "通义千问 Max",
        contextWindow: 32768,
        maxOutputTokens: 8192,
        supportsTools: true
      },
      {
        key: "qwen-long",
        name: "通义千问 Long",
        contextWindow: 1000000,
        maxOutputTokens: 8192,
        description: "超长上下文，适合整本教材与论文"
      }
    ]
  },
  {
    key: "moonshot",
    name: "月之暗面 Kimi",
    type: "OPENAI_COMPATIBLE",
    baseUrl: "https://api.moonshot.cn/v1",
    description: "Kimi，长文本能力强",
    models: [
      {
        key: "moonshot-v1-8k",
        name: "Moonshot v1 8K",
        contextWindow: 8192,
        maxOutputTokens: 4096
      },
      {
        key: "moonshot-v1-128k",
        name: "Moonshot v1 128K",
        contextWindow: 131072,
        maxOutputTokens: 4096
      }
    ]
  },
  {
    key: "anthropic",
    name: "Anthropic Claude",
    type: "ANTHROPIC",
    baseUrl: "https://api.anthropic.com",
    description: "Claude 系列，需要海外网络",
    models: [
      {
        key: "claude-3-5-sonnet-20241022",
        name: "Claude 3.5 Sonnet",
        contextWindow: 200000,
        maxOutputTokens: 8192,
        supportsVision: true,
        supportsTools: true,
        inputPricePerM: 3,
        outputPricePerM: 15
      },
      {
        key: "claude-3-5-haiku-20241022",
        name: "Claude 3.5 Haiku",
        contextWindow: 200000,
        maxOutputTokens: 8192,
        supportsVision: true,
        supportsTools: true
      }
    ]
  },
  {
    key: "google",
    name: "Google Gemini",
    type: "GOOGLE",
    baseUrl: null,
    description: "Gemini 系列，需要海外网络",
    models: [
      {
        key: "gemini-1.5-flash",
        name: "Gemini 1.5 Flash",
        contextWindow: 1048576,
        maxOutputTokens: 8192,
        supportsVision: true,
        supportsTools: true
      },
      {
        key: "gemini-1.5-pro",
        name: "Gemini 1.5 Pro",
        contextWindow: 2097152,
        maxOutputTokens: 8192,
        supportsVision: true,
        supportsTools: true
      }
    ]
  },
  {
    key: "ollama",
    name: "Ollama 本地模型",
    type: "OLLAMA",
    baseUrl: "http://localhost:11434/v1",
    description: "本地推理，数据不出校内",
    models: [
      {
        key: "qwen2.5:7b",
        name: "Qwen2.5 7B（本地）",
        contextWindow: 32768,
        maxOutputTokens: 4096,
        supportsTools: true
      }
    ]
  },
  {
    key: "openrouter",
    name: "OpenRouter",
    type: "OPENAI_COMPATIBLE",
    baseUrl: "https://openrouter.ai/api/v1",
    description: "聚合多家模型，统一网关",
    models: [
      {
        key: "openai/gpt-4o-mini",
        name: "GPT-4o mini (OpenRouter)",
        contextWindow: 128000,
        maxOutputTokens: 16384,
        supportsVision: true,
        supportsTools: true
      }
    ]
  }
]

/** 供应商 key -> 预设信息 */
export const PRESET_MAP = new Map(PROVIDER_PRESETS.map((p) => [p.key, p]))

/** 供应商类型 -> 默认接口地址 */
export const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com/v1",
  moonshot: "https://api.moonshot.cn/v1",
  dashscope: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  openrouter: "https://openrouter.ai/api/v1",
  groq: "https://api.groq.com/openai/v1",
  ollama: "http://localhost:11434/v1"
}