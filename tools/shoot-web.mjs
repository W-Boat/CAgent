/**
 * 前端巡检脚本：用 Playwright 登录后台并截图关键页面。
 * 用法：node tools/shoot-web.mjs [outDir]
 */
import { chromium } from "playwright"
import { mkdirSync } from "node:fs"
import { join } from "node:path"

const BASE = process.env.WEB_BASE || "http://127.0.0.1:5173"
const EMAIL = process.env.SHOOT_EMAIL || "admin@cagent.local"
const PASSWORD = process.env.SHOOT_PASSWORD || "CHANGE_ME_SEED_ADMIN_PASSWORD"
const OUT = process.env.SHOOT_OUT || "storage/shots"

const PAGES = [
  { name: "01-login", path: "/login", auth: false },
  { name: "02-dashboard", path: "/dashboard" },
  { name: "03-chat", path: "/chat" },
  { name: "04-skills", path: "/skills" },
  { name: "05-agents", path: "/agents" },
  { name: "06-usage", path: "/usage" },
  { name: "07-browser", path: "/browser" },
  { name: "08-admin-dashboard", path: "/admin/dashboard" },
  { name: "09-admin-users", path: "/admin/users" },
  { name: "10-admin-roles", path: "/admin/roles" },
  { name: "11-admin-providers", path: "/admin/providers" },
  { name: "12-admin-models", path: "/admin/models" },
  { name: "13-admin-agents", path: "/admin/agents" },
  { name: "14-admin-skills", path: "/admin/skills" },
  { name: "15-admin-skill-runs", path: "/admin/skill-runs" },
  { name: "16-admin-browser", path: "/admin/browser" },
  { name: "17-admin-conversations", path: "/admin/conversations" },
  { name: "18-admin-messages", path: "/admin/messages" },
  { name: "19-admin-usage", path: "/admin/usage" },
  { name: "20-admin-quotas", path: "/admin/quotas" },
  { name: "21-admin-audit", path: "/admin/audit" },
  { name: "22-admin-settings", path: "/admin/settings" },
  { name: "23-profile", path: "/profile" }
]

mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  locale: "zh-CN",
  deviceScaleFactor: 1
})
const page = await context.newPage()

const errors = []
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(`[console] ${page.url()} :: ${msg.text()}`)
})
page.on("pageerror", (err) => errors.push(`[pageerror] ${page.url()} :: ${err.message}`))

async function login() {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" })
  await page.fill('input[type="text"], input[placeholder*="邮"], input[placeholder*="账号"]', EMAIL)
  await page.fill('input[type="password"]', PASSWORD)
  await page.click('button:has-text("登录")')
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 20000 })
  await page.waitForTimeout(1200)
}

const shots = []

for (const item of PAGES) {
  if (item.auth === false) {
    await page.goto(`${BASE}${item.path}`, { waitUntil: "networkidle" })
  } else {
    if (!page.url().includes(BASE) || page.url().includes("/login")) await login()
    await page.goto(`${BASE}${item.path}`, { waitUntil: "networkidle" })
  }
  await page.waitForTimeout(1600)
  const file = join(OUT, `${item.name}.png`)
  await page.screenshot({ path: file })
  shots.push(file)
  console.log(`shot ${item.name} -> ${page.url()}`)
}

console.log(`\n共 ${shots.length} 张截图，输出目录：${OUT}`)
if (errors.length) {
  console.log(`\n捕获到 ${errors.length} 条前端错误：`)
  for (const e of errors.slice(0, 40)) console.log("  " + e)
} else {
  console.log("\n未捕获到前端控制台错误。")
}

await browser.close()