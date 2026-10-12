import { Injectable, Logger } from "@nestjs/common"
import { PrismaClient } from "@prisma/client"
import type { Response } from "express"
import { ChatService } from "../chat/chat.service"
import type { AuthUser } from "../common/decorators/current-user.decorator"
import { dailyQuotaStart, shanghaiDayStart } from '../common/services/quota-window'

const TRIAL_EMAIL = "trial@cagent.local"
/** 每 IP 每日体验轮数上限 */
export const TRIAL_MAX_ROUNDS_PER_DAY = 5

/** New trial conversations defer to the same server-owned presentation contract as both chats. */
const CARD_PROTOCOL = '遵循服务器统一的回答与卡片协议。校园资料属于知识库；界面按当前任务和证据选择。'

@Injectable()
export class TrialService {
  private readonly logger = new Logger(TrialService.name)
  /** 独立连接：免登录链路的用户/配额懒初始化与记录 */
  private readonly prisma = new PrismaClient()
  private trialUserId: string | null = null
  private deepseekModelId: string | null = null
  private guideAgentId: string | null = null

  constructor(private readonly chat: ChatService) {}

  /** Anonymous guide can read guide evidence, with no full-text or administrative access. */
  private async authUser(): Promise<AuthUser> {
    return {
      id: await this.ensureTrialUser(),
      email: TRIAL_EMAIL,
      name: "体验访客",
      status: "active",
      roles: [],
      permissions: ['campus:read']
    }
  }

  /** 懒创建体验账号 + 不限模型配额（IP 维度限流在本服务手里） */
  private async ensureTrialUser(): Promise<string> {
    if (this.trialUserId) return this.trialUserId
    let u = await this.prisma.user.findUnique({ where: { email: TRIAL_EMAIL } })
    if (!u) {
      u = await this.prisma.user
        .create({
          data: {
            email: TRIAL_EMAIL,
            name: "体验访客",
            passwordHash: "trial:no-login:" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2),
            status: "ACTIVE"
          }
        })
        .catch(() => null)
      u = u ?? (await this.prisma.user.findUnique({ where: { email: TRIAL_EMAIL } }))
    }
    if (!u) throw new Error("trial user init failed")
    this.trialUserId = u.id
    await this.prisma.userQuota.upsert({
      where: { userId: u.id },
      create: { userId: u.id, enabled: true },
      update: { dailyTokenLimit: 0, monthlyTokenLimit: 0, dailyRequestLimit: 0, rpmLimit: 0 }
    })
    return u.id
  }

  private async deepseekId(): Promise<string> {
    if (!this.deepseekModelId) {
      const m = await this.prisma.model.findFirst({
        where: { key: "deepseek-chat", enabled: true },
        select: { id: true }
      })
      if (!m) throw new Error("deepseek-chat 模型不可用")
      this.deepseekModelId = m.id
    }
    return this.deepseekModelId
  }

  private async guideId(): Promise<string | undefined> {
    if (!this.guideAgentId) {
      const a = await this.prisma.agent.findFirst({
        where: { key: "ucass-guide", enabled: true },
        select: { id: true }
      })
      this.guideAgentId = a?.id ?? ""
    }
    return this.guideAgentId || undefined
  }

  private dayStart(): Date {
    return shanghaiDayStart()
  }

  async quota(ip: string) {
    const start = await dailyQuotaStart(this.prisma)
    const used = await this.prisma.trialRound.count({
      where: { ip, createdAt: { gte: start } }
    })
    return { used, max: TRIAL_MAX_ROUNDS_PER_DAY, left: Math.max(0, TRIAL_MAX_ROUNDS_PER_DAY - used) }
  }

  /**
   * 体验对话。要点：
   *  1. 先落 TrialRound 再出流（失败的尝试也计数，防滥用）；
   *  2. streamChat 只接触一个干净的最小 res 假对象（setHeader/write/end），
   *     write 转发到真响应保持实时流式并收集回答 —— 绝不让 streamChat 直接
   *     操作真 Response（其内部状态会被代理搞崩，Node 直接 ERR_INTERNAL_ASSERTION）；
   *  3. 剩余轮数事件放在流最前面（本轮已预落库，额度是确定值）。
   */
  async chatRound(ip: string, content: string, conversationId: string | undefined, res: Response,preferences:{outputPreference?:'cards'|'adaptive'|'text';bypassCache?:boolean;revisionMessageId?:string}={}) {
    const q = await this.quota(ip)
    if (!content.trim()) {
      res.status(400).json({ code: 400, message: "内容不能为空" })
      return
    }
    if (q.left <= 0) {
      res.status(429).json({
        code: 429,
        message: `今日体验次数已用完（${TRIAL_MAX_ROUNDS_PER_DAY} 轮/天），欢迎明天再来。`
      })
      return
    }

    const userId = await this.ensureTrialUser()
    let convId = conversationId
    if (convId) {
      // 会话有效性：归属体验账号 + 本 IP 用它跑过至少一轮。
      // 不能校验标题前缀 —— streamChat 首轮后会把标题自动改成首问文本。
      const conv = await this.prisma.conversation.findUnique({
        where: { id: convId },
        select: { userId: true }
      })
      const known = await this.prisma.trialRound.findFirst({
        where: { conversationId: convId, ip },
        select: { id: true }
      })
      if (!conv || conv.userId !== userId || !known) {
        res.status(400).json({ code: 400, message: "会话无效，请刷新页面重试" })
        return
      }
    } else {
      const conv = await this.prisma.conversation.create({
        data: {
          userId,
          title: "[trial] " + new Date().toISOString().slice(0, 16),
          modelId: await this.deepseekId(),
          agentId: await this.guideId(),
          systemPrompt: CARD_PROTOCOL
        },
        select: { id: true }
      })
      convId = conv.id
    }

    if(preferences.revisionMessageId){
      const original=await this.prisma.message.findFirst({where:{id:preferences.revisionMessageId,conversationId:convId,userId,role:'assistant'}})
      const question=original&&await this.prisma.message.findFirst({where:{conversationId:convId,role:'user',seq:{lt:original.seq}},orderBy:{seq:'desc'}})
      if(!question||question.content!==content){res.status(400).json({code:400,message:'原回答无效，请重新提问'});return}
      preferences.bypassCache=true
    }
    // 先记录本轮（answer 先空着，流结束后回填）
    const round = await this.prisma.trialRound.create({
      data: {
        ip,
        conversationId: convId,
        question: content.slice(0, 4000),
        answer: "",
        modelKey: "deepseek-chat"
      },
      select: { id: true }
    })

    const chunks: string[] = []
    const afterQuota = { used: q.used + 1, max: q.max, left: Math.max(0, q.left - 1), roundId: round.id }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8")
    res.setHeader("Cache-Control", "no-cache, no-transform")
    res.setHeader("Connection", "keep-alive")
    res.setHeader("X-Accel-Buffering", "no")
    res.flushHeaders?.()
    res.write(`event: trial\ndata: ${JSON.stringify(afterQuota)}\n\n`)

    const fakeRes: any = {
      headersSent: true,
      writableEnded: false,
      setHeader: () => {},
      flushHeaders: () => {},
      get destroyed(){return res.destroyed},
      on: (event:string,listener:any) => {res.on(event,listener);return fakeRes},
      once: (event:string,listener:any) => {res.once(event,listener);return fakeRes},
      off: (event:string,listener:any) => {res.off(event,listener);return fakeRes},
      removeListener: (event:string,listener:any) => {res.removeListener(event,listener);return fakeRes},
      write: (chunk: any) => {
        try {
          if (typeof chunk === "string") chunks.push(chunk)
        } catch {
          /* 收集失败不影响转发 */
        }
        if(!res.destroyed&&!res.writableEnded)res.write(chunk)
        return true
      },
      end: () => {
        fakeRes.writableEnded = true
      },
      status: () => fakeRes,
      json: () => fakeRes
    }

    const t0 = Date.now()
    try {
      await this.chat.streamChat(await this.authUser(), {
        conversationId: convId,
        content,
        modelId: await this.deepseekId(),
        agentId: (await this.guideId()) || undefined,
        origin: "trial-chat",
        enableTools: false,
        memoryEnabled: false
        ,...preferences
      } as any, fakeRes,preferences.revisionMessageId)
    } catch (e) {
      this.logger.warn(`trial chat failed: ${String((e as Error)?.message || e).slice(0, 200)}`)
    }

    // 整段 SSE 拼起来再解析，避免事件跨 write 边界被切碎
    let answer = ""
    const buffer = chunks.join("")
    for (const line of buffer.split("\n")) {
      if (!line.startsWith("data:")) continue
      try {
        const p = JSON.parse(line.slice(5).trim())
        if (p && typeof p.text === "string") answer += p.text
      } catch {
        /* 非 JSON 行（多行 data 或心跳）忽略 */
      }
    }
    await this.prisma.trialRound.update({
      where: { id: round.id },
      data: { answer: answer.slice(0, 20000), latencyMs: Date.now() - t0 }
    })
    res.end()
  }

  async survey(
    ip: string,
    body: { roundId?: string; overall?: number; problems?: string[]; wants?: string[]; advice?: string }
  ) {
    const overall = Math.round(Number(body?.overall))
    if (!(overall >= 1 && overall <= 5)) {
      return { saved: false, message: "请先选择总体满意度" }
    }
    const roundId = typeof body?.roundId === "string" && body.roundId.length < 64 ? body.roundId : null
    const clean = (arr: unknown, max: number, len: number) =>
      Array.isArray(arr)
        ? arr.filter((x) => typeof x === "string" && x.trim()).map((x) => String(x).slice(0, len)).slice(0, max)
        : []
    const s = await this.prisma.trialSurvey.create({
      data: {
        ip,
        roundId,
        overall,
        problems: clean(body?.problems, 10, 40),
        wants: clean(body?.wants, 10, 40),
        advice: String(body?.advice || "").slice(0, 1000) || null
      }
    })
    return { saved: true, id: s.id }
  }

  async stats() {
    const dayStart = this.dayStart()
    const [totalRounds, todayRounds, ipGroups, totalSurveys, surveys, recentRounds] = await Promise.all([
      this.prisma.trialRound.count(),
      this.prisma.trialRound.count({ where: { createdAt: { gte: dayStart } } }),
      this.prisma.trialRound.groupBy({ by: ["ip"] }),
      this.prisma.trialSurvey.count(),
      this.prisma.trialSurvey.findMany({ orderBy: { createdAt: "desc" }, take: 500 }),
      this.prisma.trialRound.findMany({
        where: { createdAt: { gte: new Date(dayStart.getTime() - 6 * 86400000) } },
        select: { createdAt: true }
      })
    ])
    const overallDist = [5, 4, 3, 2, 1].map((v) => ({
      value: v,
      count: surveys.filter((s) => s.overall === v).length
    }))
    const avg = surveys.length ? surveys.reduce((a, s) => a + s.overall, 0) / surveys.length : 0
    const tally = (field: "problems" | "wants") => {
      const m = new Map<string, number>()
      for (const s of surveys) {
        const arr = s[field] as any
        if (!Array.isArray(arr)) continue
        for (const t of arr) m.set(t, (m.get(t) || 0) + 1)
      }
      return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
    }
    const days: { date: string; rounds: number; surveys: number }[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(dayStart)
      d.setDate(d.getDate() - i)
      const next = new Date(d)
      next.setDate(next.getDate() + 1)
      days.push({
        date: d.toISOString().slice(0, 10),
        rounds: recentRounds.filter((r) => r.createdAt >= d && r.createdAt < next).length,
        surveys: surveys.filter((s) => s.createdAt >= d && s.createdAt < next).length
      })
    }
    return {
      totalRounds,
      todayRounds,
      uniqueIps: ipGroups.length,
      totalSurveys,
      avgOverall: Math.round(avg * 100) / 100,
      overallDist,
      problems: tally("problems"),
      wants: tally("wants"),
      days
    }
  }

  async recentRounds(take: number) {
    return this.prisma.trialRound.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(take, 1), 100),
      select: { id: true, ip: true, question: true, answer: true, latencyMs: true, createdAt: true }
    })
  }

  /**
   * 最近问卷，附上 conversationId —— 后台从一条问卷能跳到整段会话。
   */
  async recentSurveys(take: number) {
    const surveys = await this.prisma.trialSurvey.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(take, 1), 100)
    })
    const roundIds = [...new Set(surveys.map((s) => s.roundId).filter((v): v is string => !!v))]
    const rounds = roundIds.length
      ? await this.prisma.trialRound.findMany({
          where: { id: { in: roundIds } },
          select: { id: true, conversationId: true }
        })
      : []
    const convByRound = new Map(rounds.map((r) => [r.id, r.conversationId]))
    return surveys.map((s) => ({
      ...s,
      conversationId: s.roundId ? convByRound.get(s.roundId) ?? null : null
    }))
  }

  /** 会话追溯：按 conversationId 取整段体验问答（时间升序） */
  async session(conversationId: string) {
    const rounds = await this.prisma.trialRound.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      select: { id: true, ip: true, question: true, answer: true, latencyMs: true, createdAt: true }
    })
    if (!rounds.length) return null
    return { conversationId, rounds }
  }
}
