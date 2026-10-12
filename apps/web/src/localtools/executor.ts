/**
 * 本地浏览器执行器。
 *
 * 网页渲染与操控全部在用户自己的浏览器里完成，服务器不下发 Chromium：
 *   - 服务器省内存（2GB 规格跑不动无头浏览器）
 *   - 用的是用户已登录的会话，能看需要登录的校内页面
 *
 * 两种客户端共用同一套动作语义：
 *   WEB       —— 本模块直接操作同源页面（站内页面、被允许嵌入的页面）
 *   EXTENSION —— 浏览器扩展通过 chrome.debugger / scripting 操作任意标签页
 *
 * 动作集合与后端 BrowserCommandService 的 LocalAction 一一对应。
 */

export type LocalActionName =
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

export interface LocalAction {
  action: string
  selector?: string
  value?: string
  timeout?: number
}

export interface LocalActionResult {
  ok: boolean
  url?: string
  title?: string
  /** 结构化结果：文本、匹配数、元素信息 */
  result?: unknown
  /** dataURL 截图 */
  screenshot?: string
  error?: string
  durationMs: number
}

/** 执行上下文：动作作用在哪个 document / window 上 */
export interface ExecContext {
  doc: Document
  win: Window
  /** 截图能力由客户端注入（Web 端没有原生截图 API） */
  capture?: () => Promise<string | null>
}

const DEFAULT_TIMEOUT = 15_000

/** 把选择器里可能出现的 Playwright 风格写法收敛成标准 CSS */
function normalizeSelector(selector: string): string {
  const s = selector.trim()
  // text=xxx → 用 XPath 文本匹配，方便用户沿用习惯写法
  if (s.startsWith("text=")) {
    const text = s.slice(5).trim()
    return `xpath://*[contains(normalize-space(text()), ${JSON.stringify(text)})]`
  }
  return s
}

function queryOne(ctx: ExecContext, selector: string): Element | null {
  const sel = normalizeSelector(selector)
  if (sel.startsWith("xpath:")) {
    const expr = sel.slice(6)
    const res = ctx.doc.evaluate(
      expr,
      ctx.doc,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    )
    return (res.singleNodeValue as Element) || null
  }
  return ctx.doc.querySelector(sel)
}

function queryAll(ctx: ExecContext, selector: string): Element[] {
  const sel = normalizeSelector(selector)
  if (sel.startsWith("xpath:")) {
    const expr = sel.slice(6)
    const res = ctx.doc.evaluate(
      expr,
      ctx.doc,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null
    )
    const out: Element[] = []
    for (let i = 0; i < res.snapshotLength; i++) {
      const node = res.snapshotItem(i)
      if (node instanceof Element) out.push(node)
    }
    return out
  }
  return Array.from(ctx.doc.querySelectorAll(sel))
}

/** 元素等待：轮询直到出现或超时 */
async function waitForElement(
  ctx: ExecContext,
  selector: string,
  timeout: number
): Promise<Element> {
  const deadline = Date.now() + timeout
  let last: Element | null = null
  while (Date.now() < deadline) {
    last = queryOne(ctx, selector)
    if (last) return last
    await new Promise((r) => setTimeout(r, 120))
  }
  throw new Error(`等待元素超时（${timeout}ms）：${selector}`)
}

/**
 * 真实点击：先滚动到可见区，再派发完整的鼠标事件序列。
 *
 * 只调 element.click() 对很多前端框架（React/Vue 的合成事件、
 * 需要 mousedown 才展开的下拉）不生效，所以补全事件序列。
 */
function realClick(el: Element, ctx: ExecContext): void {
  const rect = el.getBoundingClientRect()
  const x = rect.left + rect.width / 2
  const y = rect.top + rect.height / 2

  const opts: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    view: ctx.win as Window & typeof globalThis,
    clientX: x,
    clientY: y,
    button: 0
  }

  el.dispatchEvent(new MouseEvent("mouseover", opts))
  el.dispatchEvent(new MouseEvent("mousedown", opts))
  ;(el as HTMLElement).focus?.()
  el.dispatchEvent(new MouseEvent("mouseup", opts))
  el.dispatchEvent(new MouseEvent("click", opts))
}

/**
 * 给输入框赋值并触发框架能感知的事件。
 *
 * 直接改 value 不会触发 Vue/React 的响应式更新，这里走原生 setter
 * 再手动派发 input/change，保证表单状态同步。
 */
function setInputValue(el: Element, value: string): void {
  const input = el as HTMLInputElement | HTMLTextAreaElement
  const proto = Object.getPrototypeOf(input)
  const desc = Object.getOwnPropertyDescriptor(proto, "value")
  if (desc?.set) desc.set.call(input, value)
  else input.value = value

  input.dispatchEvent(new Event("input", { bubbles: true }))
  input.dispatchEvent(new Event("change", { bubbles: true }))
}

function elementInfo(el: Element): Record<string, unknown> {
  const rect = el.getBoundingClientRect()
  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || undefined,
    className: typeof el.className === "string" ? el.className || undefined : undefined,
    text: (el.textContent || "").trim().slice(0, 300),
    value: (el as HTMLInputElement).value?.slice?.(0, 300),
    href: (el as HTMLAnchorElement).href || undefined,
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.round(rect.width),
      h: Math.round(rect.height)
    }
  }
}

/** 抽取页面结构：标题、正文文本、标题层级、链接 —— 供模型阅读 */
function extractPage(ctx: ExecContext, selector?: string) {
  const root = selector ? queryOne(ctx, selector) : ctx.doc.body
  if (!root) throw new Error(`未找到元素：${selector}`)

  const text = (root as HTMLElement).innerText || root.textContent || ""
  const headings = Array.from(ctx.doc.querySelectorAll("h1,h2,h3"))
    .map((h) => (h.textContent || "").trim())
    .filter(Boolean)
    .slice(0, 30)
  const links = Array.from(ctx.doc.querySelectorAll("a[href]"))
    .map((a) => ({
      text: (a.textContent || "").trim().slice(0, 80),
      href: (a as HTMLAnchorElement).href
    }))
    .filter((l) => l.text)
    .slice(0, 60)

  return {
    url: ctx.win.location.href,
    title: ctx.doc.title,
    headings,
    links,
    text: text.slice(0, 20000)
  }
}

/** 高亮标注：套一层边框和气泡，只改样式不做任何交互 */
function highlight(ctx: ExecContext, selector: string, label?: string) {
  const el = queryOne(ctx, selector)
  if (!el) throw new Error(`未找到元素：${selector}`)

  const id = "cagent-hl-" + Math.random().toString(36).slice(2, 9)
  const marker = ctx.doc.createElement("div")
  marker.id = id
  marker.style.cssText = [
    "position:absolute",
    "pointer-events:none",
    "z-index:2147483646",
    "border:3px solid #ef4444",
    "border-radius:6px",
    "box-shadow:0 0 0 9999px rgba(15,23,42,0.35)",
    "transition:all .2s ease"
  ].join(";")

  const rect = el.getBoundingClientRect()
  const scrollX = ctx.win.scrollX || ctx.doc.documentElement.scrollLeft
  const scrollY = ctx.win.scrollY || ctx.doc.documentElement.scrollTop
  marker.style.left = `${rect.left + scrollX - 4}px`
  marker.style.top = `${rect.top + scrollY - 4}px`
  marker.style.width = `${rect.width + 8}px`
  marker.style.height = `${rect.height + 8}px`

  if (label) {
    const tip = ctx.doc.createElement("div")
    tip.textContent = label
    tip.style.cssText = [
      "position:absolute",
      "left:0",
      "top:-30px",
      "padding:4px 8px",
      "font-size:12px",
      "line-height:1.4",
      "color:#fff",
      "background:#ef4444",
      "border-radius:4px",
      "white-space:nowrap",
      "font-family:system-ui,sans-serif"
    ].join(";")
    marker.appendChild(tip)
  }

  ctx.doc.body.appendChild(marker)
  el.scrollIntoView({ behavior: "smooth", block: "center" })

  return { highlighted: selector, label: label ?? null, markerId: id }
}

/**
 * 执行一个动作。抛出的错误由调用方捕获并回填给服务端。
 */
export async function executeLocalAction(
  ctx: ExecContext,
  action: LocalAction
): Promise<LocalActionResult> {
  const started = Date.now()
  const timeout = action.timeout ?? DEFAULT_TIMEOUT
  const selector = (action.selector || "").trim()
  const value = action.value ?? ""

  const done = (partial: Omit<LocalActionResult, "durationMs" | "ok"> = {}) => ({
    ok: true,
    url: ctx.win.location.href,
    title: ctx.doc.title,
    durationMs: Date.now() - started,
    ...partial
  })

  const needSelector = () => {
    if (!selector) throw new Error(`动作 ${action.action} 需要提供选择器`)
  }

  switch (action.action) {
    case "goto": {
      if (!value) throw new Error("goto 需要提供目标地址")
      // 站内可同源跳转；跨域交给扩展或新标签页，这里直接跳当前窗口
      ctx.win.location.href = value
      return done({ result: { navigatedTo: value } })
    }

    case "click": {
      needSelector()
      const el = await waitForElement(ctx, selector, timeout)
      el.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior })
      realClick(el, ctx)
      return done({ result: { clicked: elementInfo(el) } })
    }

    case "type": {
      needSelector()
      const el = await waitForElement(ctx, selector, timeout)
      ;(el as HTMLElement).focus?.()
      setInputValue(el, value)
      return done({ result: { typed: value, into: elementInfo(el) } })
    }

    case "press": {
      needSelector()
      const el = await waitForElement(ctx, selector, timeout)
      const key = value || "Enter"
      const opts: KeyboardEventInit = { key, bubbles: true, cancelable: true }
      el.dispatchEvent(new KeyboardEvent("keydown", opts))
      el.dispatchEvent(new KeyboardEvent("keypress", opts))
      el.dispatchEvent(new KeyboardEvent("keyup", opts))
      // Enter 常伴随表单提交，补一个默认行为
      if (key === "Enter") {
        const form = (el as HTMLElement).closest("form")
        if (form && typeof form.requestSubmit === "function") {
          form.requestSubmit()
        }
      }
      return done({ result: { pressed: key } })
    }

    case "select": {
      needSelector()
      const el = await waitForElement(ctx, selector, timeout)
      const select = el as HTMLSelectElement
      select.value = value
      select.dispatchEvent(new Event("change", { bubbles: true }))
      return done({ result: { selected: value } })
    }

    case "waitFor": {
      needSelector()
      const el = await waitForElement(ctx, selector, timeout)
      return done({ result: { found: elementInfo(el) } })
    }

    case "wait": {
      const ms = Math.min(Number(value) || 1000, 30_000)
      await new Promise((r) => setTimeout(r, ms))
      return done({ result: { waitedMs: ms } })
    }

    case "extract": {
      return done({ result: extractPage(ctx, selector || undefined) })
    }

    case "evaluate": {
      if (!value) throw new Error("evaluate 需要提供脚本")
      /*
       * 用 Function 构造而不是 eval：
       * 支持 `() => document.title` 与 `return document.title` 两种写法，
       * 并统一包成函数体执行。
       */
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const fn = new Function(
        "document",
        "window",
        `"use strict";return (async () => { ${value} })()`
      ) as (d: Document, w: Window) => Promise<unknown>
      const raw = await fn(ctx.doc, ctx.win)
      // 只回传可序列化结果，避免循环引用导致上报失败
      let serializable: unknown = raw
      try {
        serializable = JSON.parse(JSON.stringify(raw ?? null))
      } catch {
        serializable = String(raw)
      }
      return done({ result: serializable })
    }

    case "scroll": {
      const dy = Number(value) || 600
      ctx.win.scrollBy({ top: dy, behavior: "smooth" })
      await new Promise((r) => setTimeout(r, 300))
      return done({ result: { scrolledBy: dy, scrollY: ctx.win.scrollY } })
    }

    case "screenshot": {
      if (!ctx.capture) {
        return {
          ok: false,
          error:
            "当前客户端不支持截图。网页端受浏览器限制无法截图页面，" +
            "需要安装 CAgent 浏览器扩展后可用。",
          durationMs: Date.now() - started,
          url: ctx.win.location.href,
          title: ctx.doc.title
        }
      }
      const shot = await ctx.capture()
      return done({ screenshot: shot ?? undefined, result: { captured: !!shot } })
    }

    case "highlight": {
      needSelector()
      return done({ result: highlight(ctx, selector, value || undefined) })
    }

    default:
      throw new Error(`不支持的动作：${action.action}`)
  }
}
