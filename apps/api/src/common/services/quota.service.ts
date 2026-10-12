import { ForbiddenException, Injectable, Logger } from "@nestjs/common"
import { PrismaService } from "../../prisma/prisma.service"
import { dailyQuotaStart } from './quota-window'

export interface QuotaCheckResult {
  allowed: boolean
  reason?: string
  used: { dailyTokens: number; monthlyTokens: number; dailyRequests: number }
  limits: {
    dailyTokenLimit: number
    monthlyTokenLimit: number
    dailyRequestLimit: number
    rpmLimit: number
  }
}

@Injectable()
export class QuotaService {
  private readonly logger = new Logger(QuotaService.name)
  /** 进程内 RPM 滑动窗口：userId -> 最近请求时间戳 */
  private readonly rpmWindow = new Map<string, number[]>()

  constructor(private readonly prisma: PrismaService) {}

  private startOfMonth(): Date {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  }

  async getQuota(userId: string) {
    let quota = await this.prisma.userQuota.findUnique({ where: { userId } })
    if (!quota) {
      quota = await this.prisma.userQuota.create({
        data: {
          userId,
          dailyTokenLimit: Number(process.env.DEFAULT_DAILY_TOKEN_QUOTA || 0),
          monthlyTokenLimit: 0,
          dailyRequestLimit: 0,
          rpmLimit: 0
        }
      })
    }
    return quota
  }

  /** 检查配额；不通过时抛 403 */
  async assertWithinQuota(userId: string): Promise<QuotaCheckResult> {
    const result = await this.check(userId)
    if (!result.allowed) {
      throw new ForbiddenException(result.reason || "已超出配额限制")
    }
    return result
  }

  async check(userId: string): Promise<QuotaCheckResult> {
    const quota = await this.getQuota(userId)
    const limits = {
      dailyTokenLimit: quota.dailyTokenLimit,
      monthlyTokenLimit: quota.monthlyTokenLimit,
      dailyRequestLimit: quota.dailyRequestLimit,
      rpmLimit: quota.rpmLimit
    }

    const dailyStart = await dailyQuotaStart(this.prisma)
    const [daily, monthly] = await Promise.all([
      this.prisma.usageRecord.aggregate({
        where: { userId, createdAt: { gte: dailyStart } },
        _sum: { totalTokens: true },
        _count: { _all: true }
      }),
      this.prisma.usageRecord.aggregate({
        where: { userId, createdAt: { gte: this.startOfMonth() } },
        _sum: { totalTokens: true }
      })
    ])

    const used = {
      dailyTokens: daily._sum.totalTokens ?? 0,
      monthlyTokens: monthly._sum.totalTokens ?? 0,
      dailyRequests: daily._count._all ?? 0
    }

    if (!quota.enabled) {
      return { allowed: true, used, limits }
    }

    if (limits.dailyTokenLimit > 0 && used.dailyTokens >= limits.dailyTokenLimit) {
      return {
        allowed: false,
        reason: `今日 token 配额已用尽（${used.dailyTokens}/${limits.dailyTokenLimit}）`,
        used,
        limits
      }
    }
    if (
      limits.monthlyTokenLimit > 0 &&
      used.monthlyTokens >= limits.monthlyTokenLimit
    ) {
      return {
        allowed: false,
        reason: `本月 token 配额已用尽（${used.monthlyTokens}/${limits.monthlyTokenLimit}）`,
        used,
        limits
      }
    }
    if (
      limits.dailyRequestLimit > 0 &&
      used.dailyRequests >= limits.dailyRequestLimit
    ) {
      return {
        allowed: false,
        reason: `今日请求次数已达上限（${used.dailyRequests}/${limits.dailyRequestLimit}）`,
        used,
        limits
      }
    }
    if (limits.rpmLimit > 0 && !this.consumeRpm(userId, limits.rpmLimit)) {
      return {
        allowed: false,
        reason: `请求过于频繁，每分钟上限 ${limits.rpmLimit} 次`,
        used,
        limits
      }
    }

    return { allowed: true, used, limits }
  }

  private consumeRpm(userId: string, limit: number): boolean {
    const now = Date.now()
    const windowStart = now - 60_000
    const hits = (this.rpmWindow.get(userId) || []).filter(
      (t) => t > windowStart
    )
    if (hits.length >= limit) {
      this.rpmWindow.set(userId, hits)
      return false
    }
    hits.push(now)
    this.rpmWindow.set(userId, hits)
    return true
  }

  /** 记录一次调用消耗 */
  async recordUsage(params: {
    userId: string
    conversationId?: string | null
    messageId?: string | null
    modelId?: string | null
    providerKey: string
    modelKey: string
    source?: "CHAT" | "SKILL" | "BROWSER" | "EMBEDDING"
    promptTokens?: number
    completionTokens?: number
    costUsd?: number
    latencyMs?: number
    success?: boolean
    errorCode?: string | null
  }): Promise<void> {
    const promptTokens = params.promptTokens ?? 0
    const completionTokens = params.completionTokens ?? 0
    try {
      await this.prisma.usageRecord.create({
        data: {
          userId: params.userId,
          conversationId: params.conversationId ?? null,
          messageId: params.messageId ?? null,
          modelId: params.modelId ?? null,
          providerKey: params.providerKey,
          modelKey: params.modelKey,
          source: params.source ?? "CHAT",
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          costUsd: params.costUsd ?? 0,
          latencyMs: params.latencyMs ?? 0,
          success: params.success ?? true,
          errorCode: params.errorCode ?? null
        }
      })
    } catch (err) {
      this.logger.warn(`记录用量失败: ${(err as Error).message}`)
    }
  }
}
