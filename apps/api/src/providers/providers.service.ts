import {removedConfigurationIds,assertConfigurationPresent,removeConfiguration} from '../common/configuration-removal'
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from "@nestjs/common"
import { PrismaService } from "../prisma/prisma.service"
import { CryptoService } from "../common/services/crypto.service"
import { AuditService } from "../common/services/audit.service"
import { ProviderKeyService } from "./provider-key.service"
import { CreateProviderDto, UpdateProviderDto } from "./dto/provider.dto"
import {discoverProviderModels,type DiscoveredModel} from './model-discovery'

@Injectable()
export class ProvidersService {
  private discovered=new Map<string,{until:number;models:DiscoveredModel[]}>()
  async discoverModels(id:string){
    const {provider,baseUrl,apiKey}=await this.resolveCredentials(id)
    const result=await discoverProviderModels(provider.type,baseUrl,apiKey)
    if(this.discovered.size>=100)this.discovered.delete(this.discovered.keys().next().value!)
    this.discovered.set(id,{until:Date.now()+600000,models:result.models})
    const existing=new Set((await this.prisma.model.findMany({where:{providerId:id},select:{key:true}})).map(m=>m.key))
    return {...result,models:result.models.map(m=>({...m,existing:existing.has(m.key)}))}
  }
  async importDiscovered(id:string,input:unknown,operator:{id:string;email:string}){
    if(!Array.isArray(input)||!input.length||input.length>200||input.some(k=>typeof k!=='string'))throw new BadRequestException('请选择 1–200 个模型')
    const snapshot=this.discovered.get(id);if(!snapshot||snapshot.until<Date.now())throw new BadRequestException('嗅探结果已过期或服务已重启，请重新嗅探')
    const keys=[...new Set(input as string[])],selected=keys.map(key=>snapshot.models.find(m=>m.key===key));if(selected.some(m=>!m))throw new BadRequestException('只能导入本次嗅探返回的模型')
    if(!await this.prisma.provider.findFirst({where:{id,enabled:true}}))throw new BadRequestException('供应商不存在或已关闭')
    const result=await this.prisma.model.createMany({data:selected.map(m=>({providerId:id,key:m!.key,name:m!.name,enabled:false,isDefault:false,supportsVision:m!.supportsVision??false,supportsTools:false,contextWindow:m!.contextWindow??8192,maxOutputTokens:Math.min(m!.maxOutputTokens??4096,m!.contextWindow??8192)})),skipDuplicates:true})
    await this.audit.log({userId:operator.id,actor:operator.email,action:'provider.models.import',resource:'provider',resourceId:id,detail:{created:result.count,requested:keys.length}})
    return {created:result.count,skipped:keys.length-result.count}
  }
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly keyPool: ProviderKeyService
  ) {}

  private toPublic(p: {
    id: string
    key: string
    name: string
    type: string
    baseUrl: string | null
    apiKey: string | null
    enabled: boolean
    isSystem: boolean
    sort: number
    description: string | null
    extra: unknown
    createdAt: Date
    updatedAt: Date
    _count?: { models: number }
  }) {
    return {
      id: p.id,
      key: p.key,
      name: p.name,
      type: p.type,
      baseUrl: p.baseUrl,
      enabled: p.enabled,
      isSystem: p.isSystem,
      sort: p.sort,
      description: p.description,
      extra: p.extra,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      hasApiKey: Boolean(p.apiKey),
      apiKeyMasked: this.crypto.mask(p.apiKey),
      modelCount: p._count?.models ?? 0
    }
  }

  async list() {
    const removed=await removedConfigurationIds(this.prisma,'provider')
    const providers = await this.prisma.provider.findMany({
      where:{id:{notIn:removed}},
      orderBy: [{ sort: "asc" }, { createdAt: "asc" }],
      include: { _count: { select: { models: true } } }
    })
    return providers.map((p) => this.toPublic(p))
  }

  /**
   * 对话链路使用：拿到解密后的 API Key。
   *
   * 优先从 Key 池轮询挑选（分摊配额 + 失效自动切换）；
   * 池子为空时回退到 Provider.apiKey（兼容单 Key 的旧数据），
   * 最后再回退到环境变量。
   *
   * 返回的 keyId 用于请求结束后上报成败，驱动 Key 的健康状态流转。
   */
  async resolveCredentials(providerId: string) {
    await assertConfigurationPresent(this.prisma,'provider',providerId)
    const provider = await this.prisma.provider.findUnique({
      where: { id: providerId }
    })
    if (!provider) throw new NotFoundException("供应商不存在")
    if (!provider.enabled) throw new BadRequestException("该供应商已被禁用")

    const baseUrl = provider.baseUrl || this.fallbackEnvBaseUrl(provider.key)

    // 1) Key 池
    const picked = await this.keyPool.pick(providerId)
    if (picked) {
      return {
        provider,
        apiKey: picked.apiKey,
        baseUrl,
        keyId: picked.keyId,
        keyLabel: picked.label
      }
    }

    // 2) 旧的单 Key 字段
    const legacy = this.crypto.decrypt(provider.apiKey)
    if (legacy) {
      return { provider, apiKey: legacy, baseUrl, keyId: null, keyLabel: null }
    }

    // 3) 环境变量兜底
    const envKey = this.fallbackEnvKey(provider.key)
    if (envKey) {
      return { provider, apiKey: envKey, baseUrl, keyId: null, keyLabel: null }
    }

    if (provider.type !== "OLLAMA") {
      // 池子里有 Key 但全部不可用时，给出比「尚未配置」更有用的提示
      const poolStats = await this.keyPool.stats(providerId).catch(() => null)
      if (poolStats && poolStats.total > 0) {
        throw new BadRequestException(
          `供应商「${provider.name}」的 ${poolStats.total} 把 Key 当前都不可用` +
            `（可用 ${poolStats.available} 把）。请在「模型供应商 → Key 池」检查状态。`
        )
      }
      throw new BadRequestException(`供应商「${provider.name}」尚未配置 API Key`)
    }

    return { provider, apiKey: "", baseUrl, keyId: null, keyLabel: null }
  }

  /** 请求成功后上报（供调用方在拿到首个响应时调用） */
  async reportKeySuccess(keyId?: string | null) {
    if (!keyId) return
    await this.keyPool.reportSuccess(keyId).catch(() => undefined)
  }

  /** 请求失败后上报，驱动 Key 冷却/失效 */
  async reportKeyFailure(keyId: string | null | undefined, error: string) {
    if (!keyId) return
    await this.keyPool.reportFailure(keyId, error).catch(() => undefined)
  }

  private fallbackEnvKey(key: string): string {
    const map: Record<string, string> = {
      openai: "OPENAI_API_KEY",
      anthropic: "ANTHROPIC_API_KEY",
      google: "GOOGLE_GEMINI_API_KEY",
      deepseek: "DEEPSEEK_API_KEY",
      moonshot: "MOONSHOT_API_KEY",
      dashscope: "DASHSCOPE_API_KEY",
      openrouter: "OPENROUTER_API_KEY",
      groq: "GROQ_API_KEY",
      azure: "AZURE_OPENAI_API_KEY"
    }
    const envName = map[key]
    return envName ? process.env[envName] || "" : ""
  }

  private fallbackEnvBaseUrl(key: string): string | null {
    const map: Record<string, string> = {
      openai: "OPENAI_BASE_URL",
      deepseek: "DEEPSEEK_BASE_URL",
      moonshot: "MOONSHOT_BASE_URL",
      dashscope: "DASHSCOPE_BASE_URL",
      ollama: "OLLAMA_BASE_URL"
    }
    const envName = map[key]
    return envName ? process.env[envName] || null : null
  }

  async detail(id: string) {
    await assertConfigurationPresent(this.prisma,'provider',id)
    const provider = await this.prisma.provider.findUnique({
      where: { id },
      include: {
        models: { orderBy: [{ sort: "asc" }, { key: "asc" }] },
        _count: { select: { models: true } }
      }
    })
    if (!provider) throw new NotFoundException("供应商不存在")
    return { ...this.toPublic(provider), models: provider.models }
  }

  async create(dto: CreateProviderDto, operator?: { id: string; email: string }) {
    const key = dto.key.trim().toLowerCase()
    const exists = await this.prisma.provider.findUnique({ where: { key } })
    if (exists) throw new ConflictException("该供应商标识已存在")

    const provider = await this.prisma.provider.create({
      data: {
        key,
        name: dto.name,
        type: dto.type ?? "OPENAI_COMPATIBLE",
        baseUrl: dto.baseUrl ?? null,
        apiKey: dto.apiKey ? this.crypto.encrypt(dto.apiKey) : null,
        enabled: dto.enabled ?? true,
        sort: dto.sort ?? 0,
        description: dto.description ?? null,
        extra: (dto.extra ?? undefined) as any
      },
      include: { _count: { select: { models: true } } }
    })

    await this.audit.log({
      userId: operator?.id,
      actor: operator?.email,
      action: "provider.create",
      resource: "provider",
      resourceId: provider.id,
      detail: { key, hasApiKey: Boolean(dto.apiKey) }
    })

    return this.toPublic(provider)
  }

  async update(
    id: string,
    dto: UpdateProviderDto,
    operator?: { id: string; email: string }
  ) {
    await assertConfigurationPresent(this.prisma,'provider',id)
    const provider = await this.prisma.provider.findUnique({ where: { id } })
    if (!provider) throw new NotFoundException("供应商不存在")

    // apiKey 语义：undefined 不改；"" 清空；其它值覆盖
    let apiKey: string | null | undefined = undefined
    if (dto.apiKey !== undefined) {
      apiKey = dto.apiKey === "" ? null : this.crypto.encrypt(dto.apiKey)
    }

    const updated = await this.prisma.provider.update({
      where: { id },
      data: {
        name: dto.name,
        type: dto.type,
        baseUrl: dto.baseUrl,
        apiKey,
        enabled: dto.enabled,
        description: dto.description,
        sort: dto.sort,
        extra: dto.extra === undefined ? undefined : (dto.extra as any)
      },
      include: { _count: { select: { models: true } } }
    })

    await this.audit.log({
      userId: operator?.id,
      actor: operator?.email,
      action: "provider.update",
      resource: "provider",
      resourceId: id,
      detail: {
        fields: Object.keys(dto),
        apiKeyChanged: dto.apiKey !== undefined
      }
    })

    return this.toPublic(updated)
  }

  async remove(id: string, operator?: { id: string; email: string }) {
    const provider = await this.prisma.provider.findUnique({
      where: { id },
      include: {
        _count: { select: { models: true } }
      }
    })
    if (!provider) throw new NotFoundException("供应商不存在")
    await removeConfiguration(this.prisma,'provider',id)
    await this.audit.log({
      userId: operator?.id,
      actor: operator?.email,
      action: "provider.delete",
      resource: "provider",
      resourceId: id,
      detail: { key: provider.key }
    })
    return { success: true }
  }

  async toggle(id: string, enabled: boolean, operator?: { id: string; email: string }) {
    await assertConfigurationPresent(this.prisma,'provider',id)
    const provider = await this.prisma.provider.update({
      where: { id },
      data: { enabled },
      include: { _count: { select: { models: true } } }
    })
    await this.audit.log({
      userId: operator?.id,
      actor: operator?.email,
      action: "provider.toggle",
      resource: "provider",
      resourceId: id,
      detail: { enabled }
    })
    return this.toPublic(provider)
  }
}
