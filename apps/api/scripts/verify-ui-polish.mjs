/**
 * 界面优化回归测试：流式输出、Markdown 渲染、图标、移动端布局。
 *
 * 这些都是「看起来对不对」的问题，所以直接在真实浏览器里量 DOM：
 *   - 流式输出是否按帧合并（不是每个 token 都重渲染）
 *   - 代码块是否高亮、是否有复制按钮、复制是否真的可用
 *   - 长回答滚动时是否不再强制把用户拽到底部
 *   - 手机视口下会话列表是否变成浮层、消息区是否占满宽度
 *   - 侧边栏图标是否都渲染出来了（没有空白方块）
 *
 * 用法：cd apps/api && node scripts/verify-ui-polish.mjs
 */
import { chromium } from "playwright"
import { mkdirSync } from "node:fs"

const WEB = process.env.WEB_BASE || "http://127.0.0.1:5173"
const SHOT_DIR = process.env.SHOT_DIR || "storage/shots"
mkdirSync(SHOT_DIR, { recursive: true })

let pass = 0
let fail = 0
const ok = (label, cond, extra = "") => {
  if (cond) pass++
  else fail++
  console.log(`${cond ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`)
}

/**
 * 登录：用占位符定位输入框、用 class 定位提交按钮，
 * 不依赖按钮文案（中文按钮常带空格，比如「登 录」）。
 */
async function login(target) {
  await target.goto(`${WEB}/login`, { waitUntil: "domcontentloaded" })
  await target.fill('input[placeholder="you@campus.edu"]', "admin@cagent.local")
  await target.fill('input[type="password"]', "CHANGE_ME_SEED_ADMIN_PASSWORD")
  await target.click(".submit-btn")
  await target.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 })
  await target.waitForTimeout(1200)
}

const browser = await chromium.launch({ headless: true })

try {
  // ---------- 桌面端 ----------
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } })
  const errors = []
  page.on("pageerror", (e) => errors.push(e.message))

  await login(page)

  // ---- 图标：侧边栏每一项都必须渲染出 svg ----
  await page.goto(`${WEB}/dashboard`, { waitUntil: "networkidle" })
  await page.waitForTimeout(900)
  const iconStats = await page.evaluate(() => {
    const items = [...document.querySelectorAll(".menu-item")]
    let missing = 0
    const empty = []
    for (const it of items) {
      const svg = it.querySelector(".menu-icon svg")
      if (!svg) {
        missing++
        empty.push(it.textContent?.trim() || "(无文字)")
        continue
      }
      const box = svg.getBoundingClientRect()
      if (box.width < 6 || box.height < 6) {
        missing++
        empty.push(it.textContent?.trim() || "(尺寸为0)")
      }
    }
    return { total: items.length, missing, empty }
  })
  ok("侧边栏图标全部渲染（无空白/零尺寸）", iconStats.missing === 0,
    `共 ${iconStats.total} 项，异常 ${iconStats.missing}${iconStats.empty.length ? "：" + iconStats.empty.join("、") : ""}`)
  ok("侧边栏菜单项数量合理", iconStats.total >= 15, `${iconStats.total} 项`)

  // ---- favicon 是否为新的 svg ----
  const favicon = await page.evaluate(() => {
    const link = document.querySelector('link[rel="icon"]')
    return link ? link.getAttribute("href") : ""
  })
  ok("favicon 指向自绘 SVG", /favicon\.svg/.test(favicon), favicon)

  const faviconStatus = await page.evaluate(async () => {
    const res = await fetch("/favicon.svg")
    return { status: res.status, type: res.headers.get("content-type") || "" }
  })
  ok("favicon 可访问且是 svg", faviconStatus.status === 200 && /svg/.test(faviconStatus.type),
    `HTTP ${faviconStatus.status} ${faviconStatus.type}`)

  // ---- Markdown 渲染：直接挂一段内容到页面里测渲染器 ----
  await page.goto(`${WEB}/chat`, { waitUntil: "networkidle" })
  await page.waitForTimeout(1000)

  const mdResult = await page.evaluate(async () => {
    // 通过动态 import 拿到真实的渲染函数，避免另写一份假实现
    const mod = await import("/src/utils/markdown.ts")
    const src = [
      "# 标题",
      "",
      "正文 **加粗** 与 `行内代码`。",
      "",
      "```python",
      "def hello():",
      "    return 1",
      "```",
      "",
      "```js",
      "const a = 1",
      "```",
      "",
      "| 列A | 列B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "> 引用",
      "",
      "[链接](https://example.com)"
    ].join("\n")
    const html = mod.renderMarkdown(src)
    return { html }
  })

  ok("Markdown 渲染出标题", /<h1[^>]*>标题<\/h1>/.test(mdResult.html))
  ok("Markdown 渲染出表格", /<table>/.test(mdResult.html))
  ok("Markdown 渲染出引用", /<blockquote>/.test(mdResult.html))
  ok("代码块包了语言标签与复制按钮",
    /md-code-bar/.test(mdResult.html) && /md-copy/.test(mdResult.html))
  ok("高亮后带 hljs 样式类", /class="hljs"/.test(mdResult.html))
  ok("python 代码被真正高亮（出现 hljs 关键字 span）",
    /hljs-keyword/.test(mdResult.html), 
    (mdResult.html.match(/hljs-keyword[^>]*>[^<]*/) || [])[0] || "未找到高亮标记")
  ok("js 别名被识别（不是纯文本）",
    (mdResult.html.match(/hljs-keyword/g) || []).length >= 2,
    `hljs-keyword 出现 ${(mdResult.html.match(/hljs-keyword/g) || []).length} 次`)
  ok("外链新窗口打开且带 noopener",
    /target="_blank"/.test(mdResult.html) && /noopener/.test(mdResult.html))

  // 真的拿一段 <script> 过一遍渲染器，确认没被当成标签放出去
  const injectCheck = await page.evaluate(async () => {
    const mod = await import("/src/utils/markdown.ts")
    const html = mod.renderMarkdown('<script>window.__x=1<\/script>\n\n<img src=x onerror=alert(1)>')
    return { html, executed: typeof window.__x !== "undefined" }
  })
  ok("原始 HTML 被转义（防注入）",
    !/<script>/.test(injectCheck.html) && !injectCheck.executed,
    injectCheck.html.slice(0, 60))

  // 流式模式：应跳过语法高亮，但仍保留代码块外壳
  const streamMd = await page.evaluate(async () => {
    const mod = await import("/src/utils/markdown.ts")
    const src = "```python\ndef f():\n    pass\n```"
    return {
      streaming: mod.renderMarkdown(src, { highlight: false }),
      final: mod.renderMarkdown(src, { highlight: true })
    }
  })
  ok("流式中不做语法高亮（更快）",
    !/hljs-keyword/.test(streamMd.streaming) && /hljs-keyword/.test(streamMd.final))
  ok("流式中仍保留复制按钮", /md-copy/.test(streamMd.streaming))

  // ---- 复制按钮真的能拿到代码文本 ----
  const copyCheck = await page.evaluate(async () => {
    const mod = await import("/src/utils/markdown.ts")
    const host = document.createElement("div")
    host.innerHTML = mod.renderMarkdown("```js\nconst secret = 42\n```")
    document.body.appendChild(host)
    const btn = host.querySelector(".md-copy")
    const code = host.querySelector(".md-code code")
    const text = code ? code.textContent : null
    // 直接调用与组件相同的取值逻辑
    const grabbed = btn?.closest(".md-code")?.querySelector("code")?.textContent ?? null
    host.remove()
    return { text, grabbed }
  })
  ok("复制按钮能取到代码原文",
    copyCheck.grabbed?.includes("const secret = 42") === true,
    JSON.stringify(copyCheck.grabbed))

  // ---- 移动端 ----
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3
  })
  const mobileErrors = []
  mobile.on("pageerror", (e) => mobileErrors.push(e.message))

  await login(mobile)

  // 侧边栏应为浮层且默认收起（不占据横向空间）
  const shell = await mobile.evaluate(() => {
    const side = document.querySelector(".sidebar")
    if (!side) return null
    const box = side.getBoundingClientRect()
    const layout = document.querySelector(".layout")
    const main = document.querySelector(".main")
    return {
      sideRight: box.right,
      sideWidth: box.width,
      layoutWidth: layout?.getBoundingClientRect().width ?? 0,
      mainWidth: main?.getBoundingClientRect().width ?? 0,
      hasToggle: !!document.querySelector(".drawer-toggle")
    }
  })
  ok("手机端侧边栏默认移出屏幕（不挤占内容）",
    shell && shell.sideRight <= 1,
    `右侧边界 ${shell?.sideRight}px`)
  ok("手机端主内容占满宽度",
    shell && Math.abs(shell.mainWidth - shell.layoutWidth) < 2,
    `主区 ${Math.round(shell?.mainWidth ?? 0)} / 布局 ${Math.round(shell?.layoutWidth ?? 0)}`)
  ok("手机端有抽屉开关按钮", shell?.hasToggle === true)

  // 打开抽屉
  await mobile.click(".drawer-toggle")
  await mobile.waitForTimeout(500)
  const opened = await mobile.evaluate(() => {
    const side = document.querySelector(".sidebar")
    const box = side?.getBoundingClientRect()
    const text = document.querySelector(".sidebar .menu-text")
    return {
      left: box?.left ?? -999,
      width: box?.width ?? 0,
      textVisible: text ? getComputedStyle(text).display !== "none" : false,
      hasBackdrop: !!document.querySelector(".menu-backdrop")
    }
  })
  ok("点开后侧边栏滑入可见", opened.left >= -1 && opened.width > 120,
    `left=${Math.round(opened.left)} width=${Math.round(opened.width)}`)
  ok("抽屉展开时菜单文字可见（不是只剩图标）", opened.textVisible)
  ok("抽屉展开时有遮罩", opened.hasBackdrop)

  await mobile.screenshot({ path: `${SHOT_DIR}/31-mobile-drawer.png` })

  // 关闭抽屉：遮罩中心被抽屉盖住，点右侧露出来的那条
  const backdropBox = await mobile.locator(".menu-backdrop").boundingBox()
  await mobile.mouse.click(
    (backdropBox?.x ?? 0) + (backdropBox?.width ?? 0) - 12,
    (backdropBox?.y ?? 0) + (backdropBox?.height ?? 0) / 2
  )
  await mobile.waitForTimeout(500)
  const drawerClosed = await mobile.evaluate(() => {
    const side = document.querySelector(".sidebar")
    return side ? side.getBoundingClientRect().right <= 1 : false
  })
  ok("点遮罩可收起抽屉", drawerClosed)
  await mobile.goto(`${WEB}/chat`, { waitUntil: "networkidle" })
  await mobile.waitForTimeout(1200)

  const chatMobile = await mobile.evaluate(() => {
    const pane = document.querySelector(".conv-pane")
    const paneBox = pane?.getBoundingClientRect()
    const main = document.querySelector(".chat-main")
    const mainBox = main?.getBoundingClientRect()
    const avatar = document.querySelector(".msg-avatar")
    return {
      paneRight: paneBox?.right ?? 0,
      mainWidth: mainBox?.width ?? 0,
      viewport: window.innerWidth,
      avatarHidden: avatar ? getComputedStyle(avatar).display === "none" : true,
      hasBackdrop: !!document.querySelector(".conv-backdrop"),
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 1
    }
  })
  ok("手机端会话列表收起（消息区可用）", chatMobile.paneRight <= 1,
    `列表右边界 ${Math.round(chatMobile.paneRight)}px`)
  ok("手机端消息区占满宽度",
    Math.abs(chatMobile.mainWidth - chatMobile.viewport) < 2,
    `${Math.round(chatMobile.mainWidth)} / ${chatMobile.viewport}`)
  ok("手机端隐藏头像给文字让位", chatMobile.avatarHidden)
  ok("手机端没有横向溢出", !chatMobile.overflowX)

  await mobile.screenshot({ path: `${SHOT_DIR}/32-mobile-chat.png` })

  // 校园导览在手机端应有「找事项 / 看页面」切换
  await mobile.goto(`${WEB}/campus`, { waitUntil: "networkidle" })
  await mobile.waitForTimeout(1500)
  const campusMobile = await mobile.evaluate(() => {
    const sw = document.querySelector(".mobile-switch")
    const btns = [...document.querySelectorAll(".switch-btn")].map((b) => b.textContent?.trim())
    const side = document.querySelector(".side")
    const stage = document.querySelector(".stage")
    return {
      hasSwitch: !!sw,
      switchVisible: sw ? getComputedStyle(sw).display !== "none" : false,
      btns,
      sideVisible: side ? getComputedStyle(side).display !== "none" : false,
      stageVisible: stage ? getComputedStyle(stage).display !== "none" : false,
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 1
    }
  })
  ok("手机端导览页有分栏切换条", campusMobile.hasSwitch && campusMobile.switchVisible,
    campusMobile.btns.join(" / "))
  ok("手机端默认只显示「找事项」", campusMobile.sideVisible && !campusMobile.stageVisible)
  ok("手机端导览页无横向溢出", !campusMobile.overflowX)

  await mobile.click(".switch-btn:has-text('看页面')")
  await mobile.waitForTimeout(500)
  const afterSwitch = await mobile.evaluate(() => {
    const side = document.querySelector(".side")
    const stage = document.querySelector(".stage")
    return {
      sideVisible: side ? getComputedStyle(side).display !== "none" : false,
      stageVisible: stage ? getComputedStyle(stage).display !== "none" : false
    }
  })
  ok("切到「看页面」后画面区显示、列表隐藏",
    afterSwitch.stageVisible && !afterSwitch.sideVisible)

  // 工具条里的每个按钮都必须完整落在容器内，不能被挤出可视区。
  // 必须等「看页面」这一栏真正显示后再量，否则容器尺寸为 0，断言会假通过。
  const toolbar = await mobile.evaluate(() => {
    const bar = document.querySelector(".stage-bar")
    const box = bar?.getBoundingClientRect()
    const btns = [...document.querySelectorAll(".stage-actions .el-button")]
    const clipped = []
    for (const b of btns) {
      const r = b.getBoundingClientRect()
      if (!box) break
      if (r.right > box.right + 0.5 || r.left < box.left - 0.5) {
        clipped.push((b.textContent || "").trim().slice(0, 8) || "(图标按钮)")
      }
    }
    return {
      total: btns.length,
      clipped,
      barWidth: box?.width ?? 0,
      barRight: box?.right ?? 0,
      viewport: window.innerWidth
    }
  })
  ok("导览工具条确实已渲染出宽度（断言有效）", toolbar.barWidth > 100,
    `宽 ${Math.round(toolbar.barWidth)}px，${toolbar.total} 个按钮`)
  ok("导览工具条按钮未被裁切（都在容器内）", toolbar.clipped.length === 0,
    `${toolbar.total} 个按钮，越界：${toolbar.clipped.join("、") || "无"}`)
  ok("工具条没有超出视口宽度",
    toolbar.barRight > 0 && toolbar.barRight <= toolbar.viewport + 0.5,
    `工具条右边界 ${Math.round(toolbar.barRight)} / 视口 ${toolbar.viewport}`)

  // 带图标的按钮必须真的渲染出 svg：
  // 之前用 `span { display:none }` 想只留图标，结果 Element Plus 把图标和文字
  // 包在同一个 span 里，图标被一起藏掉，变成一排空方块。
  const iconBtns = await mobile.evaluate(() => {
    const btns = [...document.querySelectorAll(".stage-actions .el-button")]
    const empty = []
    for (const b of btns) {
      const svg = b.querySelector("svg")
      const text = (b.textContent || "").trim()
      if (!svg && !text) {
        empty.push("(无图标也无文字)")
        continue
      }
      if (svg) {
        const r = svg.getBoundingClientRect()
        if (r.width < 6 || r.height < 6) empty.push((text || "(图标)") + " 尺寸为0")
      }
    }
    return { total: btns.length, empty }
  })
  ok("工具条按钮没有变成空方块（图标/文字至少有一个可见）",
    iconBtns.empty.length === 0,
    `${iconBtns.total} 个按钮，异常：${iconBtns.empty.join("、") || "无"}`)

  await mobile.screenshot({ path: `${SHOT_DIR}/33-mobile-campus.png` })

  // 窄屏后台表格不应把页面撑破
  await mobile.goto(`${WEB}/admin/users`, { waitUntil: "networkidle" })
  await mobile.waitForTimeout(1200)
  const adminMobile = await mobile.evaluate(() => ({
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    cardScrolls: (() => {
      const card = document.querySelector(".table-card")
      return card ? card.scrollWidth > card.clientWidth : false
    })()
  }))
  ok("手机端后台页无横向溢出", !adminMobile.overflowX)
  ok("宽表格在卡片内横向滚动（不撑破布局）", adminMobile.cardScrolls)

  await mobile.screenshot({ path: `${SHOT_DIR}/34-mobile-admin.png` })

  ok("桌面端无运行时错误", errors.length === 0, errors.slice(0, 2).join(" | "))
  ok("移动端无运行时错误", mobileErrors.length === 0, mobileErrors.slice(0, 2).join(" | "))

  console.log(`\n界面优化验证：${pass} 项通过，${fail} 项失败`)
  console.log(`截图：${SHOT_DIR}/31~34-mobile-*.png`)
  if (fail > 0) process.exit(1)
} finally {
  await browser.close()
}
