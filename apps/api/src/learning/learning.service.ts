import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException
} from "@nestjs/common"
import { LearningKind, LearningStatus, Prisma } from "@prisma/client"
import {visibleCapabilityWhere} from '../common/retired-capabilities'
import { PrismaService } from "../prisma/prisma.service"
import { AuditService } from "../common/services/audit.service"
import { KnowledgeStoreService } from '../knowledge/knowledge-store.service'
import { normalize, terms } from '../campus/knowledge-retriever'
import { createHash } from 'node:crypto'
import { estimateTokens } from '../chat/llm/types'

export interface SubmitFeedbackInput {
  messageId: string
  positive: boolean
  reason?: string
  correction?: string
}

/** 提炼出来但还没落库的候选经验 */
interface LearningCandidate {
  kind: LearningKind
  instruction: string
  sampleQuestion: string | null
  evidence: Record<string, unknown>
}

/** 点踩原因 → 经验模板。把用户的选择翻译成模型能听懂的指令。 */
const REASON_RULES: Record<string, { kind: LearningKind; instruction: string }> = {
  不准确: {
    kind: LearningKind.CORRECTION,
    instruction:
      "回答事实性问题（部门、电话、时间、金额、流程）时，必须先调用检索类工具核对，不要凭记忆作答；查不到就直说查不到。"
  },
  信息过时: {
    kind: LearningKind.PREFERENCE,
    instruction:
      "涉及政策、时间、金额时，必须注明数据的核实时间，并提醒用户以官方最新通知为准。"
  },
  太啰嗦: {
    kind: LearningKind.PREFERENCE,
    instruction: "回答尽量简短：先给结论，再给必要的步骤，不要复述用户的问题，不要客套开场白。"
  },
  没答到点上: {
    kind: LearningKind.PREFERENCE,
    instruction:
      "先确认用户真正要解决的问题，再作答；如果问题有歧义，先用一句话澄清，不要泛泛而谈。"
  },
  格式混乱: {
    kind: LearningKind.PREFERENCE,
    instruction: "输出用 Markdown 组织：要点用列表，步骤按顺序编号，关键参数单独成行，避免整段文字。"
  },
  答非所问: {
    kind: LearningKind.PREFERENCE,
    instruction: "严格回答用户问的那件事，不要扩展到相邻话题；用户没问的背景信息不要主动展开。"
  }
}

/** 点踩原因的可选值，前端下拉直接用 */
export const FEEDBACK_REASONS = Object.keys(REASON_RULES)

/**
 * 自学习反馈服务。
 *
 * 设计取舍：**不自动改提示词**。用户反馈只负责「提炼候选经验」，
 * 是否采纳由管理员在后台审核。理由是一条被污染的自动经验会污染之后
 * 所有学生的回答，而人工审核成本很低（一次点击）。
 */
@Injectable()
export class LearningService {
  private readonly logger = new Logger(LearningService.name)

  constructor(
    private store:KnowledgeStoreService,
    private prisma: PrismaService,
    private audit: AuditService
  ) {}

  // ---------- 用户侧：提交反馈 ----------

  async submit(
    userId: string,
    input: SubmitFeedbackInput
  ): Promise<{ feedbackId: string; createdLearning: number }> {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`feedback:${userId}:${input.messageId}`}))::text`
      const message = await tx.message.findUnique({
        where: { id: input.messageId },
        include: { conversation: { select: { agentId: true, userId: true } } }
      })
      if (!message) throw new NotFoundException("消息不存在")

      // 只能评价自己会话里的助手回复
      if (message.conversation.userId !== userId) {
        throw new NotFoundException("消息不存在")
      }
      if (message.role !== "assistant") {
        throw new BadRequestException("只能对助手的回复作出评价")
      }

      const agentId = message.conversation.agentId || (await tx.agent.findFirst({where:{key:'ucass-guide',enabled:true},select:{id:true}}))?.id || null
      if (agentId) await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`learning-agent:${agentId}`}))::text`
      const correction = input.correction?.trim() || null
      const previous = await tx.messageFeedback.findUnique({where:{messageId_userId:{messageId:input.messageId,userId}}})
      if (previous && previous.positive===input.positive && previous.reason===(input.reason?.trim() || null) && previous.correction===correction) return {feedbackId:previous.id,createdLearning:0}
      if (previous) await this.detach(previous.id,tx)

      const feedback = await tx.messageFeedback.upsert({
        where: { messageId_userId: { messageId: input.messageId, userId } },
        create: {
          messageId: input.messageId,
          userId,
          agentId,
          positive: input.positive,
          reason: input.reason?.trim() || null,
          correction,
          source: "EXPLICIT"
        },
        update: {
          positive: input.positive,
          reason: input.reason?.trim() || null,
          correction,
          agentId,
          resolution:'OPEN',resolutionNote:null,resolvedById:null
        }
      })

      // 采纳为「经验」的前提：必须挂到某个智能体上
      if (!agentId) {
        return { feedbackId: feedback.id, createdLearning: 0 }
      }

      const question = await this.findQuestion(message.conversationId, message.seq,tx)
      const candidates = this.deriveCandidates(input, question, message.content)
      let created = 0
      for (const c of candidates) {
        if (await this.upsertLearning(agentId, c,feedback.id,userId,tx)) created++
      }

      return { feedbackId: feedback.id, createdLearning: created }
    },{timeout:30000})
  }

  /** 撤销评价（用户改主意） */
  async revoke(userId: string, messageId: string) {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`feedback:${userId}:${messageId}`}))::text`
      const feedback = await tx.messageFeedback.findUnique({where:{messageId_userId:{messageId,userId}}})
      if (feedback?.agentId) await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`learning-agent:${feedback.agentId}`}))::text`
      if (feedback) await this.detach(feedback.id,tx)
      await tx.messageFeedback.deleteMany({ where: { messageId, userId } })
      return { success: true }
    },{timeout:30000})
  }

  private async detach(feedbackId:string,db:Prisma.TransactionClient=this.prisma) {
    const links = await db.learningFeedbackLink.findMany({where:{feedbackId}})
    await db.learningFeedbackLink.deleteMany({where:{feedbackId}})
    for (const link of links) await this.recount(link.learningId,db)
  }
  private async recount(learningId:string,db:Prisma.TransactionClient=this.prisma) {
    const users = await db.learningFeedbackLink.findMany({where:{learningId},distinct:['userId'],select:{userId:true}})
    await db.agentLearning.update({where:{id:learningId},data:{supportCount:users.length}})
  }

  /** 某条消息当前用户的评价，用于回显 */
  async forMessage(userId: string, messageId: string) {
    return this.prisma.messageFeedback.findUnique({
      where: { messageId_userId: { messageId, userId } }
    })
  }

  /** 取该助手回复对应的用户提问 */
  private async findQuestion(
    conversationId: string,
    assistantSeq: number,
    db:Prisma.TransactionClient=this.prisma
  ): Promise<string | null> {
    const prev = await db.message.findFirst({
      where: {
        conversationId,
        role: "user",
        seq: { lt: assistantSeq }
      },
      orderBy: { seq: "desc" },
      select: { content: true }
    })
    return prev?.content?.slice(0, 1000) ?? null
  }

  /**
   * 把一次反馈翻译成候选经验。
   *
   * 只在「点踩」时提炼——点赞说明当前行为已经正确，无需新增指令；
   * 而且从点赞里推不出具体该做什么，硬提炼只会产生空话。
   */
  private deriveCandidates(
    input: SubmitFeedbackInput,
    question: string | null,
    answer: string
  ): LearningCandidate[] {
    if (input.positive) return []

    const out: LearningCandidate[] = []

    // 1) 用户写了正确答案 —— 最高质量的学习信号
    const correction = input.correction?.trim()
    if (correction) {
      out.push({
        kind: LearningKind.CORRECTION,
        instruction: this.correctionToInstruction(question, correction, answer),
        sampleQuestion: question,
        evidence: {
          correction,
          wrongAnswer: answer.slice(0, 600),
          reason: input.reason ?? null
        }
      })
    }

    // 2) 用户选了原因 —— 映射成通用行为指令
    const rule = input.reason ? REASON_RULES[input.reason.trim()] : undefined
    if (rule) {
      out.push({
        kind: rule.kind,
        instruction: rule.instruction,
        sampleQuestion: question,
        evidence: { reason: input.reason, answer: answer.slice(0, 400) }
      })
    }

    // 3) 既没写纠正也没选原因：只留一条「待人工看看」的线索
    if (out.length === 0) {
      out.push({
        kind: LearningKind.PREFERENCE,
        instruction: "",
        sampleQuestion: question,
        evidence: { answer: answer.slice(0, 400), note: "用户点踩但未说明原因" }
      })
    }

    return out
  }

  /**
   * 把「用户给的正确答案」整理成一条可执行指令。
   *
   * 注意不能直接把用户原话当指令注入提示词——用户是在回答问题，
   * 不是在下指令（"网络中心，电话 010-xxx" 这种句子模型会当成待复述内容）。
   * 所以统一包一层「当被问到 X 时，应当回答 Y」的句式。
   */
  private correctionToInstruction(
    question: string | null,
    correction: string,
    _answer: string
  ): string {
    const q = question?.replace(/\s+/g, " ").slice(0, 80).trim()
    const c = correction.replace(/\s+/g, " ").slice(0, 600).trim()

    if (q) {
      return `当学生问「${q}」这类问题时，应以如下信息为准：${c}`
    }
    return `回答同类问题时，应以如下信息为准：${c}`
  }

  /**
   * 落库一条候选经验。
   *
   * 去重策略：同一智能体下，指令文本相同就只累加 support_count —— 越多用户
   * 踩同一个坑，这条经验越该被采纳，后台可以按 supportCount 排序优先审核。
   */
  private async upsertLearning(
    agentId: string,
    candidate: LearningCandidate,
    feedbackId:string,
    userId:string,
    db:Prisma.TransactionClient=this.prisma
  ): Promise<boolean> {
    const instruction = candidate.instruction.trim()
    const candidateKey = createHash('sha256').update(normalize(instruction) + (candidate.kind==='PREFERENCE' && instruction ? '' : normalize(candidate.sampleQuestion))).digest('hex')
    const learning = await db.agentLearning.upsert({where:{agentId_candidateKey:{agentId,candidateKey}},
      create:{agentId,candidateKey,kind:candidate.kind,status:'PENDING',instruction,sampleQuestion:candidate.sampleQuestion,evidence:candidate.evidence as any,supportCount:0},
      update:{}})
    await db.learningFeedbackLink.upsert({where:{learningId_feedbackId:{learningId:learning.id,feedbackId}},
      create:{learningId:learning.id,feedbackId,userId},update:{}})
    await this.recount(learning.id,db)
    return learning.createdAt.getTime() === learning.updatedAt.getTime() && learning.supportCount===0
  }

  // ---------- 管理侧：审核 ----------

  async list(
    query: { agentId?: string; status?: string; page?: number; pageSize?: number } = {}
  ) {
    const page = Math.max(Number(query.page) || 1, 1)
    const pageSize = Math.min(Math.max(Number(query.pageSize) || 20, 1), 100)

    const where: Prisma.AgentLearningWhereInput = {agent:{is:visibleCapabilityWhere}}
    if (query.agentId) where.agentId = query.agentId
    if (query.status && query.status !== "ALL") {
      where.status = query.status as LearningStatus
    }

    const [items, total] = await Promise.all([
      this.prisma.agentLearning.findMany({
        where,
        // 支撑人数多的排前面：被踩得最多的最该先处理
        orderBy: [{ supportCount: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          agent: { select: { id: true, key: true, name: true, avatar: true } },
          reviewedBy: { select: { id: true, name: true, email: true } }
        }
      }),
      this.prisma.agentLearning.count({ where })
    ])

    return { items, total, page, pageSize }
  }

  /** 概览：各状态数量、最近反馈趋势、被踩最多的智能体 */
  async overview(days = 7) {
    const since = new Date(Date.now() - days * 86400_000)

    const [pending, approved, rejected, feedbackTotal, negative, positive] =
      await Promise.all([
        this.prisma.agentLearning.count({ where: { status: "PENDING" } }),
        this.prisma.agentLearning.count({ where: { status: "APPROVED" } }),
        this.prisma.agentLearning.count({ where: { status: "REJECTED" } }),
        this.prisma.messageFeedback.count({ where: { createdAt: { gte: since } } }),
        this.prisma.messageFeedback.count({
          where: { createdAt: { gte: since }, positive: false }
        }),
        this.prisma.messageFeedback.count({
          where: { createdAt: { gte: since }, positive: true }
        })
      ])

    // 按天聚合，前端画趋势线
    const rows = await this.prisma.$queryRaw<
      { date: Date; positive: bigint; negative: bigint }[]
    >`
      SELECT date_trunc('day', created_at) AS date,
             COUNT(*) FILTER (WHERE positive) AS positive,
             COUNT(*) FILTER (WHERE NOT positive) AS negative
      FROM message_feedback
      WHERE created_at >= ${since}
      GROUP BY 1
      ORDER BY 1
    `

    const byDay = rows.map((r) => ({
      date: r.date.toISOString().slice(0, 10),
      positive: Number(r.positive),
      negative: Number(r.negative)
    }))

    const topAgents = await this.prisma.messageFeedback.groupBy({
      by: ["agentId"],
      where: { createdAt: { gte: since }, positive: false, agentId: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { agentId: "desc" } },
      take: 5
    })

    const agentIds = topAgents.map((a) => a.agentId!).filter(Boolean)
    const agents = agentIds.length
      ? await this.prisma.agent.findMany({
          where: { ...visibleCapabilityWhere,id: { in: agentIds } },
          select: { id: true, name: true, avatar: true }
        })
      : []
    const agentMap = new Map(agents.map((a) => [a.id, a]))

    return {
      pending,
      approved,
      rejected,
      feedbackTotal,
      negative,
      positive,
      negativeRate: feedbackTotal > 0 ? Number(((negative / feedbackTotal) * 100).toFixed(1)) : 0,
      byDay,
      topAgents: topAgents.filter(a=>agentMap.has(a.agentId!)).map((a) => ({
        agentId: a.agentId,
        name: agentMap.get(a.agentId!)?.name ?? "（已删除）",
        avatar: agentMap.get(a.agentId!)?.avatar ?? null,
        negative: a._count._all
      }))
    }
  }

  /** 审核：通过 / 否决 */
  async review(
    id: string,
    status: "APPROVED" | "REJECTED" | "PENDING",
    operator: { id: string; email: string },
    patch?: { instruction?: string; kind?: LearningKind; pinAnswer?:boolean;fixedAnswer?:string }
  ) {
    const learning = await this.prisma.agentLearning.findFirst({ where: { id,agent:{is:visibleCapabilityWhere} } })
    if (!learning) throw new NotFoundException("学习条目不存在")

    const instruction = patch?.instruction?.trim() ?? learning.instruction
    if (status === "APPROVED" && !instruction) {
      throw new BadRequestException("审核通过前请先填写具体的经验内容")
    }
    let fixedEntryId = learning.fixedEntryId
    if (status==='APPROVED' && patch?.pinAnswer) {
      const answer = patch.fixedAnswer?.trim() || (learning.evidence as any)?.correction
      if (!learning.sampleQuestion || !answer) throw new BadRequestException('固定纠错需要完整问题和正确答案')
      const entry = await this.store.pinCorrection({question:learning.sampleQuestion,answer,agentId:learning.agentId,source:`学习审核:${learning.id}`},operator)
      fixedEntryId = entry.id
    } else if (status !== 'APPROVED' && fixedEntryId) {
      await this.store.archive(fixedEntryId,operator,`学习审核:${learning.id}`)
    }

    const updated = await this.prisma.agentLearning.update({
      where: { id },
      data: {
        status,
        fixedEntryId,
        instruction,
        kind: patch?.kind ?? learning.kind,
        reviewedById: operator.id,
        reviewedAt: new Date()
      }
    })

    await this.audit.log({
      userId: operator.id,
      actor: operator.email,
      action: status === "APPROVED" ? "learning.approve" : "learning.reject",
      resource: "agent_learning",
      resourceId: id,
      detail: { agentId: learning.agentId, instruction: instruction.slice(0, 200) }
    })

    return updated
  }

  async remove(id: string, operator: { id: string; email: string }) {
    const learning = await this.prisma.agentLearning.findFirst({ where: { id,agent:{is:visibleCapabilityWhere} } })
    if (!learning) throw new NotFoundException("学习条目不存在")

    if (learning.fixedEntryId) await this.store.archive(learning.fixedEntryId,operator,`学习审核:${learning.id}`)
    await this.prisma.agentLearning.delete({ where: { id } })
    await this.audit.log({
      userId: operator.id,
      actor: operator.email,
      action: "learning.delete",
      resource: "agent_learning",
      resourceId: id,
      detail: { agentId: learning.agentId }
    })
    return { success: true }
  }

  /**
   * 取出该智能体已审核通过的经验，拼成提示词片段。
   *
   * 只取 APPROVED；同时累加 injectedCount，之后可以用
   * 「注入次数 vs 之后是否还被踩」来评估这条经验到底有没有用。
   */
  async buildLearningPrompt(agentId: string,query = ''): Promise<string | null> {
    const approved = await this.prisma.agentLearning.findMany({
      where: { agentId, status: "APPROVED", instruction: { not: "" } },
      orderBy: [{ supportCount: "desc" }, { updatedAt: "desc" }],
      take: 100,
      select: { id: true, instruction: true,kind:true,sampleQuestion:true }
    })
    const qt = terms(query)
    const selected:typeof approved = []; let cost = 0
    for (const a of approved) {
      const related = a.kind==='PREFERENCE' || (a.sampleQuestion && (normalize(a.sampleQuestion)===normalize(query) || terms(a.sampleQuestion).filter(t => qt.includes(t)).length>=2))
      const n = estimateTokens(a.instruction)
      if (related && cost+n<=500 && selected.length<6) {selected.push(a);cost+=n}
    }
    if (selected.length === 0) return null

    // 注入计数是统计用途，失败不该影响对话
    this.prisma.agentLearning
      .updateMany({
        where: { id: { in: selected.map((a) => a.id) } },
        data: { injectedCount: { increment: 1 } }
      })
      .catch((err) => this.logger.warn(`注入计数失败：${(err as Error).message}`))

    const lines = selected.map((a, i) => `${i + 1}. ${a.instruction}`)
    return [
      "【从真实用户反馈中沉淀的经验】",
      "以下要求来自实际使用中暴露的问题，优先级高于你的默认习惯：",
      ...lines
    ].join("\n")
  }
}
