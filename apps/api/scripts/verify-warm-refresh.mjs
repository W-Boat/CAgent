/**
 * 验证缓存页面的「后台刷新」不会在已有内容上闪遮罩。
 *
 * 设计意图：切回缓存页面时立即显示旧数据，若数据已过期则在后台悄悄刷新。
 * 但如果刷新时把 loading 置 true，`v-loading` 会在已有内容上盖一层遮罩 ——
 * 用户会看到「内容 → 遮罩 → 内容」的闪烁，比不刷新更糟。
 */
import { chromium } from "playwright"

const BASE = process.env.BASE_URL || "http://127.0.0.1:4173"
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" })
await page.waitForTimeout(1500)
await page.evaluate(async (base) => {
  const r = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@cagent.local", password: "CHANGE_ME_SEED_ADMIN_PASSWORD" })
  })
  const j = await r.json()
  const d = j.data ?? j
  localStorage.setItem("cagent.accessToken", d.accessToken)
  localStorage.setItem("cagent.refreshToken", d.refreshToken || "")
}, BASE)

await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" })
await page.waitForTimeout(2500)

// 先进一次审计日志，让它被缓存
await page.locator('.menu-item:has-text("审计日志")').first().click()
await page.waitForTimeout(2000)
await page.locator('.menu-item:has-text("我的记忆")').first().click()
await page.waitForTimeout(1500)

/*
 * 关键实验：把 staleAfter 的等待时间缩短到不可行，
 * 直接改用「篡改页面内时间感」的方式不现实；
 * 改为观察真实行为 —— 立刻切回（不算过期）与
 * 等待超过阈值后切回（算过期），两种情况的遮罩表现。
 */
async function observeReturn(label, waitMs, note) {
  await page.locator('.menu-item:has-text("我的记忆")').first().click()
  await page.waitForTimeout(1200)

  if (waitMs > 0) {
    console.log(`  （等待 ${Math.round(waitMs / 1000)}s 让数据过期…）`)
    await page.waitForTimeout(waitMs)
  }

  const trace = await page.evaluate(async (target) => {
    const out = []
    const t0 = performance.now()

    // 采样遮罩视觉可见性 + 表格行数
    let lastKey = ""
    const sample = () => {
      const masks = Array.from(document.querySelectorAll(".el-loading-mask"))
      const visible = masks.some((m) => parseFloat(getComputedStyle(m).opacity) > 0.05)
      const rows = document.querySelectorAll(".el-table__row").length
      const key = `${visible}/${rows > 0 ? "数据" : "空"}`
      if (key !== lastKey) {
        lastKey = key
        out.push({
          t: Math.round(performance.now() - t0),
          maskVisible: visible,
          rows
        })
      }
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)

    const item = Array.from(document.querySelectorAll(".menu-item")).find((el) =>
      (el.textContent || "").includes(target)
    )
    item.click()
    await new Promise((r) => setTimeout(r, 2500))
    return out
  }, label)

  console.log(`  ${note}:`)
  trace.forEach((s) =>
    console.log(
      `    +${String(s.t).padStart(5)}ms  遮罩${s.maskVisible ? "可见" : "隐藏"}  表格${s.rows}行`
    )
  )

  // 关键判定：切回后是否出现过「已有数据 + 遮罩可见」
  const flash = trace.find((s) => s.maskVisible && s.rows > 0)
  console.log(
    flash
      ? `    ⚠️ 出现遮罩盖在已有内容上（+${flash.t}ms，${flash.rows} 行）`
      : `    ✅ 无「内容上闪遮罩」`
  )
  return !flash
}

console.log("=== 场景 A：立即切回（数据未过期，不应刷新）===")
const okA = await observeReturn("审计日志", 0, "立即切回")

console.log("\n=== 场景 B：等待 35s 后切回（超过 30s 阈值，会后台刷新）===")
const okB = await observeReturn("审计日志", 35000, "过期后切回")

console.log("\n=== 结论 ===")
console.log(`  立即切回: ${okA ? "正常" : "有闪烁"}`)
console.log(`  过期刷新: ${okB ? "正常（后台刷新不干扰阅读）" : "有闪烁，需修复"}`)

await browser.close()
process.exit(okA && okB ? 0 : 1)
