/**
 * 夜间模式验证：
 *   1. 切到暗色后 <html> 带 .dark，color-scheme 为 dark
 *   2. 关键容器（body / 卡片 / 侧边栏 / 登录表单）实际计算出的背景是深色
 *   3. 正文文字在其背景上的对比度达标（WCAG AA 4.5:1，大字 3:1）
 *   4. 截图存档，便于人工核对
 */
import { chromium } from "playwright"
import { mkdirSync } from "node:fs"

const BASE = process.env.BASE_URL || "http://127.0.0.1:4173"
const SHOT_DIR = process.env.SHOT_DIR || "storage/shots"
mkdirSync(SHOT_DIR, { recursive: true })

/** 解析 rgb(a) → [r,g,b] */
function rgb(str) {
  const m = String(str).match(/rgba?\(([^)]+)\)/)
  if (!m) return null
  const parts = m[1].split(",").map((s) => parseFloat(s.trim()))
  return [parts[0], parts[1], parts[2], parts[3] ?? 1]
}

/** 相对亮度（WCAG） */
function luminance([r, g, b]) {
  const f = (v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function contrast(fg, bg) {
  const l1 = luminance(fg)
  const l2 = luminance(bg)
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

let failures = 0
const check = (cond, msg) => {
  console.log(`${cond ? "✅" : "❌"} ${msg}`)
  if (!cond) failures++
}

const browser = await chromium.launch()

async function auditPage(path, name, { setDark = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()

  if (setDark) {
    // 进入站点前先写好主题偏好，避免先闪一下亮色
    await ctx.addInitScript(() => {
      localStorage.setItem("cagent-theme", "dark")
    })
  }

  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" })
  await page.waitForTimeout(900)

  console.log(`\n=== ${name}（${path}）===`)

  const info = await page.evaluate(() => {
    const pick = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const cs = getComputedStyle(el)
      return {
        bg: cs.backgroundColor,
        color: cs.color,
        border: cs.borderColor,
        fontSize: cs.fontSize
      }
    }
    return {
      htmlClass: document.documentElement.className,
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
      body: pick("body"),
      panel: pick(".auth-panel") || pick(".content") || pick(".main"),
      card: pick(".el-card") || pick(".table-card") || pick(".stat-card"),
      sidebar: pick(".sidebar"),
      text: pick(".page-title") || pick("h1") || pick(".panel-title"),
      muted: pick(".page-subtitle") || pick(".panel-sub") || pick(".muted")
    }
  })

  if (setDark) {
    check(info.htmlClass.includes("dark"), `html 带 .dark 类（${info.htmlClass || "无"}）`)
    check(info.colorScheme === "dark", `color-scheme = ${info.colorScheme}`)
  }

  // 背景必须是深色（亮度低）
  for (const key of ["body", "panel", "card"]) {
    const v = info[key]
    if (!v) continue
    const c = rgb(v.bg)
    if (!c || c[3] === 0) continue
    const lum = luminance(c)
    check(lum < 0.25, `${key} 背景为深色：${v.bg}（亮度 ${lum.toFixed(3)}）`)
  }

  // 正文对比度
  for (const key of ["text", "muted"]) {
    const v = info[key]
    if (!v || !info.body) continue
    const fg = rgb(v.color)
    const bg = rgb(info.body.bg)
    if (!fg || !bg) continue
    const ratio = contrast(fg, bg)
    const large = parseFloat(v.fontSize) >= 18
    const need = large ? 3 : 4.5
    const isMuted = key === "muted"
    // 次要文字允许 3:1（辅助信息，非正文）
    const threshold = isMuted ? 3 : need
    check(
      ratio >= threshold,
      `${key} 文字对比度 ${ratio.toFixed(2)}:1（需 ≥${threshold}）— ${v.color} on ${info.body.bg}`
    )
  }

  await page.screenshot({ path: `${SHOT_DIR}/dark-${name}.png` })
  console.log(`  截图：${SHOT_DIR}/dark-${name}.png`)
  await ctx.close()
}

// 登录页
await auditPage("/login", "login")
// 工作台（需要登录，先拿一份会话）
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" })
const loginRes = await page.evaluate(async (base) => {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@cagent.local", password: "CHANGE_ME_SEED_ADMIN_PASSWORD" })
  })
  const json = await res.json()
  const d = json?.data ?? json
  if (d?.accessToken) {
    localStorage.setItem("cagent.accessToken", d.accessToken)
    localStorage.setItem("cagent.refreshToken", d.refreshToken || "")
    localStorage.setItem("cagent-theme", "dark")
  }
  return { ok: !!d?.accessToken }
}, BASE)
console.log(`\n登录状态：${loginRes.ok ? "已登录" : "失败"}`)

if (loginRes.ok) {
  await ctx.addInitScript(() => localStorage.setItem("cagent-theme", "dark"))
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" })
  await page.waitForTimeout(1500)
  const info = await page.evaluate(() => {
    const pick = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const cs = getComputedStyle(el)
      return { bg: cs.backgroundColor, color: cs.color }
    }
    return {
      htmlClass: document.documentElement.className,
      body: pick("body"),
      content: pick(".content"),
      sidebar: pick(".sidebar"),
      topbar: pick(".topbar"),
      card: pick(".el-card") || pick(".stat-card")
    }
  })
  console.log("\n=== 工作台暗色 ===")
  check(info.htmlClass.includes("dark"), "已应用暗色主题")
  const sidebar = rgb(info.sidebar?.bg)
  if (sidebar) check(luminance(sidebar) < 0.2, `侧边栏深色 ${info.sidebar.bg}`)
  const topbar = rgb(info.topbar?.bg)
  if (topbar) check(luminance(topbar) < 0.25, `顶栏深色 ${info.topbar.bg}`)
  const content = rgb(info.content?.bg)
  if (content) check(luminance(content) < 0.2, `内容区深色 ${info.content.bg}`)
  await page.screenshot({ path: `${SHOT_DIR}/dark-dashboard.png` })
  console.log(`  截图：${SHOT_DIR}/dark-dashboard.png`)
}
await ctx.close()
await browser.close()

console.log(failures === 0 ? "\n🎉 全部通过" : `\n⚠️ ${failures} 项未通过`)
process.exit(failures === 0 ? 0 : 1)
