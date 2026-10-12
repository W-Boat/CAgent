/**
 * 浅色侧边栏在「收起态」与「移动端抽屉」下的验证。
 *
 * 这两种形态复用同一套 .sidebar 样式，但布局不同：
 *   - 收起态：只留图标，没有文字 → 需确认图标颜色可见
 *   - 移动端：侧边栏是浮层抽屉，带半透明遮罩 → 需确认遮罩仍有对比
 */
import { chromium, devices } from "playwright"
import { mkdirSync } from "node:fs"

const BASE = process.env.BASE_URL || "http://127.0.0.1:4173"
const SHOT_DIR = process.env.SHOT_DIR || "storage/shots"
mkdirSync(SHOT_DIR, { recursive: true })

let failures = 0
const check = (cond, msg) => {
  console.log(`${cond ? "OK " : "NG "} ${msg}`)
  if (!cond) failures++
}

function composite(fg, bg) {
  const parse = (s) => {
    const m = String(s).match(/rgba?\(([^)]+)\)/)
    if (!m) return null
    const p = m[1].split(",").map((x) => parseFloat(x.trim()))
    return [p[0], p[1], p[2], p[3] ?? 1]
  }
  const f = parse(fg)
  const b = parse(bg)
  if (!f || !b) return fg
  if (f[3] >= 1) return fg
  const mix = [0, 1, 2].map((i) => Math.round(f[i] * f[3] + b[i] * (1 - f[3])))
  return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`
}

function luminance(c) {
  const m = String(c).match(/rgba?\(([^)]+)\)/)
  if (!m) return NaN
  const p = m[1].split(",").map((x) => parseFloat(x.trim()))
  const f = (v) => {
    const x = v / 255
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(p[0]) + 0.7152 * f(p[1]) + 0.0722 * f(p[2])
}

function contrast(a, b, bgForComposite) {
  const aC = bgForComposite ? composite(a, bgForComposite) : a
  const l1 = luminance(aC)
  const l2 = luminance(b)
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

const browser = await chromium.launch()

async function login(page) {
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
  await page.waitForSelector(".menu-item", { timeout: 25000 })
  await page.waitForTimeout(1500)
}

// ============================================================
console.log("=== 日间：收起态（只显图标，无文字）===")
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(() => localStorage.setItem("cagent-theme", "light"))
  const page = await ctx.newPage()
  await login(page)

  await page.locator(".collapse-btn").click()
  await page.waitForTimeout(900)

  const info = await page.evaluate(() => {
    const sidebar = document.querySelector(".sidebar")
    const icon = document.querySelector(".menu-item .menu-icon")
    const text = document.querySelector(".menu-text")
    const sub = document.querySelector(".brand-sub")
    return {
      collapsed: sidebar?.classList.contains("collapsed"),
      sidebarBg: getComputedStyle(sidebar).backgroundColor,
      iconColor: icon ? getComputedStyle(icon).color : null,
      textHidden: !text || text.getClientRects().length === 0,
      subHidden: !sub || sub.getClientRects().length === 0,
      // 收起时分组标题会换成一条分隔线
      hasDivider: !!document.querySelector(".menu-group-divider")
    }
  })

  check(info.collapsed, "侧边栏已收起")
  check(info.textHidden, "收起后菜单文字隐藏")
  check(info.subHidden, "收起后品牌副标题隐藏")

  if (info.iconColor) {
    const ratio = contrast(info.iconColor, info.sidebarBg)
    check(
      ratio >= 4.5,
      `收起态图标可见：${info.iconColor} on ${info.sidebarBg}，对比度 ${ratio.toFixed(2)}:1`
    )
  } else {
    check(false, "读不到图标颜色")
  }

  await page.screenshot({ path: `${SHOT_DIR}/sidebar-light-collapsed.png` })
  await ctx.close()
}

// ============================================================
console.log("\n=== 移动端：抽屉 + 遮罩 ===")
{
  const ctx = await browser.newContext({ ...devices["iPhone 12"] })
  await ctx.addInitScript(() => localStorage.setItem("cagent-theme", "light"))
  const page = await ctx.newPage()
  await login(page)

  // 手机上抽屉默认收起，点顶栏按钮打开
  await page.locator(".drawer-toggle").click()
  await page.waitForTimeout(1000)

  const info = await page.evaluate(() => {
    const backdrop = document.querySelector(".menu-backdrop")
    const sidebar = document.querySelector(".sidebar")
    const item = document.querySelector(".menu-item:not(.active)")
    return {
      drawerOpen: sidebar ? !sidebar.classList.contains("collapsed") : false,
      sidebarBg: sidebar ? getComputedStyle(sidebar).backgroundColor : null,
      backdropBg: backdrop ? getComputedStyle(backdrop).backgroundColor : null,
      itemColor: item ? getComputedStyle(item).color : null
    }
  })

  check(info.drawerOpen, "移动端抽屉已展开")
  check(
    info.sidebarBg === "rgb(255, 255, 255)",
    `抽屉底色为浅色：${info.sidebarBg}`
  )

  // 遮罩必须足够暗，才能把抽屉与背景内容区分开
  if (info.backdropBg) {
    const lum = luminance(composite(info.backdropBg, "rgb(255, 255, 255)"))
    check(lum < 0.5, `遮罩足够暗以突出抽屉（合成亮度 ${lum.toFixed(3)}，${info.backdropBg}）`)
  } else {
    check(false, "找不到 .menu-backdrop")
  }

  if (info.itemColor) {
    const ratio = contrast(info.itemColor, info.sidebarBg)
    check(
      ratio >= 4.5,
      `抽屉内菜单项可读：对比度 ${ratio.toFixed(2)}:1`
    )
  }

  await page.screenshot({ path: `${SHOT_DIR}/sidebar-light-mobile.png` })
  await ctx.close()
}

await browser.close()
console.log("\n" + "=".repeat(48))
console.log(failures === 0 ? "收起态与移动端全部通过" : `${failures} 项需要修复`)
process.exit(failures === 0 ? 0 : 1)
