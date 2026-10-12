/**
 * 流式输出优化回归测试。
 *
 * 要证明的事：模型吐出几十个 token 时，DOM 不应被重写几十次。
 * 做法是在真实浏览器里发一条会触发流式回答的消息，
 * 用 MutationObserver 数 markdown 容器的实际改写次数，与后端发出的
 * text 事件数对比。
 *
 * 用法：cd apps/api && node scripts/verify-streaming.mjs
 */
import { chromium } from "playwright"

const WEB = process.env.WEB_BASE || "http://127.0.0.1:5173"
const PROMPT = "用大约 200 字介绍一下中国社会科学院大学，分三段。"

let pass = 0
let fail = 0
const ok = (label, cond, extra = "") => {
  if (cond) pass++
  else fail++
  console.log(`${cond ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`)
}

/**
 * 在 Node 侧直接跑一次同样的提问，数出后端到底发了多少个 text 事件。
 *
 * 为什么不从浏览器里数：Playwright 的 response 钩子拿不到已被应用消费的
 * 流式 body（读到的是空串），而在页面里替换 window.fetch 也拦不到——
 * 应用的 streamChat 在模块加载时就已经持有原始 fetch 引用了。
 * 同一模型、同一提问，事件数量级与实际使用一致，作为对照足够可靠。
 */
async function countServerTextEvents(prompt) {
  const API = process.env.API_BASE || "http://127.0.0.1:3001/api"
  const login = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@cagent.local", password: "CHANGE_ME_SEED_ADMIN_PASSWORD" })
  }).then((r) => r.json())
  const token = login.data.accessToken

  const models = await fetch(`${API}/models`, {
    headers: { Authorization: `Bearer ${token}` }
  }).then((r) => r.json())
  const model = models.data.find((m) => m.key === "deepseek-chat") || models.data[0]

  const res = await fetch(`${API}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ content: prompt, modelId: model.id })
  })
  const text = await res.text()
  return (text.match(/event:\s*text/g) || []).length
}

const browser = await chromium.launch({ headless: true })

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } })
  const errors = []
  page.on("pageerror", (e) => errors.push(e.message))

  await page.goto(`${WEB}/login`, { waitUntil: "domcontentloaded" })
  await page.fill('input[placeholder="you@campus.edu"]', "admin@cagent.local")
  await page.fill('input[type="password"]', "CHANGE_ME_SEED_ADMIN_PASSWORD")
  await page.click(".submit-btn")
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 })
  await page.waitForTimeout(1000)

  await page.goto(`${WEB}/chat`, { waitUntil: "networkidle" })
  await page.waitForTimeout(1200)

  // 统计 DOM 改写次数与动画帧数
  await page.evaluate(() => {
    window.__stats = { domWrites: 0, frames: 0 }
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        const el = r.target instanceof Element ? r.target : r.target.parentElement
        if (el?.closest?.(".markdown-body")) window.__stats.domWrites++
      }
    })
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })

    const tick = () => {
      window.__stats.frames++
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })

  // 对照组：后端一次同样提问会发多少个 text 事件
  let textEvents = 0
  try {
    textEvents = await countServerTextEvents(PROMPT)
  } catch (err) {
    console.log(`   ⚠️ 对照请求失败：${err.message}`)
  }

  // 浏览器里发同一条消息
  await page.fill(".composer-box textarea", PROMPT)
  await page.press(".composer-box textarea", "Enter")

  await page.waitForFunction(() => window.__stats && window.__stats.domWrites > 0, {
    timeout: 60000
  })

  // 等流式结束：连续 1.6s 没有新的 DOM 改写
  let last = -1
  let stable = 0
  for (let i = 0; i < 90; i++) {
    const now = await page.evaluate(() => window.__stats.domWrites)
    if (now === last) {
      stable++
      if (stable >= 4) break
    } else {
      stable = 0
      last = now
    }
    await page.waitForTimeout(400)
  }
  await page.waitForTimeout(1200)

  const stats = await page.evaluate(() => window.__stats)

  ok("对照组收到了流式文本事件", textEvents > 3, `${textEvents} 个 text 事件`)
  ok("回答被分帧写入 DOM（不是一次性出现）", stats.domWrites > 1,
    `DOM 改写 ${stats.domWrites} 次`)
  ok(
    "DOM 改写次数少于文本事件数（按帧合并生效）",
    textEvents > 0 && stats.domWrites < textEvents,
    `DOM 改写 ${stats.domWrites} 次 vs 文本事件 ${textEvents} 个` +
      (textEvents > 0
        ? `（少写了 ${(100 - (stats.domWrites / textEvents) * 100).toFixed(0)}%）`
        : "")
  )

  // 回答内容确实渲染成了 HTML（不是纯文本）
  const rendered = await page.evaluate(() => {
    const bodies = [...document.querySelectorAll(".markdown-body")]
    const last = bodies[bodies.length - 1]
    return {
      textLength: last?.textContent?.trim().length ?? 0,
      hasParagraph: !!last?.querySelector("p"),
      stillStreaming: !!last?.classList.contains("is-streaming"),
      cursorGone: !document.querySelector(".cursor")
    }
  })
  ok("回答已渲染进 markdown 容器", rendered.textLength > 60, `${rendered.textLength} 字`)
  ok("渲染成了段落结构", rendered.hasParagraph)
  ok("流式结束后移除 is-streaming 类", !rendered.stillStreaming)
  ok("流式结束后光标消失", rendered.cursorGone)

  // 流式期间不跑语法高亮，结束后补上
  const mdModes = await page.evaluate(async () => {
    const mod = await import("/src/utils/markdown.ts")
    const src = "```python\ndef f():\n    pass\n```"
    return {
      streamingHasKeyword: /hljs-keyword/.test(mod.renderMarkdown(src, { highlight: false })),
      finalHasKeyword: /hljs-keyword/.test(mod.renderMarkdown(src, { highlight: true })),
      streamingHasCopy: /md-copy/.test(mod.renderMarkdown(src, { highlight: false })),
      finalHasCopy: /md-copy/.test(mod.renderMarkdown(src, { highlight: true }))
    }
  })
  ok("流式中跳过语法高亮（省算力）", !mdModes.streamingHasKeyword)
  ok("流式结束后补上高亮", mdModes.finalHasKeyword)
  ok("两种模式都保留复制按钮", mdModes.streamingHasCopy && mdModes.finalHasCopy)

  ok("流式过程无运行时错误", errors.length === 0, errors.slice(0, 2).join(" | "))

  console.log(`\n流式优化验证：${pass} 项通过，${fail} 项失败`)
  console.log(
    `统计：对照组 text 事件 ${textEvents}，浏览器 DOM 改写 ${stats.domWrites}，动画帧 ${stats.frames}`
  )
  if (fail > 0) process.exit(1)
} finally {
  await browser.close()
}
