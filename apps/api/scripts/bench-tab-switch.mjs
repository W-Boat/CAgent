/**
 * Tab 切换性能基准（修正版）。
 *
 * ══ 三次踩坑记录，都是测量方法本身的问题 ══
 *
 *   1. 在计时区间内用 `page.evaluate` 轮询
 *      每次 evaluate 是一次 CDP 往返（5-15ms），几十次就把耗时撑到几百毫秒。
 *
 *   2. 用「遮罩元素是否还在 DOM」判断结束
 *      Element Plus 的 loading 指令在 close() 后立即把 opacity 过渡到 0
 *      （用户已经看不到），但要等 **400ms 的 setTimeout** 才 removeChild
 *      （源码 es/components/loading/src/loading.mjs:46）。
 *      用它判断会把 400ms 的内部拆除延迟算成用户卡顿。
 *
 *   3. 用合成事件 dispatchEvent 点菜单
 *      菜单是 <a href>，靠 vue-router 的 click 处理器 preventDefault 才是
 *      SPA 导航；合成事件绕过它会让浏览器整页加载，上下文销毁。
 *
 * ══ 正确的判据 ══
 *   用户「看到新页面」的时刻 = 路由已切换 + 内容已渲染 + 遮罩视觉不可见。
 *   视觉不可见要读 opacity，而不是查 DOM 存在性。
 */
import { chromium } from "playwright"

const BASE = process.env.BASE_URL || "http://127.0.0.1:4173"

const PAGES = [
  { label: "工作台", path: "/dashboard" },
  { label: "技能中心", path: "/skills" },
  { label: "智能体广场", path: "/agents" },
  { label: "我的用量", path: "/usage" },
  { label: "我的记忆", path: "/memory" },
  { label: "数据看板", path: "/admin/dashboard" },
  { label: "用户管理", path: "/admin/users" },
  { label: "模型供应商", path: "/admin/providers" },
  { label: "用量统计", path: "/admin/usage" },
  { label: "审计日志", path: "/admin/audit" },
  { label: "系统设置", path: "/admin/settings" },
  { label: "技能运行记录", path: "/admin/skill-runs" }
]

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()

let apiCount = 0
page.on("request", (r) => {
  if (r.url().includes("/api/")) apiCount++
})

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" })
// 线上经 Cloudflare 首屏更慢，给足时间
await page.waitForTimeout(3000)

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

/*
 * 侧边栏菜单只在登录后的布局里存在，登录页没有。
 * 因此要先进入工作台，再等菜单渲染出来 —— 线上首屏慢，必须显式等待，
 * 否则后续 locator 点击会拿到空元素。
 */
await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" })
await page.waitForSelector(".menu-item", { timeout: 40000 })
await page.waitForTimeout(2500)

/**
 * 切换并测量「用户看到新页面」的耗时。
 *
 * 计时与就绪判定全部在页面内完成，避免 CDP 往返污染。
 * 返回 -1 表示超时/未记录到点击（调用方应视为无效样本剔除）。
 */
async function switchTo(target) {
  // 先把请求计数器清零：上一步导航遗留的在途请求不应算进本次
  await page.waitForTimeout(350)
  apiCount = 0

  // 装页面内计时器
  await page.evaluate((path) => {
    window.__navStart = 0
    window.__navReady = new Promise((resolve) => {
      const ready = () => {
        if (window.__navStart === 0) return false
        if (location.pathname !== path) return false
        const main = document.querySelector("main.content")
        const child = main?.firstElementChild
        if (!child || !child.getClientRects().length) return false
        // 关键：读 opacity，而不是查遮罩是否存在
        const masks = Array.from(document.querySelectorAll(".el-loading-mask"))
        const visuallyMasked = masks.some(
          (m) => parseFloat(getComputedStyle(m).opacity) > 0.05
        )
        return !visuallyMasked
      }

      const tick = () => {
        if (ready()) resolve(Math.round(performance.now() - window.__navStart))
        else requestAnimationFrame(tick)
      }

      // 捕获阶段打点，早于 vue-router 处理点击
      document.addEventListener(
        "click",
        () => {
          if (window.__navStart === 0) window.__navStart = performance.now()
        },
        { capture: true, once: true }
      )
      requestAnimationFrame(tick)
    })
  }, target.path)

  await page.locator(`.menu-item:has-text("${target.label}")`).first().click()

  const ms = await page.evaluate(() =>
    Promise.race([window.__navReady, new Promise((r) => setTimeout(() => r(-1), 10000))])
  )
  // 采集本次窗口内的请求数（此时在途请求已结算）
  await page.waitForTimeout(250)
  return { ms, api: apiCount }
}

console.log("=== 冷启动：首次进入各页面 ===")
const cold = []
for (const p of PAGES) {
  // reload 清掉 keep-alive，确保是真正的冷启动
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(2200)
  const r = await switchTo(p)
  cold.push({ ...p, ...r })
  console.log(`  ${p.label.padEnd(7)} ${String(r.ms).padStart(5)}ms   API ${r.api}`)
}

console.log("\n=== 缓存命中：再次进入 ===")
const warm = []
for (const p of PAGES) {
  const r = await switchTo(p)
  warm.push({ ...p, ...r })
  console.log(`  ${p.label.padEnd(7)} ${String(r.ms).padStart(5)}ms   API ${r.api}`)
}

console.log("\n=== 汇总 ===")

/*
 * 剔除无效样本（ms < 0 表示未记录到点击或超时）。
 * 用有效样本算平均，避免 NaN 污染统计。
 */
const validOnly = (arr) => arr.filter((x) => x.ms >= 0)
const coldValid = validOnly(cold)
const warmValid = validOnly(warm)

if (coldValid.length < cold.length) {
  console.log(`  （冷启动有 ${cold.length - coldValid.length} 个无效样本已剔除）`)
}

const avg = (arr) => (arr.length ? Math.round(arr.reduce((s, x) => s + x.ms, 0) / arr.length) : 0)
const p95 = (arr) => {
  if (!arr.length) return 0
  const s = arr.map((x) => x.ms).sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]
}

console.log(
  `  冷启动:   平均 ${avg(coldValid)}ms   p95 ${p95(coldValid)}ms   最慢 ${coldValid.length ? Math.max(...coldValid.map((c) => c.ms)) : 0}ms`
)
console.log(
  `  缓存命中: 平均 ${avg(warmValid)}ms   p95 ${p95(warmValid)}ms   最慢 ${warmValid.length ? Math.max(...warmValid.map((c) => c.ms)) : 0}ms`
)
console.log(`  缓存命中时 API 请求总数: ${warmValid.reduce((s, x) => s + x.api, 0)}`)

const worst = [...coldValid].sort((a, b) => b.ms - a.ms).slice(0, 3)
if (worst.length) {
  console.log(`\n  最慢三次: ${worst.map((w) => `${w.label} ${w.ms}ms`).join("  ")}`)
}

await browser.close()
