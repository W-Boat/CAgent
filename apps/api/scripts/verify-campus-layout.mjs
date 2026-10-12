/**
 * 校园导览前端「结构体检」：不靠肉眼，用 DOM 几何量证明布局是对的。
 *
 * 校验点：
 *   1. 网页画面真的加载出来了（naturalWidth > 0，不是破图）
 *   2. 悬浮提示框在网页画面的**下方**且与画面有重叠（悬浮），未被裁掉
 *   3. 提示框没有超出视口、没有盖住顶部工具条
 *   4. 分步提示逐条可见，复选框与「指给我看」按钮都可点
 *   5. CAS 落点提醒确实渲染成橙色警告
 *   6. 关键文案可读（非空、未被省略号截断到不可用）
 *
 * 用法：cd apps/api && node scripts/verify-campus-layout.mjs
 */
import { chromium } from "playwright"

const BASE = process.env.WEB_BASE || "http://127.0.0.1:5173"
const EMAIL = process.env.SHOOT_EMAIL || "admin@cagent.local"
const PASSWORD = process.env.SHOOT_PASSWORD || "CHANGE_ME_SEED_ADMIN_PASSWORD"

const ok = (label, cond, extra = "") =>
  console.log(`${cond ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`)

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: 1680, height: 1180 },
  locale: "zh-CN"
})
const page = await context.newPage()
const errors = []
page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)))

// 登录
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" })
await page.fill('input[type="text"]', EMAIL)
await page.fill('input[type="password"]', PASSWORD)
await page.click(".submit-btn")
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 })

// 打开导览并检索
await page.goto(`${BASE}/campus`, { waitUntil: "networkidle", timeout: 30000 })
await page.fill('input[placeholder*="要办什么事"]', "校园卡丢了怎么补办")
await page.keyboard.press("Enter")
console.log("⏳ 等待真实页面画面…")
await page.waitForSelector(".screen-img", { timeout: 90000 })
await page.waitForTimeout(3000)

// ---- 1. 画面真的是图片，不是破图 ----
const landedUrl = (await page.locator(".url-pill").innerText()).replace(/\s+/g, " ").trim()
console.log(`   落点地址：${landedUrl.slice(0, 120)}`)

// 清场：上一次体检可能留下已勾选的步骤，先把所有勾去掉，
// 保证接下来的交互断言从「全部未完成」这个确定状态出发。
const checkedCount = await page.locator(".hint-step .el-checkbox.is-checked").count()
for (let i = 0; i < checkedCount; i++) {
  await page.locator(".hint-step .el-checkbox.is-checked").first().click()
  await page.waitForTimeout(700)
}
const afterClean = (await page.locator(".hint-head-left").innerText()).replace(/\s+/g, " ")
console.log(`   清场后进度：${afterClean}（原有 ${checkedCount} 项已勾选）`)

const img = await page.evaluate(async () => {
  const el = document.querySelector(".screen-img")
  if (!el) return null
  // 轮询换 src 时图片会短暂回到 0x0，等它解码完再断言，否则是测自己的手速
  if (!el.complete || el.naturalWidth === 0) {
    await new Promise((resolve) => {
      const done = () => resolve()
      el.addEventListener("load", done, { once: true })
      el.addEventListener("error", done, { once: true })
      setTimeout(done, 8000)
    })
  }
  const r = el.getBoundingClientRect()
  return {
    naturalWidth: el.naturalWidth,
    naturalHeight: el.naturalHeight,
    complete: el.complete,
    width: Math.round(r.width),
    height: Math.round(r.height),
    src: el.getAttribute("src")
  }
})
ok("网页画面已加载（非破图）", !!img && img.complete && img.naturalWidth > 0,
  img ? `${img.naturalWidth}x${img.naturalHeight} 源图 → 显示 ${img.width}x${img.height}` : "未找到 .screen-img")
ok("画面地址指向后端静态画面", !!img?.src?.includes("/static/"), img?.src?.slice(0, 80))

// ---- 2. 悬浮提示框的位置关系 ----
const geo = await page.evaluate(() => {
  const dock = document.querySelector(".hint-dock")
  const screen = document.querySelector(".screen")
  const bar = document.querySelector(".stage-bar")
  const head = document.querySelector(".hint-head")
  const body = document.querySelector(".hint-body")
  if (!dock || !screen) return null
  const d = dock.getBoundingClientRect()
  const s = screen.getBoundingClientRect()
  const b = bar?.getBoundingClientRect()
  return {
    dock: { top: Math.round(d.top), bottom: Math.round(d.bottom), left: Math.round(d.left), width: Math.round(d.width) },
    screen: { top: Math.round(s.top), bottom: Math.round(s.bottom), left: Math.round(s.left), width: Math.round(s.width) },
    barBottom: b ? Math.round(b.bottom) : null,
    headText: head?.innerText?.replace(/\s+/g, " ").trim().slice(0, 60) ?? "",
    bodyHeight: body ? Math.round(body.getBoundingClientRect().height) : 0,
    bodyScrollable: body ? body.scrollHeight > body.clientHeight : false,
    viewportH: window.innerHeight,
    viewportW: window.innerWidth
  }
})
if (!geo) {
  ok("悬浮提示框存在", false)
} else {
  ok("悬浮提示框存在", true, `高 ${geo.dock.bottom - geo.dock.top}px，宽 ${geo.dock.width}px`)
  ok("提示框位于网页画面区域内（悬浮在画面之上）",
    geo.dock.top > geo.screen.top && geo.dock.bottom <= geo.screen.bottom + 1,
    `画面 ${geo.screen.top}~${geo.screen.bottom}，提示框 ${geo.dock.top}~${geo.dock.bottom}`)
  ok("提示框贴在画面底部", geo.screen.bottom - geo.dock.bottom <= 24,
    `距底 ${geo.screen.bottom - geo.dock.bottom}px`)
  ok("提示框没有压住顶部工具条", geo.barBottom === null || geo.dock.top >= geo.barBottom,
    `工具条底 ${geo.barBottom}，提示框顶 ${geo.dock.top}`)
  ok("提示框在视口内（未被裁掉）",
    geo.dock.bottom <= geo.viewportH + 1 && geo.dock.left >= 0 &&
    geo.dock.left + geo.dock.width <= geo.viewportW + 1,
    `视口 ${geo.viewportW}x${geo.viewportH}`)
  ok("提示框正文有可见高度", geo.bodyHeight > 120, `${geo.bodyHeight}px${geo.bodyScrollable ? "（内部可滚动）" : ""}`)
}

// ---- 3. 分步提示逐条可见、控件可交互 ----
const steps = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll(".hint-step"))
  return rows.map((r) => {
    const box = r.getBoundingClientRect()
    const cb = r.querySelector(".el-checkbox")
    const btn = Array.from(r.querySelectorAll("button")).find((b) => b.innerText.includes("指给我看"))
    const text = r.querySelector(".step-text")
    return {
      h: Math.round(box.height),
      w: Math.round(box.width),
      hasCheckbox: !!cb,
      checkboxDisabled: cb ? cb.classList.contains("is-disabled") : true,
      hasButton: !!btn,
      buttonDisabled: btn ? btn.disabled : true,
      textLen: (text?.innerText || "").trim().length,
      // 文本是否被压得看不到：行高与容器高度是否匹配
      clipped: text ? text.scrollHeight > text.clientHeight + 2 : false
    }
  })
})
ok("分步提示渲染出多行", steps.length > 1, `${steps.length} 条`)
ok("每条都有复选框且可点", steps.every((s) => s.hasCheckbox && !s.checkboxDisabled))
ok("每条都有「指给我看」且可点", steps.every((s) => s.hasButton && !s.buttonDisabled))
ok("每条提示文字非空", steps.every((s) => s.textLen > 0),
  `最短 ${Math.min(...steps.map((s) => s.textLen))} 字`)
ok("没有文字被裁切", steps.every((s) => !s.clipped))

// ---- 4. 事实网格与横幅 ----
const facts = await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll(".hint-facts .fact"))
  const banner = document.querySelector(".hint-banner")
  const warns = Array.from(document.querySelectorAll(".hint-warn")).map((w) => w.innerText.trim())
  const keys = items.map((i) => i.querySelector(".fact-k")?.innerText?.trim()).filter(Boolean)
  const zero = items.filter((i) => {
    const v = i.querySelector(".fact-v")
    return !v || !v.innerText.trim()
  }).length
  return {
    count: items.length,
    keys,
    zero,
    banner: banner?.innerText?.replace(/\s+/g, " ").trim() ?? "",
    warns
  }
})
ok("关键信息网格已渲染且无空值", facts.count > 0 && facts.zero === 0,
  `${facts.count} 项：${facts.keys.join("、")}`)
ok("顶部一句话横幅非空", facts.banner.length > 10, facts.banner.slice(0, 80))
ok("CAS 登录落点提醒已展示", facts.warns.some((w) => w.includes("统一身份认证")),
  facts.warns[0]?.slice(0, 70) ?? "（无警告）")

// ---- 5. 政策提示与核实时间 ----
const foot = await page.evaluate(() => {
  const head = document.querySelector(".hint-head-left")
  const url = document.querySelector(".foot-url")
  const t = document.querySelector(".hint-foot .muted")
  return {
    head: head?.innerText?.replace(/\s+/g, " ").trim() ?? "",
    url: url?.innerText?.trim() ?? "",
    verified: t?.innerText?.trim() ?? "",
    hasCopy: !!Array.from(document.querySelectorAll(".hint-foot button")).find((b) =>
      b.innerText.includes("复制入口")
    )
  }
})
ok("明确标注「只打开，不代办」", foot.head.includes("只打开，不代办"), foot.head)
ok("给出入口链接", foot.url.startsWith("http"), foot.url.slice(0, 70))
ok("给出数据核实时间", /2026-09-23/.test(foot.verified), foot.verified.slice(0, 70))
ok("有「复制入口」按钮", foot.hasCopy)

// ---- 6. 交互：勾选 → 进度更新；取消勾选 → 回退 ----
const cb = page.locator(".hint-step .el-checkbox").first()
const progressText = async () =>
  (await page.locator(".hint-head-left").innerText()).replace(/\s+/g, " ")

await cb.click()
// 先看乐观更新是否立刻生效，再等服务端回执
const immediate = await progressText()
ok("勾选后立刻出现进度（乐观更新）", immediate.includes("已完成 1/"), immediate)
await page.waitForTimeout(1500)
const afterCheck = await progressText()
ok("服务端确认后进度仍为 1", afterCheck.includes("已完成 1/"), afterCheck)

await cb.click()
await page.waitForTimeout(1500)
const afterUncheck = await progressText()
ok("取消勾选后进度回退", !afterUncheck.includes("已完成 1/"), afterUncheck)

// 落库校验：勾上第 2 步后直接问后端要记录，确认进度真的写进了数据库，
// 而不是只活在前端内存里。
await page.locator(".hint-step .el-checkbox").nth(1).click()
await page.waitForTimeout(2000)

const persisted = await page.evaluate(async () => {
  const token = localStorage.getItem("cagent.accessToken")
  if (!token) return { error: "未取到登录态" }
  const res = await fetch("/api/campus/runs?page=1&pageSize=1", {
    headers: { Authorization: `Bearer ${token}` }
  })
  const json = await res.json()
  const run = json?.data?.items?.[0]
  return {
    runId: run?.id,
    progress: run?.stepProgress ?? null,
    currentStep: run?.currentStep ?? null
  }
})
const doneKeys = Object.entries(persisted.progress || {})
  .filter(([, v]) => v === true)
  .map(([k]) => k)
ok("步骤进度已落库", doneKeys.length > 0,
  `记录 ${persisted.runId ?? "-"} 已完成第 ${doneKeys.join(",") || "无"} 步，currentStep=${persisted.currentStep}`)

// 收尾：清掉勾选，不给下次留状态
const toClean = await page.locator(".hint-step .el-checkbox.is-checked").count()
for (let i = 0; i < toClean; i++) {
  await page.locator(".hint-step .el-checkbox.is-checked").first().click()
  await page.waitForTimeout(700)
}
console.log(`   已清理 ${toClean} 项勾选`)

// ---- 7. 后台页面结构 ----
await page.goto(`${BASE}/admin/campus-runs`, { waitUntil: "networkidle", timeout: 30000 })
await page.waitForTimeout(1500)
const runsRows = await page.locator(".el-table__body tr").count()
const hasProgress = await page.locator(".el-progress").count()
ok("导览记录表有数据行", runsRows > 0, `${runsRows} 行`)
ok("记录表有进度条", hasProgress > 0, `${hasProgress} 条`)

await page.goto(`${BASE}/admin/campus-stats`, { waitUntil: "networkidle", timeout: 30000 })
await page.waitForTimeout(3000)
const charts = await page.evaluate(() => {
  const holders = Array.from(document.querySelectorAll(".chart-holder"))
  return holders.map((h) => {
    const canvas = h.querySelector("canvas")
    const r = h.getBoundingClientRect()
    return {
      w: Math.round(r.width),
      h: Math.round(r.height),
      hasCanvas: !!canvas,
      canvasW: canvas?.width ?? 0,
      canvasH: canvas?.height ?? 0,
      // 统计非空白像素比例，确认图真的画出来了
      inked: (() => {
        if (!canvas) return 0
        try {
          const ctx = canvas.getContext("2d")
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
          let n = 0
          for (let i = 3; i < data.length; i += 4 * 97) if (data[i] > 0) n++
          return Math.round((n / (data.length / (4 * 97))) * 100)
        } catch {
          return -1
        }
      })()
    }
  })
})
ok("统计页渲染出图表容器", charts.length >= 2, `${charts.length} 个`)
ok("图表有非零尺寸", charts.every((c) => c.w > 100 && c.h > 100),
  charts.map((c) => `${c.w}x${c.h}`).join(", "))
// 空白 canvas 全透明（alpha 恒为 0），有线/饼就一定有非透明像素；
// 折线本身很细，占比天然只有几个百分点，所以阈值取 1%。
ok("图表 canvas 已绘制内容（非空白）", charts.every((c) => c.hasCanvas && c.inked >= 1),
  charts.map((c) => `${c.inked}% 非透明`).join(", "))
ok("空数据提示未误显示", await page.locator(".empty-block").count() === 0 ||
  (await page.locator(".chart-holder").count()) > 0)

ok("全程无前端运行时错误", errors.length === 0, errors.slice(0, 3).join(" | "))

await browser.close()
console.log("\n结构体检完成")
process.exit(0)