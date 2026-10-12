/**
 * 提取页面可见文本摘要，用于确认页面不是空白/报错页。
 * 用法：node scripts/text-probe.mjs /admin/users /admin/messages ...
 */
import { chromium } from "playwright"

const BASE = process.env.WEB_BASE || "http://127.0.0.1:5173"
const EMAIL = process.env.SHOOT_EMAIL || "admin@cagent.local"
const PASSWORD = process.env.SHOOT_PASSWORD || "CHANGE_ME_SEED_ADMIN_PASSWORD"
const paths = process.argv.slice(2)

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "zh-CN" })

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" })
await page.fill('input[type="text"]', EMAIL)
await page.fill('input[type="password"]', PASSWORD)
await page.click(".submit-btn")
await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 25000 })

for (const p of paths) {
  await page.goto(`${BASE}${p}`, { waitUntil: "networkidle", timeout: 30000 })
  await page.waitForTimeout(2000)
  const info = await page.evaluate(() => {
    const main = document.querySelector(".page") || document.body
    const text = (main.innerText || "").replace(/\s+/g, " ").trim()
    return {
      title: document.title,
      len: text.length,
      rows: document.querySelectorAll(".el-table__row").length,
      tiles: document.querySelectorAll(".stat-tile").length,
      tags: document.querySelectorAll(".el-tag").length,
      text: text.slice(0, 420)
    }
  })
  console.log(`\n=== ${p} === title=${info.title} 文本${info.len}字 表格行=${info.rows} 指标卡=${info.tiles} 标签=${info.tags}`)
  console.log("  " + info.text)
}

await browser.close()