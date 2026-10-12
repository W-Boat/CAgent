import {activityDay,activitySince} from "./campus-activity.service"
import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { PrismaService } from "../prisma/prisma.service"
import { BrowserEngineService } from "../browser/browser-engine.service"
import { CampusGuideService, type GuideHit, type GuideMode } from "./campus-guide.service"

/**
 * 校园导览会话服务。
 *
 * 交互纪律（融合 SKILL.md 的硬性规则 1）：
 *   **默认「打开页面」而不是「代替同学完成任务」。**
 *   - 后端只做 goto（把页面推出来）与 DOM 视觉标注（指哪里）
 *   - 绝不代填表、代点击提交、代登录
 *   - 提示统一走「网页下方悬浮提示框」，由学生自己照着做
 *
 * 部署说明：服务端浏览器是**可选**能力（BROWSER_SERVER_ENABLED）。
 * 默认关闭时导览只返回「入口 + 分步指引」，页面由用户自己的浏览器打开——
 * 这既省服务器内存，也更符合「导览不代办」的定位。
 */

export interface StepHint {
  index: number
  text: string
  /** 该步骤对应的动作提示（面向学生，第二人称） */
  tip: string
  /** 与该步骤相关的关键参数 */
  facts: { kind: string; value: string }[]
  done: boolean
}

@Injectable()
export class CampusGuideRunService {
  private readonly logger = new Logger(CampusGuideRunService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly guide: CampusGuideService,
    private readonly browser: BrowserEngineService,
    private readonly config: ConfigService
  ) {}

  /**
   * 把索引里的原始步骤改写成「怎么做」的口吻，并挂上相关关键参数。
   *
   * 索引里的 steps 是正文按行切出来的，常混有小标题；这里做一次轻量清洗：
   *   - 去掉行首编号（1. / 一、 / (2)）
   *   - 以「注：」「温馨提示」开头的行转成注意事项而不是步骤
   */
  buildStepHints(hit: GuideHit, progress: Record<string, boolean> = {}): StepHint[] {
    const raw = Array.isArray(hit.steps) ? hit.steps : []
    const facts = Array.isArray(hit.keyFacts) ? hit.keyFacts : []
    const hints: StepHint[] = []

    raw.slice(0, 8).forEach((line, i) => {
      const text = String(line)
        .replace(/^\s*(?:\d+[.、)]|[一二三四五六七八九十]+[、.]|\(\d+\))\s*/, "")
        .trim()
      if (!text) return

      // 与该步骤相关的关键参数：按值里的关键词是否出现在步骤文本里匹配
      const related = facts.filter((f) => {
        const v = String(f.value || "")
        if (!v) return false
        const core = v.replace(/^[\d\s]+/, "").slice(0, 4)
        return core.length >= 2 && text.includes(core)
      })

      const isCaveat = /^(注[:：]|温馨提示|注意[:：])/.test(text)
      hints.push({
        index: i + 1,
        text,
        tip: isCaveat ? text : `第 ${i + 1} 步：${text}`,
        facts: isCaveat ? [] : related,
        done: progress[String(i + 1)] === true
      })
    })

    return hints
  }

  /** 面向学生的顶部提示（第一屏就会看到的那句话） */
  private buildBanner(hit: GuideHit): string {
    const bits: string[] = []
    if (hit.dept) bits.push(`去 ${hit.dept}`)
    if (hit.place) bits.push(`地点 ${hit.place}`)
    if (hit.tel) bits.push(`电话 ${hit.tel}`)

    if (hit.detailStatus === "unavailable") {
      return "该事项校方尚未启用，页面里可能没有内容——先看清楚再决定要不要跑一趟。"
    }
    if (hit.access === "校园网/VPN") {
      return `这个入口要在校园网内或连上 aTrust VPN 才能打开。${bits.join("，")}。页面已为你打开，接下来自己操作。`
    }
    if (hit.access === "已合并下线") {
      return "该平台已合并到其他系统，请从新入口进入。"
    }
    const prefix = bits.length ? `${bits.join("，")}。` : ""
    return `${prefix}页面已为你打开，按下面的步骤自己完成，导览不会替你点提交。`
  }

  private hitFromItem(row: any, mode: GuideMode = "guide"): GuideHit {
    // 复用 service 的字段整形，保证与检索结果结构一致
    return (this.guide as any).toHit(row, 0, mode) as GuideHit
  }

  /**
   * 打开导览条目：给出「入口链接 + 分步指引」。
   *
   * 关于服务端浏览器的取舍：
   *   服务器普遍不安装 Chromium（内存吃紧），因此这里**不再强依赖**服务端浏览器。
   *   导览的核心价值本来就是「去哪办、带什么、怎么走、入口在哪」——这些来自
   *   本地索引，与能否截图无关；页面渲染交给用户自己的浏览器（点一下入口即可）。
   *
   *   若部署环境确实装了浏览器（BROWSER_SERVER_ENABLED=true），仍会额外抓一张
   *   实时画面；否则 frame 返回 null，前端展示指引而不显示画面。
   */
  async open(params: {
    userId: string
    itemId?: string
    url?: string
    reuse?: boolean
    headless?: boolean
    mode?: GuideMode
    /** 前端内嵌区域尺寸：让画面比例贴近实际容器 */
    width?: number
    height?: number
  }) {
    let item: any = null
    if (params.itemId) {
      const isNumeric = /^\d+$/.test(params.itemId)
      item = isNumeric
        ? await this.prisma.campusGuideItem.findUnique({
            where: { externalId: Number(params.itemId) }
          })
        : await this.prisma.campusGuideItem.findUnique({ where: { id: params.itemId } })
      if (!item) throw new NotFoundException("导览条目不存在")
    }

    const targetUrl = params.url || item?.url
    if (!targetUrl) throw new BadRequestException("需要提供 itemId 或 url")

    const mode: GuideMode = params.mode === "full" ? "full" : "guide"
    const hit: GuideHit = item
      ? this.hitFromItem(item, mode)
      : {
          id: "",
          externalId: 0,
          score: 0,
          title: targetUrl,
          url: targetUrl,
          cat: "自定义",
          type: "网页",
          source: "",
          dept: null,
          place: null,
          tel: null,
          campus: null,
          form: null,
          officeTime: null,
          contact: null,
          login: null,
          access: null,
          detailStatus: "link_only",
          subtype: null,
          summaryShort: "",
          steps: [],
          keyFacts: [],
          verifiedAt: null,
          note: null,
          views: 0,
          warnings: [],
          canEmbed: true
        }

    /*
     * 服务端浏览器是可选的：默认不装（BROWSER_SERVER_ENABLED 未开）。
     * 关闭时不创建会话、不抓画面，只返回指引，前端引导用户自己点开入口。
     */
    const serverBrowserEnabled =
      this.config.get<string>("BROWSER_SERVER_ENABLED") === "true"

    let run: any = null
    let sessionId: string | null = null
    let alive = false

    if (serverBrowserEnabled) {
      // 复用该用户最近 30 分钟内、仍然活着的导览会话，避免每点一次就开一个 Chromium
      if (params.reuse !== false) {
        run = await this.prisma.campusGuideRun.findFirst({
          where: {
            userId: params.userId,
            closedAt: null,
            createdAt: { gte: new Date(Date.now() - 30 * 60_000) }
          },
          orderBy: { createdAt: "desc" }
        })
      }

      sessionId = run?.browserSessionId ?? null
      if (sessionId) {
        try {
          await this.browser.liveFrame(sessionId)
          alive = true
        } catch {
          alive = false
        }
      }

      if (!alive) {
        if (sessionId) {
          await this.browser.closeSession(sessionId, "CRASHED").catch(() => undefined)
          sessionId = null
        }
        if (run) {
          await this.prisma.campusGuideRun.update({
            where: { id: run.id },
            data: { closedAt: new Date() }
          })
          run = null
        }
      }

      if (!sessionId) {
        const session = await this.browser.createSession({
          userId: params.userId,
          name: `校园导览 · ${hit.title}`.slice(0, 80),
          headless: params.headless !== false
        })
        sessionId = session.id
      }
    }

    // 建立或更新导览记录（没有浏览器会话时 sessionId 记 null，仍要留痕）
    if (!run || run.itemId !== (item?.id ?? "")) {
      if (run && run.itemId !== (item?.id ?? "")) {
        await this.prisma.campusGuideRun.update({
          where: { id: run.id },
          data: { closedAt: new Date() }
        })
      }
      run = await this.createRun({
        userId: params.userId,
        itemId: item?.id ?? (await this.fallbackItem(targetUrl)),
        mode: mode === "full" ? "FULL" : "GUIDE",
        sessionId: sessionId ?? "",
        targetUrl
      })
    }

    // 只做 goto：把页面推出来，不做任何后续点击/填写
    let pageOk = true
    let openError: string | null = null
    if (sessionId) {
      try {
        await this.browser.execute(sessionId, {
          action: "goto",
          value: targetUrl,
          timeout: 25000
        })
      } catch (err) {
        pageOk = false
        openError = (err as Error).message
        this.logger.warn(`导览打开页面失败：${targetUrl} → ${openError}`)
      }

      // 视口对齐前端内嵌区域：宽高比贴近容器，画面缩小后文字才不至于糊成一团
      if (params.width && params.height) {
        await this.browser.resize(sessionId, params.width, params.height).catch(() => undefined)
      }
    }

    const visited = Array.isArray(run.visitedUrls) ? (run.visitedUrls as string[]) : []
    if (!visited.includes(targetUrl)) visited.push(targetUrl)
    await this.prisma.campusGuideRun.update({
      where: { id: run.id },
      data: { visitedUrls: visited }
    })

    let frame: unknown = null
    if (sessionId && pageOk) {
      try {
        frame = await this.browser.liveFrame(sessionId)
      } catch {
        frame = null
      }
    }

    const progress = (run.stepProgress as Record<string, boolean>) || {}

    // 校园门户几乎都走 CAS 统一身份认证：未登录时画面会停在登录页。
    // 这不是错误，但必须说清楚，否则学生会以为「页面打不开」。
    const warnings = this.landingWarnings(hit, frame)
    if (!sessionId) {
      warnings.push(
        "服务器不渲染页面：请点上面的入口，在你自己的浏览器里打开（已登录的会话可直接用）。"
      )
    }

    return {
      runId: run.id,
      sessionId,
      mode,
      hit,
      hints: this.buildStepHints(hit, progress),
      banner: this.buildBanner(hit),
      warnings,
      currentStep: run.currentStep,
      pageOk,
      openError,
      frame,
      /** 服务端是否提供了实时画面；false 时前端展示指引卡片 */
      hasLiveFrame: Boolean(frame),
      /** 明确告诉前端与用户：这是导览，不代办 */
      policy: {
        openOnly: true,
        autoFill: false,
        autoSubmit: false,
        message: "导览只负责打开页面并指路，操作由你自己完成。"
      }
    }
  }

  /**
   * 新建一条导览记录。
   *
   * 历史包袱：`browser_session_id` 曾经有唯一约束，而切换事项时又会**复用同一个
   * 浏览器会话**，于是连续打开第二个事项必然报
   *   Unique constraint failed on the fields: (`browser_session_id`)
   * 约束已在迁移 20260924013000 中移除。这里额外做一层自愈：万一库里还残留
   * 占用该会话的旧记录（例如别的库没跑迁移），就把旧的解绑而不是让学生看到 500。
   */
  private async createRun(params: {
    userId: string
    itemId: string
    mode: "GUIDE" | "FULL"
    sessionId: string
    targetUrl: string
  }) {
    const data = {
      userId: params.userId,
      itemId: params.itemId,
      mode: params.mode,
      browserSessionId: params.sessionId,
      visitedUrls: [params.targetUrl],
      stepProgress: {}
    }

    try {
      return await this.prisma.campusGuideRun.create({ data })
    } catch (err) {
      const message = (err as Error).message || ""
      if (!/Unique constraint|browser_session_id/i.test(message)) throw err

      this.logger.warn(
        `导览记录与会话 ${params.sessionId} 冲突，正在解绑旧记录后重试：${message.slice(0, 160)}`
      )
      // 让旧记录保留审计价值，但不再声称拥有这个会话的画面
      await this.prisma.campusGuideRun.updateMany({
        where: { browserSessionId: params.sessionId },
        data: { browserSessionId: null, closedAt: new Date() }
      })
      return await this.prisma.campusGuideRun.create({ data })
    }
  }

  /** 自定义 URL 也需要一个可挂载的条目行（导览记录得挂在某个 item 上） */
  private async fallbackItem(url: string): Promise<string> {
    const externalId = -Math.abs(hashCode(url))
    const existing = await this.prisma.campusGuideItem.findUnique({
      where: { externalId }
    })
    if (existing) return existing.id
    const created = await this.prisma.campusGuideItem.create({
      data: {
        externalId,
        title: `自定义入口 ${url}`.slice(0, 200),
        url,
        cat: "自定义入口",
        type: "网页",
        source: "用户手动打开",
        detailStatus: "link_only",
        summaryShort: "由用户在导览页手动输入的地址。",
        searchText: url.toLowerCase()
      }
    })
    return created.id
  }

  // ---------- 会话读写 ----------

  async list(userId: string, query: { page?: number; pageSize?: number; all?: boolean;keyword?:string;status?:string }) {
    return this.prisma.paginate(
      this.prisma.campusGuideRun,
      {
        where: {...(query.all?{}:{userId}),...(query.keyword?{item:{title:{contains:query.keyword,mode:'insensitive'}}}:{}),...(query.status==='done'?{completed:true}:query.status==='closed'?{closedAt:{not:null}}:query.status==='open'?{closedAt:null}:{})},
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { id: true, email: true, name: true } },
          item: {
            select: {
              id: true,
              externalId: true,
              title: true,
              url: true,
              cat: true,
              dept: true,
              access: true,
              detailStatus: true
            }
          }
        }
      },
      Number(query.page) || 1,
      Number(query.pageSize) || 20
    )
  }

  async detail(userId: string, runId: string,canAdmin=false) {
    const run = await this.prisma.campusGuideRun.findUnique({
      where: { id: runId },
      include: {
        user: { select: { id: true, email: true, name: true } },
        item: true
      }
    })
    if (!run) throw new NotFoundException("导览记录不存在")
    if (run.userId !== userId && !canAdmin) throw new NotFoundException("导览记录不存在")

    const mode: GuideMode = run.mode === "FULL" ? "full" : "guide"
    const hit = run.item ? this.hitFromItem(run.item, mode) : null
    const progress = (run.stepProgress as Record<string, boolean>) || {}

    let frame: unknown = null
    let alive = false
    if (run.browserSessionId && !run.closedAt) {
      try {
        const live = await this.browser.liveFrame(run.browserSessionId)
        // 会话会被同一用户的后续导览复用：只有当前页面确实属于这条记录，
        // 画面才算它的。否则审计页会把「新事项的画面」错挂到旧记录上。
        const visited = Array.isArray(run.visitedUrls) ? (run.visitedUrls as string[]) : []
        const samePage =
          visited.length === 0 ||
          visited.some((u) => u && (live.url === u || live.url.startsWith(u.split("?")[0])))
        if (samePage) {
          frame = live
          alive = true
        }
      } catch {
        alive = false
      }
    }

    return {
      run,
      hit,
      hints: hit ? this.buildStepHints(hit, progress) : [],
      banner: hit ? this.buildBanner(hit) : "",
      warnings: this.landingWarnings(hit, frame),
      currentStep: run.currentStep,
      alive,
      frame
    }
  }

  /**
   * 落点提示：页面停在 CAS 登录页时要说清楚，否则学生以为「打不开」。
   * 打开与回看两条路径共用，保证口径一致。
   */
  private landingWarnings(hit: GuideHit | null, frame: unknown): string[] {
    const warnings = [...(hit?.warnings ?? [])]
    const landedUrl = (frame as { url?: string } | null)?.url || ""
    if (/authserver|\/login|cas-login|sso/i.test(landedUrl)) {
      warnings.unshift(
        "画面停在统一身份认证登录页：请用你的学号与密码自行登录，登录后页面会自动跳到你要办的事项。导览不会代替你登录。"
      )
    }
    return warnings
  }

  /** 只抓最新画面：前端轮询用，尽量轻 */
  async frame(userId: string, runId: string, fullPage = false) {
    const run = await this.prisma.campusGuideRun.findUnique({
      where: { id: runId },
      select: { id: true, userId: true, browserSessionId: true, itemId: true }
    })
    if (!run || run.userId !== userId) throw new NotFoundException("导览记录不存在")
    // 服务器不渲染页面时没有会话，这不是错误：前端据此展示指引卡片即可
    if (!run.browserSessionId) {
      throw new BadRequestException("SERVER_BROWSER_DISABLED")
    }

    try {
      return await this.browser.liveFrame(run.browserSessionId, fullPage)
    } catch (err) {
      const message = (err as Error).message || ""
      // 只有「会话真的没了」才收尾记录。
      // 截图抖动（页面跳转中、字体未加载完）是一次性的，不该把导览判死——
      // 否则前端每 5 秒轮询一次，一次抖动就会让学生看到「会话已结束」。
      const sessionGone = /会话不存在|已关闭|已结束|Target closed|has been closed|Session .* not found/i.test(
        message
      )
      if (sessionGone) {
        await this.prisma.campusGuideRun.update({
          where: { id: runId },
          data: { closedAt: new Date() }
        })
        throw new BadRequestException("浏览器会话已结束，请重新打开页面")
      }
      throw new BadRequestException(`画面暂时取不到，正在重试（${message.slice(0, 120)}）`)
    }
  }

  async advance(userId: string, runId: string, step: number, done = true, note?: string) {
    const run = await this.ensureOwned(userId, runId)
    const progress = { ...((run.stepProgress as Record<string, boolean>) || {}) }
    progress[String(step)] = done

    // 步骤总数取自条目本身：进度要能算出「做完了没」
    const item = await this.prisma.campusGuideItem.findUnique({
      where: { id: run.itemId },
      select: { id: true, steps: true }
    })
    const total = Array.isArray(item?.steps) ? (item!.steps as string[]).length : 0
    const doneCount = Object.values(progress).filter(Boolean).length

    const updated = await this.prisma.campusGuideRun.update({
      where: { id: runId },
      data: {
        stepProgress: progress,
        currentStep: Math.max(run.currentStep, step),
        completed: total > 0 && doneCount >= total,
        note: note ?? run.note
      }
    })

    const mode: GuideMode = updated.mode === "FULL" ? "full" : "guide"
    const fullItem = item
      ? await this.prisma.campusGuideItem.findUnique({ where: { id: item.id } })
      : null
    const hit = fullItem ? this.hitFromItem(fullItem, mode) : null

    return {
      run: updated,
      hints: hit ? this.buildStepHints(hit, progress) : [],
      doneCount,
      total
    }
  }

  async close(userId: string, runId: string) {
    const run = await this.ensureOwned(userId, runId)
    if (run.browserSessionId) {
      await this.browser.closeSession(run.browserSessionId).catch(() => undefined)
    }
    await this.prisma.campusGuideRun.update({
      where: { id: runId },
      data: { closedAt: new Date() }
    })
    return { success: true }
  }

  /** 只做视觉标注：指哪里，不点哪里。可用 CSS 选择器或页面上的可见文字定位 */
  async highlight(
    userId: string,
    runId: string,
    selector?: string,
    label?: string,
    clear = false,
    text?: string
  ) {
    const run = await this.ensureOwned(userId, runId)
    if (!run.browserSessionId) throw new BadRequestException("该导览记录没有浏览器会话")
    try {
      const res = await this.browser.highlight(run.browserSessionId, selector, label, clear, text)
      const frame = await this.browser.liveFrame(run.browserSessionId).catch(() => null)
      return { ...res, frame }
    } catch (err) {
      // 标注失败不该让整个导览中断：告诉前端「这次没指成」，提示与画面继续可用
      this.logger.warn(`导览标注失败：${(err as Error).message}`)
      const frame = await this.browser.liveFrame(run.browserSessionId).catch(() => null)
      return {
        cleared: false,
        matched: 0,
        error: "页面正在跳转或尚未加载完成，稍后再点一次「指给我看」",
        frame
      }
    }
  }

  /** 学生自己滚动页面（导览只帮忙把画面挪到该看的地方） */
  async scroll(userId: string, runId: string, y: number) {
    const run = await this.ensureOwned(userId, runId)
    if (!run.browserSessionId) throw new BadRequestException("该导览记录没有浏览器会话")
    await this.browser.execute(run.browserSessionId, {
      action: "scroll",
      value: String(Number(y) || 600)
    })
    const frame = await this.browser.liveFrame(run.browserSessionId).catch(() => null)
    return { success: true, frame }
  }

  /** 手动刷新页面（学生自己点「刷新」，不是 Agent 自作主张） */
  async reload(userId: string, runId: string) {
    const run = await this.ensureOwned(userId, runId)
    if (!run.browserSessionId) throw new BadRequestException("该导览记录没有浏览器会话")
    const res = await this.browser.execute(run.browserSessionId, { action: "reload" })
    const frame = await this.browser.liveFrame(run.browserSessionId).catch(() => null)
    return { ...res, frame }
  }

  private async ensureOwned(userId: string, runId: string) {
    const run = await this.prisma.campusGuideRun.findUnique({ where: { id: runId } })
    if (!run || run.userId !== userId) throw new NotFoundException("导览记录不存在")
    return run
  }

  /** 导览使用统计（后台） */
  async stats(days = 14) {
    days=Math.min(90,Math.max(1,Math.floor(days)||14))
    const since = activitySince(days)
    const [total, completed, byDay, topItems, byAccess] = await Promise.all([
      this.prisma.campusGuideRun.count({ where: { createdAt: { gte: since } } }),
      this.prisma.campusGuideRun.count({
        where: { createdAt: { gte: since }, completed: true }
      }),
      this.prisma.campusGuideRun.findMany({
        where: { createdAt: { gte: since } },
        select: { createdAt: true, completed: true }
      }),
      this.prisma.campusGuideRun.groupBy({
        by: ["itemId"],
        where: { createdAt: { gte: since } },
        _count: { _all: true }
      }),
      this.prisma.campusGuideRun.findMany({
        where: { createdAt: { gte: since } },
        select: { item: { select: { access: true } } }
      })
    ])

    const itemIds = topItems.map((r) => r.itemId)
    const items = await this.prisma.campusGuideItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, title: true, url: true, dept: true }
    })
    const nameMap = new Map(items.map((i) => [i.id, i]))

    const dayMap = new Map<string, number>()
    for (const row of byDay) {
      const key = activityDay(row.createdAt)
      dayMap.set(key, (dayMap.get(key) ?? 0) + 1)
    }
    const trend: { date: string; runs: number }[] = []
    for (let i = days - 1; i >= 0; i--) {
      const date = activityDay(new Date(Date.now() - i * 86400_000))
      trend.push({ date, runs: dayMap.get(date) ?? 0 })
    }

    const accessMap = new Map<string, number>()
    for (const row of byAccess) {
      const key = row.item?.access ?? "未标注"
      accessMap.set(key, (accessMap.get(key) ?? 0) + 1)
    }

    return {
      total,
      completed,
      completionRate: total > 0 ? Math.round((completed / total) * 1000) / 10 : 0,
      trend,
      byAccess: Array.from(accessMap.entries()).map(([access, count]) => ({ access, count })),
      topItems: topItems
        .map((r) => ({
          item: nameMap.get(r.itemId) ?? { id: r.itemId, title: "（已删除）", url: "", dept: null },
          opens: r._count._all
        }))
        .sort((a, b) => b.opens - a.opens)
        .slice(0, 10)
    }
  }
}

function hashCode(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i)
    h |= 0
  }
  return h
}