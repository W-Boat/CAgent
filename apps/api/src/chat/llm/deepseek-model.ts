export const deepSeekThinkingEfforts = ['none', 'low', 'high', 'max'] as const
export type DeepSeekThinkingEffort = typeof deepSeekThinkingEfforts[number]

export function supportsDeepSeekThinking(model: string, baseUrl?: string | null): boolean {
  return /^deepseek-(?:flash|v4(?:\.\d+)?-(?:flash|pro))$/i.test(model) &&
    /^https:\/\/api\.deepseek\.com(?:\/v1)?\/?$/i.test(baseUrl || '')
}
