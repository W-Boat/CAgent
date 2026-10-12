/**
 * 检查指定页面里 ECharts 画布的实际渲染尺寸，确认图表是否真的画出来了。
 * 用法：node scripts/check-charts.mjs /admin/dashboard
 */
import { chromium } from "playwright"

const BASE = process.env.WEB_BASE || "http://127.0.0.1:5173"
const EMAIL = process.env.SHOOT_EMAIL || "admin@cagent.local"
const PASSWORD = process.env.SHOOT_PASSWORD || "CHANGE_ME_SEED_ADMIN_PASSWORD"
const paths = process.argv.slice(2)
if (paths.length === 0) paths.push("/admin/dashboard")

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "zh-CN" })
const warnings = []
page.on("console", (msg) => {
  if (msg.type() === "warning" || msg.type() === "error") warnings.push(`${msg.type()}: ${msg.text().slice(0, 200)}`)
})

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" })
await page.fill('input[type="text"]', EMAIL)
await page.fill('input[type="password"]', PASSWORD)
await page.click(".submit-btn")
await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 25000 })

for (const p of paths) {
  await page.goto(`${BASE}${p}`, { waitUntil: "networkidle", timeout: 30000 })
  await page.waitForTimeout(3000)
  const info = await page.evaluate(() => {
    const holders = Array.from(document.querySelectorAll(".chart-holder"))
    return holders.map((el) => {
      const canvas = el.querySelector("canvas")
      return {
        w: el.clientWidth,
        h: el.clientHeight,
        display: getComputedStyle(el).display,
        hasCanvas: !!canvas,
        canvasW: canvas ? canvas.width : 0,
        canvasH: canvas ? canvas.height : 0
      }
    })
  })
  console.log(`\n=== ${p} === 图表容器 ${info.length} 个`)
  for (const [i, it] of info.entries()) {
    console.log(
      `  #${i} holder=${it.w}x${it.h} display=${it.display} canvas=${it.hasCanvas} ${it.canvasW}x${it.canvasH}`
    )
  }
}

if (warnings.length) {
  console.log("\n告警/错误：")
  for (const w of [...new Set(warnings)].slice(0, 20)) console.log("  " + w)
}

await browser.close()