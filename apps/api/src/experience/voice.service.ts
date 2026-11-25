import { BadRequestException, ForbiddenException, HttpException, Injectable, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma/prisma.service'
import { ProvidersService } from '../providers/providers.service'
import { SettingsService } from '../settings/settings.service'

@Injectable()
export class VoiceService {
  private readonly active = new Set<string>()
  private readonly recent = new Map<string, number>()

  constructor(private readonly config: ConfigService, private readonly prisma: PrismaService,
    private readonly providers: ProvidersService, private readonly settings: SettingsService) {}

  async transcribe(user: string, bytes?: Buffer) {
    const maxSeconds = await this.settings.get<number>('voice_asr_max_seconds')
    if (!bytes || !this.validWav(bytes, maxSeconds)) throw new BadRequestException(`录音需为有效的 PCM WAV，最长 ${maxSeconds} 秒`)
    const form = new FormData()
    form.append('file', new Blob([Uint8Array.from(bytes)], { type: 'audio/wav' }), 'voice.wav')
    return this.call(user, 'asr', form, async response => {
      const value = await response.json()
      if (typeof value.text !== 'string') throw new Error('Missing transcript')
      return { text: value.text.slice(0, 12000), durationMs: value.duration_ms }
    })
  }

  private validWav(bytes: Buffer, maxSeconds: number) {
    if (bytes.length <= 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' ||
      bytes.toString('ascii', 8, 16) !== 'WAVEfmt ' || bytes.toString('ascii', 36, 40) !== 'data') return false
    const rate = bytes.readUInt32LE(24)
    const dataSize = bytes.readUInt32LE(40)
    return bytes.readUInt32LE(4) === bytes.length - 8 && bytes.readUInt32LE(16) === 16 &&
      bytes.readUInt16LE(20) === 1 && bytes.readUInt16LE(22) === 1 && bytes.readUInt16LE(34) === 16 &&
      [8000, 16000, 22050, 24000, 32000, 44100, 48000].includes(rate) && bytes.readUInt32LE(28) === rate * 2 &&
      bytes.readUInt16LE(32) === 2 && dataSize === bytes.length - 44 && dataSize % 2 === 0 && dataSize <= rate * 2 * maxSeconds
  }

  async speak(user: string, text: unknown) {
    const limit = await this.settings.get<number>('voice_tts_max_chars')
    if (typeof text !== 'string' || !text.trim() || text.length > limit)
      throw new BadRequestException(`朗读文字需为 1–${limit} 字`)
    const [voice, filter] = await Promise.all([
      this.settings.get<string>('voice_tts_voice'), this.settings.get<boolean>('voice_tts_filter_markdown'),
    ])
    return this.call(user, 'tts', JSON.stringify({ text, voice_id: voice, format: 'wav', filter_markdown: filter }), async response => {
      if (!response.body || !response.headers.get('content-type')?.startsWith('audio/')) throw new Error('Missing speech')
      const reader = response.body.getReader()
      const chunks: Buffer[] = []
      let bytes = 0
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          bytes += value.length
          if (bytes > 20 * 1024 * 1024) throw new Error('Speech too large')
          chunks.push(Buffer.from(value))
        }
      } finally {
        await reader.cancel().catch(() => undefined)
      }
      const result = Buffer.concat(chunks)
      if (result.length <= 44 || result.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Invalid speech')
      return result
    })
  }

  private async call<T>(user: string, kind: 'asr' | 'tts', body: string | FormData, read: (response: Response) => Promise<T>) {
    if (await this.settings.get(`voice_${kind}_enabled`) !== true) throw new ForbiddenException('此语音功能未开启')
    const now = Date.now()
    for (const [id, time] of this.recent) if (now - time > 5000) this.recent.delete(id)
    if (this.active.has(user) || this.active.size >= 12 || this.recent.has(user))
      throw new HttpException('语音请求过于频繁，请稍后再试', 429)
    this.active.add(user)
    this.recent.set(user, now)
    try {
      let key = this.config.get<string>('DEEPSEEK_VOICE_API_KEY') || this.config.get<string>('DEEPSEEK_API_KEY')
      const providerId = await this.settings.get<string>('voice_provider_id')
      if (!key || providerId) {
        const provider = await this.prisma.provider.findFirst({
          where: providerId ? { id: providerId, enabled: true } : { key: 'deepseek', enabled: true },
          select: { id: true, baseUrl: true },
        })
        if (provider && /^https:\/\/api\.deepseek\.com(?:\/v1)?\/?$/i.test(provider.baseUrl || ''))
          key = (await this.providers.resolveCredentials(provider.id)).apiKey
        else if (providerId) key = undefined
      }
      if (!key) throw new ServiceUnavailableException('尚未配置 DeepSeek 语音凭据')
      const timeout = await this.settings.get<number>('voice_timeout_seconds')
      const response = await fetch('https://api.deepseek.com/v1/tools/' + kind, {
        method: 'POST', body, redirect: 'error', signal: AbortSignal.timeout(timeout * 1000),
        headers: { Authorization: 'Bearer ' + key, ...(typeof body === 'string' ? { 'Content-Type': 'application/json' } : {}) },
      })
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        if (response.status === 400 || response.status === 413) throw new BadRequestException('DeepSeek 未接受该段音频或朗读内容')
        if (response.status === 429) throw new HttpException('DeepSeek 语音请求过多，请稍后再试', 429)
        throw new ServiceUnavailableException('DeepSeek 语音接口暂不可用，请检查凭据与接口权限')
      }
      return await read(response)
    } catch (error) {
      if (error instanceof HttpException) throw error
      throw new ServiceUnavailableException('语音请求失败，请检查网络或缩短录音和朗读内容')
    } finally {
      this.active.delete(user)
    }
  }
}
