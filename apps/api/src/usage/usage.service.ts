import { Injectable, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import { PrismaService } from "../prisma/prisma.service"
import { AuditService } from "../common/services/audit.service"
import { QuotaService } from "../common/services/quota.service"
import { dailyQuotaStart } from '../common/services/quota-window'
import { QueryUsageDto, UpdateQuotaDto, BatchQuotaDto } from "./dto/usage.dto"

function parseRange(from?: string, to?: string) {
  const range: { gte?: Date; lte?: Date } = {}
  if (from) {
    const d = new Date(from)
    if (!Number.isNaN(d.getTime())) {
      d.setHours(0, 0, 0, 0)
      range.gte = d
    }
  }
  if (to) {
    const d = new Date(to)
    if (!Number.isNaN(d.getTime())) {
      d.setHours(23, 59, 59, 999)
      range.lte = d
    }
  }
  return Object.keys(range).length > 0 ? range : undefined
}

@Injectable()
export class UsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly quota: QuotaService
  ) {}

  async listRecords(query: QueryUsageDto, forceUserId?: string) {
    const where: Prisma.UsageRecordWhereInput = {}
    const userId = forceUserId || query.userId
    if (userId) where.userId = userId
    if (query.providerKey) where.providerKey = query.providerKey
    if (query.modelKey) where.modelKey = query.modelKey
    if (query.source) where.source = query.source as any
    const createdAt = parseRange(query.from, query.to)
    if (createdAt) where.createdAt = createdAt

    return this.prisma.paginate(
      this.prisma.usageRecord,
      {
        where,
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { id: true, email: true, name: true, department: true } },
          model: { select: { id: true, name: true, key: true } }
        }
      },
      Number(query.page) || 1,
      Number(query.pageSize) || 20
    )
  }

  /** 汇总统计：总量、按天、按模型、按用户、按来源 */
  async overview(query: QueryUsageDto, forceUserId?: string) {
    const where: Prisma.UsageRecordWhereInput = {}
    const userId = forceUserId || query.userId
    if (userId) where.userId = userId
    const createdAt = parseRange(query.from, query.to)
    if (createdAt) where.createdAt = createdAt

    const [totals, bySource] = await Promise.all([
      this.prisma.usageRecord.aggregate({
        where,
        _sum: {
          promptTokens: true,
          completionTokens: true,
          totalTokens: true,
          costUsd: true
        },
        _count: { _all: true },
        _avg: { latencyMs: true }
      }),
      this.prisma.usageRecord.groupBy({
        by: ["source"],
        where,
        _sum: { totalTokens: true, costUsd: true },
        _count: { _all: true }
      })
    ])

    const failed = await this.prisma.usageRecord.count({
      where: { ...where, success: false }
    })

    return {
      totals: {
        requests: totals._count._all,
        promptTokens: totals._sum.promptTokens ?? 0,
        completionTokens: totals._sum.completionTokens ?? 0,
        totalTokens: totals._sum.totalTokens ?? 0,
        costUsd: Number((totals._sum.costUsd ?? 0).toFixed(4)),
        avgLatencyMs: Math.round(totals._avg.latencyMs ?? 0),
        failedRequests: failed,
        successRate:
          totals._count._all > 0
            ? Number(
                (((totals._count._all - failed) / totals._count._all) * 100).toFixed(1)
              )
            : 100
      },
      bySource: bySource.map((s) => ({
        source: s.source,
        requests: s._count._all,
        totalTokens: s._sum.totalTokens ?? 0,
        costUsd: Number((s._sum.costUsd ?? 0).toFixed(4))
      }))
    }
  }

  /** 按天趋势 */
  async trend(query: QueryUsageDto, forceUserId?: string) {
    const where: Prisma.UsageRecordWhereInput = {}
    const userId = forceUserId || query.userId
    if (userId) where.userId = userId
    const createdAt = parseRange(query.from, query.to)
    if (createdAt) where.createdAt = createdAt

    const rows = await this.prisma.usageRecord.findMany({
      where,
      select: {
        createdAt: true,
        totalTokens: true,
        costUsd: true,
        promptTokens: true,
        completionTokens: true
      },
      orderBy: { createdAt: "asc" }
    })

    const map = new Map<
      string,
      { date: string; tokens: number; costUsd: number; requests: number; promptTokens: number; completionTokens: number }
    >()

    for (const row of rows) {
      const key = row.createdAt.toISOString().slice(0, 10)
      const item =
        map.get(key) ||
        { date: key, tokens: 0, costUsd: 0, requests: 0, promptTokens: 0, completionTokens: 0 }
      item.tokens += row.totalTokens
      item.promptTokens += row.promptTokens
      item.completionTokens += row.completionTokens
      item.costUsd += row.costUsd
      item.requests += 1
      map.set(key, item)
    }

    return Array.from(map.values()).map((r) => ({
      ...r,
      costUsd: Number(r.costUsd.toFixed(4))
    }))
  }

  /** 按模型排行 */
  async byModel(query: QueryUsageDto, forceUserId?: string) {
    const where: Prisma.UsageRecordWhereInput = {}
    const userId = forceUserId || query.userId
    if (userId) where.userId = userId
    const createdAt = parseRange(query.from, query.to)
    if (createdAt) where.createdAt = createdAt

    const grouped = await this.prisma.usageRecord.groupBy({
      by: ["providerKey", "modelKey"],
      where,
      _sum: { totalTokens: true, costUsd: true, promptTokens: true, completionTokens: true },
      _count: { _all: true },
      _avg: { latencyMs: true },
      orderBy: { _sum: { totalTokens: "desc" } },
      take: 20
    })

    return grouped.map((g) => ({
      providerKey: g.providerKey,
      modelKey: g.modelKey,
      requests: g._count._all,
      promptTokens: g._sum.promptTokens ?? 0,
      completionTokens: g._sum.completionTokens ?? 0,
      totalTokens: g._sum.totalTokens ?? 0,
      costUsd: Number((g._sum.costUsd ?? 0).toFixed(4)),
      avgLatencyMs: Math.round(g._avg.latencyMs ?? 0)
    }))
  }

  /** 按用户排行（管理端） */
  async byUser(query: QueryUsageDto) {
    const where: Prisma.UsageRecordWhereInput = {}
    const createdAt = parseRange(query.from, query.to)
    if (createdAt) where.createdAt = createdAt

    const grouped = await this.prisma.usageRecord.groupBy({
      by: ["userId"],
      where,
      _sum: { totalTokens: true, costUsd: true },
      _count: { _all: true },
      orderBy: { _sum: { totalTokens: "desc" } },
      take: 50
    })

    const users = await this.prisma.user.findMany({
      where: { id: { in: grouped.map((g) => g.userId) } },
      select: { id: true, email: true, name: true, department: true }
    })
    const map = new Map(users.map((u) => [u.id, u]))

    return grouped.map((g) => ({
      userId: g.userId,
      user: map.get(g.userId) ?? null,
      requests: g._count._all,
      totalTokens: g._sum.totalTokens ?? 0,
      costUsd: Number((g._sum.costUsd ?? 0).toFixed(4))
    }))
  }

  // ---------- 配额 ----------

  async listQuotas(keyword?: string, page = 1, pageSize = 20) {
    const where: Prisma.UserWhereInput = keyword
      ? {
          OR: [
            { email: { contains: keyword, mode: "insensitive" } },
            { name: { contains: keyword, mode: "insensitive" } },
            { studentNo: { contains: keyword, mode: "insensitive" } }
          ]
        }
      : {}

    const result = await this.prisma.paginate(
      this.prisma.user,
      {
        where,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          email: true,
          name: true,
          department: true,
          studentNo: true,
          status: true,
          quota: true,
          roles: { select: { role: { select: { key: true, name: true } } } }
        }
      },
      page,
      pageSize
    )

    // Daily quota counters honor the reset; monthly accounting stays intact.
    const now = new Date()
    const startOfDay = await dailyQuotaStart(this.prisma, now)
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const ids = result.items.map((u) => u.id)

    const usage = ids.length
      ? await this.prisma.usageRecord.groupBy({
          by: ["userId"],
          where: { userId: { in: ids }, createdAt: { gte: startOfMonth } },
          _sum: { totalTokens: true },
          _count: { _all: true }
        })
      : []

    const today = ids.length
      ? await this.prisma.usageRecord.groupBy({
          by: ["userId"],
          where: { userId: { in: ids }, createdAt: { gte: startOfDay } },
          _sum: { totalTokens: true },
          _count: { _all: true }
        })
      : []
    const todayMap = new Map(
      today.map((u) => [
        u.userId,
        { dailyTokens: u._sum.totalTokens ?? 0, dailyRequests: u._count._all }
      ])
    )
    const usageMap = new Map(
      usage.map((u) => [
        u.userId,
        {
          monthlyTokens: u._sum.totalTokens ?? 0,
          monthlyRequests: u._count._all
        }
      ])
    )

    return {
      ...result,
      items: result.items.map((u) => ({
        ...u,
        roles: u.roles.map((r) => r.role),
        usage: {
          dailyTokens: todayMap.get(u.id)?.dailyTokens ?? 0,
          dailyRequests: todayMap.get(u.id)?.dailyRequests ?? 0,
          monthlyTokens: usageMap.get(u.id)?.monthlyTokens ?? 0,
          monthlyRequests: usageMap.get(u.id)?.monthlyRequests ?? 0
        }
      }))
    }
  }

  async getQuota(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true }
    })
    if (!user) throw new NotFoundException("用户不存在")

    const quota = await this.quota.getQuota(userId)
    const status = await this.quota.check(userId)
    return { user, quota, usage: status.used, limits: status.limits, allowed: status.allowed }
  }

  async setQuota(
    userId: string,
    dto: UpdateQuotaDto,
    operator?: { id: string; email: string }
  ) {
    await this.quota.getQuota(userId) // 确保存在

    const quota = await this.prisma.userQuota.update({
      where: { userId },
      data: {
        enabled: dto.enabled,
        dailyTokenLimit: dto.dailyTokenLimit,
        monthlyTokenLimit: dto.monthlyTokenLimit,
        dailyRequestLimit: dto.dailyRequestLimit,
        rpmLimit: dto.rpmLimit,
        note: dto.note
      }
    })

    await this.audit.log({
      userId: operator?.id,
      actor: operator?.email,
      action: "quota.update",
      resource: "quota",
      resourceId: userId,
      detail: dto as unknown as Record<string, unknown>
    })

    return quota
  }

  /** 批量设置配额：按用户 / 角色 / 院系 */
  async batchSetQuota(
    dto: BatchQuotaDto,
    operator?: { id: string; email: string }
  ) {
    let userIds: string[] = dto.userIds ?? []

    if (userIds.length === 0 && dto.roleKey) {
      const rows = await this.prisma.userRole.findMany({
        where: { role: { key: dto.roleKey } },
        select: { userId: true }
      })
      userIds = rows.map((r) => r.userId)
    }
    if (userIds.length === 0 && dto.department) {
      const rows = await this.prisma.user.findMany({
        where: { department: dto.department },
        select: { id: true }
      })
      userIds = rows.map((r) => r.id)
    }
    if (userIds.length === 0) {
      return { success: true, count: 0 }
    }

    const data = {
      enabled: dto.enabled ?? true,
      dailyTokenLimit: dto.dailyTokenLimit ?? 0,
      monthlyTokenLimit: dto.monthlyTokenLimit ?? 0,
      dailyRequestLimit: dto.dailyRequestLimit ?? 0,
      rpmLimit: dto.rpmLimit ?? 0,
      note: dto.note ?? null
    }

    // upsert 每条，保证没有配额记录的用户也能被创建出来
    await this.prisma.$transaction(
      userIds.map((userId) =>
        this.prisma.userQuota.upsert({
          where: { userId },
          create: { userId, ...data },
          update: data
        })
      )
    )

    await this.audit.log({
      userId: operator?.id,
      actor: operator?.email,
      action: "quota.batch_update",
      resource: "quota",
      detail: { count: userIds.length, ...data }
    })

    return { success: true, count: userIds.length }
  }
}
