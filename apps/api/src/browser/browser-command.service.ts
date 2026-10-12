import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException
} from "@nestjs/common"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { ConfigService } from "@nestjs/config"
import { PrismaService } from "../prisma/prisma.service"

/** 本地浏览器可执行的动作（与前端 localtools 的执行器一一对应） */
export type LocalAction =
  | "goto"
  | "click"
  | "type"
  | "press"
  | "select"
  | "waitFor"
  | "wait"
  | "extract"
  | "evaluate"
  | "scroll"
  | "screenshot"
  | "highlight"

export interface EnqueueCommandInput {
  sessionId: string
  action: string
  selector?: string
  value?: string
  timeout?: number
}

export interface ReportCommandInput {
  commandId: string
  ok: boolean
  /** 结构化结果：文本、匹配数、元素信息等 */
  result?: unknown
  /** 截图：dataURL 或裸 base64 */
  screenshot?: string
  url?: string
  title?: string
  error?: string
  durationMs?: number
}

/** 指令超时：本地客户端迟迟不领取/不回填时，判定为过期，避免前端一直转圈 */
const COMMAND_TTL_MS = 60_000

/**
 * 浏览器指令队列。
 *
 * 服务器不装 Chromium（内存不够），网页渲染与操控全部下沉到用户本地浏览器：
 *   Web 端  —— localtools 直接调 DOM API（同源页面可用）
 *   扩展    —— chrome.debugger / scripting 可操控任意标签页
 *
 * 服务端职责收敛为三件事：
 *   1. 下发指令（enqueue）
 *   2. 接收结果与截图并落盘留痕（report）
 *   3. 维护「本地浏览器是否在线」的心跳
 */
@Injectable()
export class BrowserCommandService {
  private readonly logger = new Logger(BrowserCommandService.name)
  private readonly artifactDir: string

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService
  ) {
    this.artifactDir =
      this.config.get<string>("BROWSER_ARTIFACT_DIR") ||
      join(process.cwd(), "storage", "browser")
    if (!existsSync(this.artifactDir)) {
      mkdirSync(this.artifactDir, { recursive: true })
    }
  }

  // ---------- 会话 ----------

  /** 创建会话：默认 LOCAL 执行器（服务器不跑浏览器） */
  async createSession(params: {
    userId: string
    name?: string
    startUrl?: string
    clientKind?: string
    executor?: "SERVER" | "LOCAL"
  }) {
    const executor = params.executor ?? "LOCAL"
    const session = await this.prisma.browserSession.create({
      data: {
        userId: params.userId,
        name: params.name || "本地浏览器会话",
        startUrl: params.startUrl ?? null,
        executor,
        clientKind: params.clientKind ?? null,
        // 本地执行时 headless 概念不适用，统一记 false 以免误导后台
        headless: false,
        status: "ACTIVE",
        lastSeenAt: new Date()
      }
    })
    return this.detail(session.id)
  }

  async detail(sessionId: string) {
    const session = await this.prisma.browserSession.findUnique({
      where: { id: sessionId },
      include: {
        steps: { orderBy: { seq: "asc" } },
        commands: { orderBy: { seq: "asc" }, take: 200 }
      }
    })
    if (!session) throw new NotFoundException("浏览器会话不存在")

    const { commands, ...rest } = session
    return {
      ...rest,
      steps: rest.steps,
      commands: commands.map((c) => ({
        id: c.id,
        seq: c.seq,
        action: c.action,
        selector: c.selector,
        value: c.value,
        status: c.status,
        error: c.error,
        url: c.url,
        title: c.title,
        durationMs: c.durationMs,
        screenshotPath: c.screenshotPath,
        createdAt: c.createdAt
      })),
      // 本地客户端是否在线（30 秒内有心跳）
      clientOnline: this.isOnline(session.lastSeenAt)
    }
  }

  async listSessions(params: { userId?: string; page?: number; pageSize?: number }) {
    const page = Math.max(Number(params.page) || 1, 1)
    const pageSize = Math.min(Math.max(Number(params.pageSize) || 20, 1), 100)

    const where = params.userId ? { userId: params.userId } : {}
    const [items, total] = await Promise.all([
      this.prisma.browserSession.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { _count: { select: { steps: true } } }
      }),
      this.prisma.browserSession.count({ where })
    ])

    return { items, total, page, pageSize }
  }

  async closeSession(sessionId: string, reason: "CLOSED" | "CRASHED" = "CLOSED") {
    await this.prisma.browserSession.updateMany({
      where: { id: sessionId },
      data: { status: reason, closedAt: new Date() }
    })
    // 未完成的指令一并作废，避免本地客户端继续执行已关闭会话的动作
    await this.prisma.browserCommand.updateMany({
      where: { sessionId, status: { in: ["PENDING", "RUNNING"] } },
      data: { status: "FAILED", error: "会话已关闭", finishedAt: new Date() }
    })
    return { success: true }
  }

  /** 本地客户端心跳 */
  async heartbeat(sessionId: string, clientKind?: string) {
    const res = await this.prisma.browserSession.updateMany({
      where: { id: sessionId, status: "ACTIVE" },
      data: { lastSeenAt: new Date(), ...(clientKind ? { clientKind } : {}) }
    })
    if (res.count === 0) {
      throw new NotFoundException("会话不存在或已关闭")
    }
    return { success: true, serverTime: new Date().toISOString() }
  }

  private isOnline(lastSeenAt: Date | null): boolean {
    if (!lastSeenAt) return false
    return Date.now() - lastSeenAt.getTime() < 30_000
  }

  // ---------- 指令 ----------

  /**
   * 下发一条指令。返回记录，本地客户端通过 claim 领取。
   */
  async enqueue(input: EnqueueCommandInput) {
    const session = await this.prisma.browserSession.findUnique({
      where: { id: input.sessionId },
      select: { id: true, status: true, executor: true }
    })
    if (!session) throw new NotFoundException("浏览器会话不存在")
    if (session.status !== "ACTIVE") {
      throw new BadRequestException("会话已关闭，请重新创建")
    }
    if (session.executor !== "LOCAL") {
      throw new BadRequestException(
        "该会话未启用本地执行。服务器不安装浏览器，请在新建会话时选择本地执行。"
      )
    }

    const last = await this.prisma.browserCommand.aggregate({
      where: { sessionId: input.sessionId },
      _max: { seq: true }
    })

    const command = await this.prisma.browserCommand.create({
      data: {
        sessionId: input.sessionId,
        seq: (last._max.seq ?? 0) + 1,
        action: input.action,
        selector: input.selector ?? null,
        value: input.value ?? null,
        timeout: input.timeout ?? 15_000,
        status: "PENDING"
      }
    })

    return {
      id: command.id,
      seq: command.seq,
      action: command.action,
      selector: command.selector,
      value: command.value,
      timeout: command.timeout,
      status: command.status
    }
  }

  /**
   * 本地客户端领取待执行指令。
   *
   * 同一会话串行执行：只有当前没有 RUNNING 指令时才发下一条，
   * 避免「点击」和「输入」并发导致页面状态错乱。
   */
  async claim(sessionId: string, clientKind?: string) {
    const session = await this.prisma.browserSession.findUnique({
      where: { id: sessionId },
      select: { id: true, status: true }
    })
    if (!session) throw new NotFoundException("浏览器会话不存在")

    // 心跳与领取合并，减少一次往返
    await this.heartbeat(sessionId, clientKind).catch(() => undefined)

    if (session.status !== "ACTIVE") {
      return { command: null, sessionClosed: true }
    }

    // 过期清理：本地客户端掉线时，卡在 RUNNING 的指令会阻塞后续动作
    const staleBefore = new Date(Date.now() - COMMAND_TTL_MS)
    await this.prisma.browserCommand.updateMany({
      where: {
        sessionId,
        status: { in: ["PENDING", "RUNNING"] },
        createdAt: { lt: staleBefore }
      },
      data: { status: "FAILED", error: "执行超时（本地浏览器无响应）", finishedAt: new Date() }
    })

    const running = await this.prisma.browserCommand.findFirst({
      where: { sessionId, status: "RUNNING" }
    })
    if (running) return { command: null }

    const next = await this.prisma.browserCommand.findFirst({
      where: { sessionId, status: "PENDING" },
      orderBy: { seq: "asc" }
    })
    if (!next) return { command: null }

    // 「认领」用条件更新，避免多标签页同时领取同一条
    const claimed = await this.prisma.browserCommand.updateMany({
      where: { id: next.id, status: "PENDING" },
      data: { status: "RUNNING", claimedAt: new Date() }
    })
    if (claimed.count === 0) return { command: null }

    return {
      command: {
        id: next.id,
        seq: next.seq,
        action: next.action,
        selector: next.selector,
        value: next.value,
        timeout: next.timeout
      }
    }
  }

  /** 本地客户端回填执行结果 */
  async report(input: ReportCommandInput) {
    const command = await this.prisma.browserCommand.findUnique({
      where: { id: input.commandId },
      include: { session: { select: { id: true, currentUrl: true } } }
    })
    if (!command) throw new NotFoundException("指令不存在")

    // 截图落盘，避免把 base64 长期存在数据库里（体积大且难以直接展示）
    let screenshotPath: string | null = null
    if (input.screenshot) {
      screenshotPath = await this.saveScreenshot(command.sessionId, command.seq, input.screenshot)
    }

    const status = input.ok ? "DONE" : "FAILED"
    await this.prisma.browserCommand.update({
      where: { id: command.id },
      data: {
        status,
        result: (input.result ?? undefined) as never,
        screenshotPath,
        screenshotData: null, // 落盘后清空，避免数据库膨胀
        error: input.error ?? null,
        url: input.url ?? null,
        title: input.title ?? null,
        durationMs: input.durationMs ?? 0,
        finishedAt: new Date()
      }
    })

    // 同步一份到 BrowserStep：后台「浏览器会话」页与审计沿用原有数据源
    await this.appendStep({
      sessionId: command.sessionId,
      seq: command.seq,
      action: command.action,
      selector: command.selector,
      value: command.value,
      status: input.ok ? "SUCCESS" : "FAILED",
      error: input.error ?? null,
      url: input.url ?? null,
      title: input.title ?? null,
      screenshotPath,
      snapshot: input.result ?? null,
      durationMs: input.durationMs ?? 0
    })

    if (input.url) {
      await this.prisma.browserSession.update({
        where: { id: command.sessionId },
        data: { currentUrl: input.url, lastSeenAt: new Date() }
      })
    }

    return { success: true, screenshotPath }
  }

  /** 增量拉取指令（前端轮询用） */
  async commands(sessionId: string, sinceSeq = 0) {
    const rows = await this.prisma.browserCommand.findMany({
      where: { sessionId, seq: { gt: sinceSeq } },
      orderBy: { seq: "asc" },
      take: 200
    })
    return {
      items: rows.map((r) => ({
        id: r.id,
        seq: r.seq,
        action: r.action,
        selector: r.selector,
        value: r.value,
        status: r.status,
        result: r.result,
        error: r.error,
        url: r.url,
        title: r.title,
        durationMs: r.durationMs,
        screenshotPath: r.screenshotPath,
        createdAt: r.createdAt
      }))
    }
  }

  // ---------- 内部 ----------

  /** 把 dataURL / base64 写成 png 文件，返回可访问的相对路径 */
  private async saveScreenshot(
    sessionId: string,
    seq: number,
    data: string
  ): Promise<string | null> {
    try {
      const base64 = data.includes(",") ? data.slice(data.indexOf(",") + 1) : data
      const buffer = Buffer.from(base64, "base64")
      // 防止异常大的图片把磁盘写满（约 8MB base64）
      if (buffer.length > 8 * 1024 * 1024) {
        this.logger.warn(`截图过大已丢弃：${buffer.length} bytes`)
        return null
      }

      const dir = join(this.artifactDir, sessionId)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

      const filename = `step-${seq}-${Date.now()}.png`
      writeFileSync(join(dir, filename), buffer)
      return join("browser", sessionId, filename).replace(/\\/g, "/")
    } catch (err) {
      this.logger.warn(`截图保存失败：${(err as Error).message}`)
      return null
    }
  }

  private async appendStep(data: {
    sessionId: string
    seq: number
    action: string
    selector: string | null
    value: string | null
    status: string
    error: string | null
    url: string | null
    title: string | null
    screenshotPath: string | null
    snapshot: unknown
    durationMs: number
  }) {
    // seq 唯一性由指令序号保证；重复回报时覆盖即可
    const existing = await this.prisma.browserStep.findFirst({
      where: { sessionId: data.sessionId, seq: data.seq }
    })
    if (existing) {
      await this.prisma.browserStep.update({
        where: { id: existing.id },
        data: {
          status: data.status,
          error: data.error,
          url: data.url,
          title: data.title,
          screenshotPath: data.screenshotPath ?? existing.screenshotPath,
          snapshot: (data.snapshot ?? undefined) as never,
          durationMs: data.durationMs
        }
      })
      return
    }
    await this.prisma.browserStep.create({
      data: {
        sessionId: data.sessionId,
        seq: data.seq,
        action: data.action,
        selector: data.selector,
        value: data.value,
        status: data.status,
        error: data.error,
        url: data.url,
        title: data.title,
        screenshotPath: data.screenshotPath,
        snapshot: (data.snapshot ?? undefined) as never,
        durationMs: data.durationMs
      }
    })
  }
}
