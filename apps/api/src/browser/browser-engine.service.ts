import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy
} from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { chromium, type Browser, type BrowserContext, type Page } from "playwright"
import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { PrismaService } from "../prisma/prisma.service"

export interface BrowserAction {
  action: string
  selector?: string
  value?: string
  timeout?: number
}

export interface ActionResult {
  ok: boolean
  action: string
  url?: string
  title?: string
  data?: unknown
  screenshotPath?: string
  error?: string
  durationMs: number
}

interface LiveSession {
  sessionId: string
  browser: Browser
  context: BrowserContext
  page: Page
}

/**
 * 浏览器操控引擎。
 *
 * 每个会话独占一个 Chromium 实例，动作执行结果（含截图）落库，
 * 供后台管理页面回放整个操作轨迹。
 */
@Injectable()
export class BrowserEngineService implements OnModuleDestroy {
  private readonly logger = new Logger(BrowserEngineService.name)
  private readonly sessions = new Map<string, LiveSession>()
  private readonly artifactDir: string

  /** 需要人工确认的高风险动作 */
  private static readonly DANGEROUS_ACTIONS = ["evaluate", "download"]

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

  async onModuleDestroy() {
    for (const [id, session] of this.sessions) {
      await this.closeSession(id).catch(() => undefined)
      this.logger.log(`关闭浏览器会话 ${id}`)
    }
  }

  // ---------- 会话生命周期 ----------

  async createSession(params: {
    userId: string
    name?: string
    startUrl?: string
    headless?: boolean
    skillRunId?: string
  }) {
    /*
     * 服务器默认不安装 Chromium（内存吃紧），因此服务端执行是「可选能力」。
     * 默认关闭时给出明确指引，避免用户看到一句难以理解的启动失败。
     */
    const serverBrowserEnabled =
      this.config.get<string>("BROWSER_SERVER_ENABLED") === "true"
    if (!serverBrowserEnabled) {
      throw new BadRequestException(
        "服务端浏览器未启用（服务器不安装 Chromium）。请创建「本地执行」会话，" +
          "网页渲染与操作将在你自己的浏览器中完成。"
      )
    }

    const headless =
      params.headless ??
      this.config.get<string>("BROWSER_HEADLESS") !== "false"

    const record = await this.prisma.browserSession.create({
      data: {
        userId: params.userId,
        name: params.name || "浏览器会话",
        headless,
        startUrl: params.startUrl ?? null,
        status: "ACTIVE",
        skillRunId: params.skillRunId ?? null
      }
    })

    try {
      const browser = await chromium.launch({
        headless,
        args: [
          "--no-sandbox",
          "--disable-dev-shm-usage",
          "--disable-blink-features=AutomationControlled"
        ]
      })
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        locale: "zh-CN"
      })
      const page = await context.newPage()

      this.sessions.set(record.id, {
        sessionId: record.id,
        browser,
        context,
        page
      })

      if (params.startUrl) {
        await this.execute(record.id, {
          action: "goto",
          value: params.startUrl
        })
      }

      return this.detail(record.id)
    } catch (err) {
      await this.prisma.browserSession.update({
        where: { id: record.id },
        data: { status: "CRASHED", closedAt: new Date() }
      })
      throw new BadRequestException(
        `启动浏览器失败：${(err as Error).message}。若为首次使用，请先执行 npx playwright install chromium`
      )
    }
  }

  async closeSession(sessionId: string, reason: "CLOSED" | "CRASHED" = "CLOSED") {
    const live = this.sessions.get(sessionId)
    if (live) {
      this.sessions.delete(sessionId)
      await live.page.close().catch(() => undefined)
      await live.context.close().catch(() => undefined)
      await live.browser.close().catch(() => undefined)
    }
    await this.prisma.browserSession.updateMany({
      where: { id: sessionId },
      data: { status: reason, closedAt: new Date() }
    })
    return { success: true }
  }

  /**
   * 进程重启后回收数据库中残留的 ACTIVE 会话。
   *
   * 只处理 SERVER 执行器：本地执行（LOCAL）的会话跑在用户浏览器里，
   * 服务端重启不影响它们，误标记会让用户刷新页面后会话凭空消失。
   */
  async cleanupStaleSessions() {
    const result = await this.prisma.browserSession.updateMany({
      where: { status: "ACTIVE", executor: "SERVER" },
      data: { status: "CRASHED", closedAt: new Date() }
    })
    if (result.count > 0) {
      this.logger.warn(`回收 ${result.count} 个残留的服务端浏览器会话`)
    }
    return result
  }

  private getLive(sessionId: string): LiveSession {
    const live = this.sessions.get(sessionId)
    if (!live) {
      throw new BadRequestException(
        "浏览器会话已失效（服务可能已重启），请重新创建会话"
      )
    }
    return live
  }

  // ---------- 动作执行 ----------

  async execute(sessionId: string, action: BrowserAction): Promise<ActionResult> {
    const live = this.getLive(sessionId)
    const started = Date.now()

    const session = await this.prisma.browserSession.findUnique({
      where: { id: sessionId },
      select: { id: true }
    })
    if (!session) throw new NotFoundException("浏览器会话不存在")

    const lastSeq = await this.prisma.browserStep.count({
      where: { sessionId }
    })

    let result: ActionResult = { ok: true, action: action.action, durationMs: 0 }
    let stepId: string | null = null

    // 先落一条 RUNNING 记录，便于前端实时看到进度
    const step = await this.prisma.browserStep.create({
      data: {
        sessionId,
        seq: lastSeq + 1,
        action: action.action,
        selector: action.selector ?? null,
        value: action.value ?? null,
        status: "RUNNING"
      }
    })
    stepId = step.id

    try {
      result = await this.perform(live, action)
      result.durationMs = Date.now() - started

      let screenshotPath: string | undefined
      if (action.action !== "screenshot" && action.action !== "extract") {
        // 关键动作留痕，便于后台回放
        screenshotPath = await this.capture(sessionId, step.seq)
      }
      // screenshot 动作由 perform 自行截图，这里沿用其结果，保证步骤记录里也有图
      const finalShot = result.screenshotPath ?? screenshotPath
      if (finalShot) result.screenshotPath = finalShot

      await this.prisma.browserStep.update({
        where: { id: stepId },
        data: {
          status: result.ok ? "SUCCESS" : "FAILED",
          url: result.url ?? live.page.url(),
          title: result.title ?? (await live.page.title().catch(() => null)),
          screenshotPath: finalShot ?? null,
          snapshot: (result.data ?? undefined) as any,
          error: result.error ?? null,
          durationMs: result.durationMs
        }
      })

      await this.prisma.browserSession.update({
        where: { id: sessionId },
        data: { currentUrl: live.page.url() }
      })

      return result
    } catch (err) {
      const message = (err as Error).message
      const durationMs = Date.now() - started
      await this.prisma.browserStep.update({
        where: { id: stepId },
        data: {
          status: "FAILED",
          error: message,
          durationMs,
          url: live.page.url()
        }
      })
      return {
        ok: false,
        action: action.action,
        error: message,
        durationMs
      }
    }
  }

  private async perform(
    live: LiveSession,
    action: BrowserAction
  ): Promise<ActionResult> {
    const { page } = live
    const timeout = action.timeout ?? 15000
    const base: ActionResult = {
      ok: true,
      action: action.action,
      durationMs: 0
    }

    switch (action.action) {
      case "goto": {
        if (!action.value) throw new BadRequestException("goto 需要提供 value 作为地址")
        const url = normalizeUrl(action.value)
        await page.goto(url, { waitUntil: "domcontentloaded", timeout })
        return { ...base, url: page.url(), title: await page.title() }
      }

      case "click": {
        if (!action.selector) throw new BadRequestException("click 需要提供 selector")
        await page.click(action.selector, { timeout })
        await page.waitForLoadState("domcontentloaded").catch(() => undefined)
        return { ...base, url: page.url(), title: await page.title() }
      }

      case "type": {
        if (!action.selector) throw new BadRequestException("type 需要提供 selector")
        await page.fill(action.selector, action.value ?? "", { timeout })
        return { ...base, url: page.url() }
      }

      case "press": {
        if (!action.selector) throw new BadRequestException("press 需要提供 selector")
        await page.press(action.selector, action.value || "Enter", { timeout })
        await page.waitForLoadState("domcontentloaded").catch(() => undefined)
        return { ...base, url: page.url() }
      }

      case "select": {
        if (!action.selector) throw new BadRequestException("select 需要提供 selector")
        await page.selectOption(action.selector, action.value ?? "", { timeout })
        return { ...base }
      }

      case "wait": {
        await page.waitForTimeout(action.timeout ?? 1000)
        return { ...base }
      }

      case "waitFor": {
        if (!action.selector) throw new BadRequestException("waitFor 需要提供 selector")
        await page.waitForSelector(action.selector, { timeout })
        return { ...base }
      }

      case "extract": {
        const data = await this.extract(page, action.selector)
        return { ...base, url: page.url(), title: await page.title(), data }
      }

      case "screenshot": {
        const path = await this.capture(live.sessionId, Date.now())
        return { ...base, url: page.url(), screenshotPath: path }
      }

      case "evaluate": {
        if (!action.value) throw new BadRequestException("evaluate 需要提供 value 作为脚本")
        // 只允许表达式求值，禁止访问 Node 环境
        const data = await page.evaluate(action.value)
        return { ...base, data }
      }

      case "scroll": {
        await page.evaluate(
          (y) => window.scrollBy(0, y),
          Number(action.value || 800)
        )
        return { ...base }
      }

      case "back": {
        await page.goBack({ timeout }).catch(() => undefined)
        return { ...base, url: page.url(), title: await page.title() }
      }

      case "forward": {
        await page.goForward({ timeout }).catch(() => undefined)
        return { ...base, url: page.url(), title: await page.title() }
      }

      case "reload": {
        await page.reload({ timeout })
        return { ...base, url: page.url(), title: await page.title() }
      }

      case "content": {
        const html = await page.content()
        return { ...base, data: { html: html.slice(0, 200000) } }
      }

      default:
        throw new BadRequestException(`不支持的动作：${action.action}`)
    }
  }

  /** 提取页面结构化内容：标题、正文文本、链接、表单 */
  private async extract(page: Page, selector?: string) {
    return page.evaluate((sel: string | undefined) => {
      const root: Element = sel
        ? document.querySelector(sel) || document.body
        : document.body

      const text = (root as HTMLElement).innerText || ""
      const links = Array.from(root.querySelectorAll("a[href]"))
        .slice(0, 100)
        .map((a) => ({
          text: (a as HTMLAnchorElement).innerText.trim().slice(0, 200),
          href: (a as HTMLAnchorElement).href
        }))
      const headings = Array.from(root.querySelectorAll("h1,h2,h3"))
        .slice(0, 50)
        .map((h) => ({
          level: Number(h.tagName[1]),
          text: (h as HTMLElement).innerText.trim().slice(0, 300)
        }))
      const images = Array.from(root.querySelectorAll("img[src]"))
        .slice(0, 50)
        .map((img) => ({
          alt: (img as HTMLImageElement).alt,
          src: (img as HTMLImageElement).src
        }))

      return {
        url: location.href,
        title: document.title,
        text: text.slice(0, 50000),
        headings,
        links,
        images
      }
    }, selector)
  }

  private async capture(sessionId: string, seq: number): Promise<string> {
    const live = this.getLive(sessionId)
    const dir = join(this.artifactDir, sessionId)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const file = join(dir, `${seq}-${Date.now()}.png`)
    await live.page.screenshot({ path: file, fullPage: false })
    return file.replace(/\\/g, "/")
  }

  // ---------- 实时画面（供前端内嵌展示） ----------

  /**
   * 抓一帧当前画面。
   *
   * 始终写入同一个 `live.png`，前端只要在这个 URL 后面拼时间戳就能拿到最新画面，
   * 不会在磁盘上堆积截图。返回当前 URL / 标题 / 视口尺寸，供前端同步地址栏。
   */
  /**
   * 抓一帧当前画面。
   *
   * 始终写入同一个 `live.png`，前端只要在这个 URL 后面拼时间戳就能拿到最新画面，
   * 不会在磁盘上堆积截图。返回当前 URL / 标题 / 视口尺寸，供前端同步地址栏。
   *
   * 截图会偶发失败（`Unable to capture screenshot`，通常是页面正在跳转、
   * 字体还在加载或正在重绘）。前端每 5 秒轮询一次，一次抖动不该让整页报错，
   * 所以这里重试一次，仍失败就退回上一帧并标记 stale。
   */
  async liveFrame(sessionId: string, fullPage = false) {
    const live = this.getLive(sessionId)
    const dir = join(this.artifactDir, sessionId)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const file = join(dir, "live.png")

    const meta = {
      sessionId,
      url: live.page.url(),
      title: await live.page.title().catch(() => ""),
      screenshotPath: file.replace(/\\/g, "/"),
      width: live.page.viewportSize()?.width ?? 1440,
      height: live.page.viewportSize()?.height ?? 900,
      capturedAt: new Date().toISOString()
    }

    let lastError = ""
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await live.page.screenshot({ path: file, fullPage })
        return { ...meta, stale: false }
      } catch (err) {
        lastError = (err as Error).message
        if (attempt === 0) {
          // 给页面一点时间完成跳转/重绘再试
          await live.page.waitForLoadState("domcontentloaded").catch(() => undefined)
          await new Promise((r) => setTimeout(r, 400))
        }
      }
    }

    // 两次都没抓到：若之前有过画面，就把旧帧交出去，前端不至于白屏
    if (existsSync(file)) {
      this.logger.warn(`截图失败，回退上一帧：${lastError.slice(0, 140)}`)
      return { ...meta, stale: true }
    }
    throw new Error(`截图失败：${lastError}`)
  }

  /** 切换视口尺寸（前端按容器宽度自适应时用） */
  async resize(sessionId: string, width: number, height: number) {
    const live = this.getLive(sessionId)
    await live.page.setViewportSize({
      width: Math.min(Math.max(Math.round(width), 320), 2560),
      height: Math.min(Math.max(Math.round(height), 240), 1600)
    })
    return { success: true }
  }

  /**
   * 在页面上做**纯视觉**标注：给目标元素套一个高亮框 + 气泡说明。
   *
   * 只改 DOM 样式，不点击、不填表、不提交——导览场景下「指路不代办」的底线。
   * `clear: true` 时移除所有标注。
   *
   * 定位方式二选一：
   *   - `selector`：CSS 选择器，精确
   *   - `text`：页面上的可见文字，取**最小的**包含该文字的元素（面向学生更直观）
   */
  async highlight(
    sessionId: string,
    selector?: string,
    label?: string,
    clear = false,
    text?: string
  ) {
    const live = this.getLive(sessionId)

    // 校园门户大量使用 CAS 单点登录：goto 之后往往还会再跳一次，
    // 此时页面上下文会被销毁，直接 evaluate 会抛
    // "Execution context was destroyed"。这里先等页面安定，再带一次重试。
    const run = () =>
      live.page.evaluate(
      ({
        sel,
        needle,
        tip,
        shouldClear
      }: {
        sel?: string
        needle?: string
        tip?: string
        shouldClear: boolean
      }) => {
        const LAYER_ID = "__cagent_guide_layer__"
        const existing = document.getElementById(LAYER_ID)
        if (existing) existing.remove()
        if (shouldClear) return { cleared: true, matched: 0 }

        const CANDIDATE =
          "a,button,span,div,li,td,th,h1,h2,h3,h4,p,label,strong,em,section,article"

        let nodes: Element[] = []
        if (needle) {
          const keyword = needle.trim()
          if (!keyword) return { cleared: false, matched: 0 }
          const all = Array.from(document.querySelectorAll(CANDIDATE)).filter(
            (el) => ((el as HTMLElement).innerText || "").includes(keyword)
          )
          // 只保留「最小」的元素：其内部没有同样包含关键字的子元素
          const minimal = all.filter(
            (el) =>
              !Array.from(el.children).some((child) =>
                ((child as HTMLElement).innerText || "").includes(keyword)
              )
          )
          // 命中过多时优先「文字最短」的，也就是最贴近关键字本身的元素，
          // 避免一个「登录」把整块版式都框起来
          nodes = (minimal.length > 0 ? minimal : all)
            .map((el) => ({
              el,
              len: ((el as HTMLElement).innerText || "").trim().length
            }))
            .sort((a, b) => a.len - b.len)
            .slice(0, 3)
            .map((x) => x.el)
        } else if (sel) {
          try {
            nodes = Array.from(document.querySelectorAll(sel)).slice(0, 20)
          } catch {
            return { cleared: false, matched: 0, error: "选择器语法无效" }
          }
        } else {
          return { cleared: false, matched: 0 }
        }

        if (nodes.length === 0) return { cleared: false, matched: 0 }

        const layer = document.createElement("div")
        layer.id = LAYER_ID
        layer.setAttribute(
          "style",
          "position:fixed;inset:0;pointer-events:none;z-index:2147483647"
        )

        let firstRect: DOMRect | null = null
        nodes.forEach((node) => {
          const r = node.getBoundingClientRect()
          if (r.width === 0 && r.height === 0) return
          if (!firstRect) firstRect = r

          const box = document.createElement("div")
          box.setAttribute(
            "style",
            [
              "position:absolute",
              `left:${Math.max(r.left - 4, 0)}px`,
              `top:${Math.max(r.top - 4, 0)}px`,
              `width:${r.width + 8}px`,
              `height:${r.height + 8}px`,
              "border:2px solid #f56c6c",
              "border-radius:6px",
              "box-shadow:0 0 0 3px rgba(245,108,108,.25)",
              "background:rgba(245,108,108,.08)",
              "transition:all .15s ease-out"
            ].join(";")
          )
          layer.appendChild(box)
        })

        if (firstRect && tip) {
          const rect = firstRect as DOMRect
          const bubble = document.createElement("div")
          bubble.textContent = tip
          bubble.setAttribute(
            "style",
            [
              "position:absolute",
              `left:${Math.max(rect.left - 4, 4)}px`,
              `top:${Math.max(rect.top - 34, 4)}px`,
              "max-width:420px",
              "padding:5px 10px",
              "font:13px/1.5 -apple-system,'PingFang SC','Microsoft YaHei',sans-serif",
              "color:#fff",
              "background:#f56c6c",
              "border-radius:6px",
              "white-space:nowrap",
              "box-shadow:0 2px 8px rgba(0,0,0,.2)"
            ].join(";")
          )
          layer.appendChild(bubble)
        }

        document.documentElement.appendChild(layer)

        // 高亮的东西可能在屏幕外，滚到它旁边，学生才看得见
        const first = nodes.find((n) => {
          const r = n.getBoundingClientRect()
          return r.width > 0 || r.height > 0
        })
        first?.scrollIntoView({ block: "center", behavior: "smooth" })

        return { cleared: false, matched: nodes.length }
      },
      { sel: selector, needle: text, tip: label, shouldClear: clear }
      )

    let result: { cleared?: boolean; matched: number; error?: string }
    try {
      // 等网络空闲，减少「标注时页面正好在跳转」的概率
      await live.page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => undefined)
      result = await run()
    } catch (err) {
      const msg = (err as Error).message || ""
      if (/Execution context was destroyed|navigation|Target closed/i.test(msg)) {
        await live.page.waitForTimeout(1200)
        result = await run()
      } else {
        throw err
      }
    }

    return { ...result, screenshotPath: await this.capture(sessionId, Date.now()) }
  }

  // ---------- 查询 ----------

  async listSessions(query: {
    userId?: string
    status?: string
    page?: number
    pageSize?: number
  }) {
    return this.prisma.paginate(
      this.prisma.browserSession,
      {
        where: {
          ...(query.userId ? { userId: query.userId } : {}),
          ...(query.status ? { status: query.status as any } : {})
        },
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { id: true, email: true, name: true } },
          _count: { select: { steps: true } }
        }
      },
      Number(query.page) || 1,
      Number(query.pageSize) || 20
    )
  }

  async detail(sessionId: string) {
    const session = await this.prisma.browserSession.findUnique({
      where: { id: sessionId },
      include: {
        user: { select: { id: true, email: true, name: true } },
        steps: { orderBy: { seq: "asc" } }
      }
    })
    if (!session) throw new NotFoundException("浏览器会话不存在")
    return { ...session, alive: this.sessions.has(sessionId) }
  }

  async steps(sessionId: string, sinceSeq = 0) {
    return this.prisma.browserStep.findMany({
      where: { sessionId, seq: { gt: sinceSeq } },
      orderBy: { seq: "asc" }
    })
  }
}

function normalizeUrl(input: string): string {
  const trimmed = input.trim()
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}