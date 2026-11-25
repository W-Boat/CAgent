const endpointVariables: Record<string, string> = {
  openai: 'OPENAI_BASE_URL',
  deepseek: 'DEEPSEEK_BASE_URL',
  moonshot: 'MOONSHOT_BASE_URL',
  dashscope: 'DASHSCOPE_BASE_URL',
  ollama: 'OLLAMA_BASE_URL'
}

export function providerEndpoint(provider: {key:string;baseUrl?:string|null}) {
  const envName = endpointVariables[provider.key]
  return provider.baseUrl || (envName ? process.env[envName] : undefined) || null
}
