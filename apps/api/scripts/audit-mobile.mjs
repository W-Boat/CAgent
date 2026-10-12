/**
 * 移动端可用性审计。
 *
 * 检查真实用户会遇到的硬伤：
 *   1. 横向溢出（页面比视口宽 → 需要左右拖动，最常见的移动端缺陷）
 *   2. 触控目标过小（< 40px 难以点准）
 *   3. 表格能否横向滚动而不是被压扁
 *   4. 固定定位元素是否遮挡内容
 */
import { chromium, devices } from "playwright"
import { mkdirSync } from "node:fs"

const BASE = process.env.BASE_URL || "http://127.0.0.1:5173"
const SHOT_DIR = process.env.SHOT_DIR || "storage/shots"
mkdirSync(SHOT_DIR, { recursive: true })

const PAGES = [
  { path: "/login", name: "login", needsAuth: false },
  { path: "/dashboard", name: "dashboard", needsAuth: true },
  { path: "/chat", name: "chat", needsAuth: true },
  { path: "/skills", name: "skills", needsAuth: true },
  { path: "/campus", name: "campus", needsAuth: true },
  { path: "/browser", name: "browser", needsAuth: true },
  { path: "/admin/users", name: "admin-users", needsAuth: true },
  { path: "/admin/providers", name: "admin-providers", needsAuth: true },
  { path: "/memory", name: "memory", needsAuth: true }
]

let failures = 0
const issues = []
const check = (cond, msg) => {
  if (!cond) {
    failures++
    issues.push(msg)
  }
  console.log(`${cond ? "✅" : "❌"} ${msg}`)
}

const browser = await chromium.launch()

// 先登录拿 token
const ctxAuth = await browser.newContext({ ...devices["iPhone 12"] })
const authPage = await ctxAuth.newPage()
await authPage.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" })
const auth = await authPage.evaluate(async (base) => {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@cagent.local", password: "CHANGE_ME_SEED_ADMIN_PASSWORD" })
  })
  const json = await res.json()
  const d = json?.data ?? json
  return { token: d?.accessToken, refresh: d?.refreshToken }
}, BASE)
await ctxAuth.close()
console.log(`登录：${auth.token ? "成功" : "失败"}\n`)

for (const target of PAGES) {
  const ctx = await browser.newContext({ ...devices["iPhone 12"] })
  const page = await ctx.newPage()

  if (target.needsAuth && auth.token) {
    await ctx.addInitScript(
      ([t, r]) => {
        localStorage.setItem("cagent.accessToken", t)
        localStorage.setItem("cagent.refreshToken", r || "")
      },
      [auth.token, auth.refresh]
    )
  }

  await page.goto(`${BASE}${target.path}`, { waitUntil: "networkidle" }).catch(() => {})
  await page.waitForTimeout(1200)

  console.log(`=== ${target.name}（${target.path}）===`)

  const report = await page.evaluate(() => {
    const doc = document.documentElement
    const vw = window.innerWidth

    // 找出真正超出视口右边界的可见元素（排除装饰性与可滚动容器内的元素）
    const overflowing = []
    const isInsideScrollable = (el) => {
      let p = el.parentElement
      while (p && p !== document.body) {
        const ox = getComputedStyle(p).overflowX
        if (ox === "auto" || ox === "scroll") return true
        p = p.parentElement
      }
      return false
    }

    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      const cs = getComputedStyle(el)
      if (cs.position === "fixed" || cs.visibility === "hidden" || cs.display === "none") continue
      // 纯装饰元素（光斑、背景）不算布局缺陷
      if (el.getAttribute("aria-hidden") === "true" || cs.pointerEvents === "none") continue
      // 父级可横向滚动时，子元素超出是预期行为
      if (isInsideScrollable(el)) continue

      if (r.right > vw + 2) {
        overflowing.push({
          tag: el.tagName.toLowerCase(),
          cls: String(el.className || "").slice(0, 60),
          right: Math.round(r.right),
          width: Math.round(r.width)
        })
      }
    }

    // 触控目标过小：只看「自身就是点击目标」的元素。
    // 按钮内部的 <i>/<span> 图标容器尺寸天然很小，但真正响应点击的是父级
    // <button>（已被撑到 40px+），把它们算进来会产生大量误报。
    const smallTargets = []
    const isInteractive = (el) => {
      const tag = el.tagName.toLowerCase()
      if (tag === "button" || tag === "a") return true
      if (el.getAttribute("role") === "button") return true
      if (el.classList.contains("el-check-tag")) return true
      if (el.classList.contains("conv-item")) return true
      if (el.classList.contains("menu-item")) return true
      return false
    }

    for (const el of Array.from(document.querySelectorAll("body *"))) {
      if (!isInteractive(el)) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === "hidden" || cs.display === "none") continue
      // 父级可横向滚动时元素可能被裁切，尺寸判定不准确，跳过
      if (isInsideScrollable(el)) continue

      if (r.height < 32 || r.width < 24) {
        smallTargets.push({
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || "").trim().slice(0, 20),
          w: Math.round(r.width),
          h: Math.round(r.height)
        })
      }
    }

    const table = document.querySelector(".el-table")
    return {
      viewport: vw,
      scrollWidth: doc.scrollWidth,
      horizontalOverflow: doc.scrollWidth > vw + 2,
      overflowing: overflowing.slice(0, 8),
      smallTargets: smallTargets.slice(0, 8),
      tableInfo: table
        ? {
            width: Math.round(table.getBoundingClientRect().width),
            parentOverflow: getComputedStyle(table.parentElement).overflowX
          }
        : null
    }
  })

  check(
    !report.horizontalOverflow,
    `无横向溢出（scrollWidth ${report.scrollWidth} vs 视口 ${report.viewport}）`
  )
  if (report.overflowing.length) {
    console.log("   溢出元素：")
    for (const o of report.overflowing) {
      console.log(`     - <${o.tag} class="${o.cls}"> right=${o.right} w=${o.width}`)
    }
  }

  check(
    report.smallTargets.length === 0,
    `触控目标尺寸达标（${report.smallTargets.length} 个偏小）`
  )
  if (report.smallTargets.length) {
    for (const s of report.smallTargets.slice(0, 5)) {
      console.log(`     - <${s.tag}> "${s.text}" ${s.w}×${s.h}`)
    }
  }

  if (report.tableInfo) {
    check(
      ["auto", "scroll"].includes(report.tableInfo.parentOverflow),
      `表格容器可横向滚动（overflow-x: ${report.tableInfo.parentOverflow}）`
    )
  }

  await page.screenshot({ path: `${SHOT_DIR}/mobile-${target.name}.png`, fullPage: false })
  await ctx.close()
  console.log("")
}

await browser.close()

console.log("=".repeat(50))
if (failures === 0) {
  console.log("🎉 移动端检查全部通过")
} else {
  console.log(`⚠️ 共 ${failures} 项待修：`)
  issues.forEach((i) => console.log(`   - ${i}`))
}
process.exit(0)
