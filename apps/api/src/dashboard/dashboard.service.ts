import { Injectable } from "@nestjs/common"
import {visibleCapabilityWhere,visibleConversationWhere,visibleAuditWhere} from '../common/retired-capabilities'
import { PrismaService } from "../prisma/prisma.service"

function daysAgo(n: number): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - n)
  return d
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /** 管理后台首页的核心指标 */
  async summary() {
    const today = daysAgo(0)
    const week = daysAgo(6)
    const month = daysAgo(29)

    const [
      userTotal,
      userActive,
      userNewToday,
      conversationTotal,
      conversationToday,
      messageTotal,
      messageToday,
      tokenToday,
      tokenWeek,
      tokenMonth,
      costMonth,
      providerTotal,
      providerEnabled,
      modelTotal,
      modelEnabled,
      skillTotal,
      skillEnabled,
      skillRunToday,
      browserActive,
      agentTotal,
      flaggedMessages,
      failedCalls
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { status: "ACTIVE" } }),
      this.prisma.user.count({ where: { createdAt: { gte: today } } }),
      this.prisma.conversation.count({ where: { status: { not: "DELETED" } } }),
      this.prisma.conversation.count({ where: { createdAt: { gte: today } } }),
      this.prisma.message.count(),
      this.prisma.message.count({ where: { createdAt: { gte: today } } }),
      this.prisma.usageRecord.aggregate({
        where: { createdAt: { gte: today } },
        _sum: { totalTokens: true, costUsd: true },
        _count: { _all: true }
      }),
      this.prisma.usageRecord.aggregate({
        where: { createdAt: { gte: week } },
        _sum: { totalTokens: true }
      }),
      this.prisma.usageRecord.aggregate({
        where: { createdAt: { gte: month } },
        _sum: { totalTokens: true, costUsd: true }
      }),
      this.prisma.usageRecord.aggregate({
        where: { createdAt: { gte: month } },
        _sum: { costUsd: true }
      }),
      this.prisma.provider.count(),
      this.prisma.provider.count({ where: { enabled: true } }),
      this.prisma.model.count(),
      this.prisma.model.count({ where: { enabled: true } }),
      this.prisma.skill.count({where:visibleCapabilityWhere}),
      this.prisma.skill.count({ where: { ...visibleCapabilityWhere,enabled: true } }),
      this.prisma.skillRun.count({ where: { skill:{is:visibleCapabilityWhere},startedAt: { gte: today } } }),
      this.prisma.browserSession.count({ where: { status: "ACTIVE" } }),
      this.prisma.agent.count({ where: { ...visibleCapabilityWhere,enabled: true } }),
      this.prisma.message.count({ where: { flagged: true } }),
      this.prisma.usageRecord.count({
        where: { createdAt: { gte: today }, success: false }
      })
    ])

    return {
      users: {
        total: userTotal,
        active: userActive,
        disabled: userTotal - userActive,
        newToday: userNewToday
      },
      conversations: {
        total: conversationTotal,
        today: conversationToday
      },
      messages: {
        total: messageTotal,
        today: messageToday,
        flagged: flaggedMessages
      },
      usage: {
        requestsToday: tokenToday._count._all,
        tokensToday: tokenToday._sum.totalTokens ?? 0,
        tokensWeek: tokenWeek._sum.totalTokens ?? 0,
        tokensMonth: tokenMonth._sum.totalTokens ?? 0,
        costMonthUsd: Number((costMonth._sum.costUsd ?? 0).toFixed(4)),
        failedToday: failedCalls
      },
      providers: { total: providerTotal, enabled: providerEnabled },
      models: { total: modelTotal, enabled: modelEnabled },
      skills: {
        total: skillTotal,
        enabled: skillEnabled,
        runsToday: skillRunToday
      },
      browser: { activeSessions: browserActive },
      agents: { enabled: agentTotal }
    }
  }

  /** 近 N 天的趋势：消息量 / token 量 / 新增用户 */
  async trends(days = 14) {
    const since = daysAgo(days - 1)

    const [usage, messages, users, skillRuns] = await Promise.all([
      this.prisma.usageRecord.findMany({
        where: { createdAt: { gte: since } },
        select: { createdAt: true, totalTokens: true, costUsd: true }
      }),
      this.prisma.message.findMany({
        where: { createdAt: { gte: since } },
        select: { createdAt: true }
      }),
      this.prisma.user.findMany({
        where: { createdAt: { gte: since } },
        select: { createdAt: true }
      }),
      this.prisma.skillRun.findMany({
        where: { skill:{is:visibleCapabilityWhere},startedAt: { gte: since } },
        select: { startedAt: true, status: true }
      })
    ])

    // 先建出连续日期骨架，保证前端折线不断点
    const buckets = new Map<
      string,
      {
        date: string
        tokens: number
        costUsd: number
        requests: number
        messages: number
        newUsers: number
        skillRuns: number
      }
    >()

    for (let i = 0; i < days; i++) {
      const d = daysAgo(days - 1 - i)
      const key = d.toISOString().slice(0, 10)
      buckets.set(key, {
        date: key,
        tokens: 0,
        costUsd: 0,
        requests: 0,
        messages: 0,
        newUsers: 0,
        skillRuns: 0
      })
    }

    const bump = (
      date: Date,
      field: "tokens" | "costUsd" | "requests" | "messages" | "newUsers" | "skillRuns",
      amount = 1
    ) => {
      const key = date.toISOString().slice(0, 10)
      const bucket = buckets.get(key)
      if (bucket) bucket[field] += amount
    }

    for (const row of usage) {
      bump(row.createdAt, "tokens", row.totalTokens)
      bump(row.createdAt, "costUsd", row.costUsd)
      bump(row.createdAt, "requests")
    }
    for (const row of messages) bump(row.createdAt, "messages")
    for (const row of users) bump(row.createdAt, "newUsers")
    for (const row of skillRuns) bump(row.startedAt, "skillRuns")

    return Array.from(buckets.values()).map((b) => ({
      ...b,
      costUsd: Number(b.costUsd.toFixed(4))
    }))
  }

  /** 排行榜：活跃用户 / 热门模型 / 热门技能 */
  async rankings() {
    const since = daysAgo(6)

    const [topUsers, topModels, topSkills, topAgents] = await Promise.all([
      this.prisma.usageRecord.groupBy({
        by: ["userId"],
        where: { createdAt: { gte: since } },
        _sum: { totalTokens: true },
        _count: { _all: true },
        orderBy: { _sum: { totalTokens: "desc" } },
        take: 10
      }),
      this.prisma.usageRecord.groupBy({
        by: ["modelKey"],
        where: { createdAt: { gte: since } },
        _sum: { totalTokens: true },
        _count: { _all: true },
        orderBy: { _count: { modelKey: "desc" } },
        take: 10
      }),
      this.prisma.skillRun.groupBy({
        by: ["skillId"],
        where: { startedAt: { gte: since } },
        _count: { _all: true },
        orderBy: { _count: { skillId: "desc" } },
        take: 10
      }),
      this.prisma.conversation.groupBy({
        by: ["agentId"],
        where: { createdAt: { gte: since }, agentId: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { agentId: "desc" } },
        take: 10
      })
    ])

    const [users, skills, agents] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: topUsers.map((u) => u.userId) } },
        select: { id: true, name: true, email: true, department: true, avatar: true }
      }),
      this.prisma.skill.findMany({
        where: { ...visibleCapabilityWhere,id: { in: topSkills.map((s) => s.skillId) } },
        select: { id: true, name: true, key: true, icon: true }
      }),
      this.prisma.agent.findMany({
        where: { ...visibleCapabilityWhere,id: { in: topAgents.map((a) => a.agentId!) } },
        select: { id: true, name: true, avatar: true }
      })
    ])

    const userMap = new Map(users.map((u) => [u.id, u]))
    const skillMap = new Map(skills.map((s) => [s.id, s]))
    const agentMap = new Map(agents.map((a) => [a.id, a]))

    return {
      users: topUsers.map((u) => ({
        user: userMap.get(u.userId) ?? { id: u.userId, name: "已删除用户" },
        requests: u._count._all,
        tokens: u._sum.totalTokens ?? 0
      })),
      models: topModels.map((m) => ({
        modelKey: m.modelKey,
        requests: m._count._all,
        tokens: m._sum.totalTokens ?? 0
      })),
      skills: topSkills.filter(s=>skillMap.has(s.skillId)).map((s) => ({
        skill: skillMap.get(s.skillId) ?? { id: s.skillId, name: "已删除技能" },
        runs: s._count._all
      })),
      agents: topAgents.filter(a=>agentMap.has(a.agentId!)).map((a) => ({
        agent: agentMap.get(a.agentId!) ?? { id: a.agentId, name: "未知智能体" },
        conversations: a._count._all
      }))
    }
  }

  /** 最近操作流水 */
  async recentActivity(limit = 15) {
    return this.prisma.auditLog.findMany({
      where:await visibleAuditWhere(this.prisma),
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { id: true, name: true, email: true, avatar: true } }
      }
    })
  }

  /** 个人首页：当前用户的概览 */
  async mine(userId: string) {
    const today = daysAgo(0)
    const [conversations, messages, usage, quota, skills, recentConversations] =
      await Promise.all([
        this.prisma.conversation.count({
          where: { userId, status: { not: "DELETED" } }
        }),
        this.prisma.message.count({ where: { userId } }),
        this.prisma.usageRecord.aggregate({
          where: { userId, createdAt: { gte: today } },
          _sum: { totalTokens: true, costUsd: true },
          _count: { _all: true }
        }),
        this.prisma.userQuota.findUnique({ where: { userId } }),
        this.prisma.skill.findMany({
          where: { ...visibleCapabilityWhere,enabled: true },
          take: 6,
          orderBy: { sort: "asc" },
          select: { id: true, key: true, name: true, description: true, icon: true, category: true }
        }),
        this.prisma.conversation.findMany({
          where: { userId,AND:[visibleConversationWhere], status: { not: "DELETED" } },
          take: 5,
          orderBy: { updatedAt: "desc" },
          select: { id: true, title: true, updatedAt: true, messageCount: true }
        })
      ])

    return {
      stats: {
        conversations,
        messages,
        requestsToday: usage._count._all,
        tokensToday: usage._sum.totalTokens ?? 0,
        costTodayUsd: Number((usage._sum.costUsd ?? 0).toFixed(4))
      },
      quota: quota ?? {
        enabled: true,
        dailyTokenLimit: 0,
        monthlyTokenLimit: 0,
        dailyRequestLimit: 0,
        rpmLimit: 0
      },
      featuredSkills: skills,
      recentConversations
    }
  }
}
