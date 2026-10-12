/**
 * 图标可见性验证。
 *
 * 背景：把图标从「全量注册」改成「显式登记表」后，
 * 漏登记的图标**不会报错、只是不显示** —— 曾因此让
 * 左上角折叠按钮与右上角主题切换图标变成空白，上线后才发现。
 *
 * 这个脚本专门盯这几个位置，确保它们真的渲染出了 SVG。
 */
import { chromium } from "playwright"

const BASE = process.env.BASE_URL || "http://127.0.0.1:4173"
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()

let failures = 0
const check = (cond, msg) => {
  console.log(`${cond ? "OK " : "NG "} ${msg}`)
  if (!cond) failures++
}

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
await page.waitForTimeout(3000)

/**
 * 检查一个位置是否渲染出了图标。
 *
 * 关键判据：`<el-icon>` 里必须真的有 `<svg>` ——
 * 图标未注册时 Vue 会渲染成空注释节点，el-icon 仍在但里面是空的。
 */
async function checkIconAt(name, selector, description) {
  const info = await page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return { found: false }
    const box = el.getBoundingClientRect()
    const svg = el.querySelector("svg")
    const svgBox = svg?.getBoundingClientRect()
    return {
      found: true,
      visible: box.width > 0 && box.height > 0,
      size: `${Math.round(box.width)}x${Math.round(box.height)}`,
      hasSvg: !!svg,
      svgSize: svgBox ? `${Math.round(svgBox.width)}x${Math.round(svgBox.height)}` : null,
      // 未注册的图标会留下空的注释占位
      text: (el.textContent || "").trim(),
      html: el.innerHTML.slice(0, 80)
    }
  }, selector)

  if (!info.found) {
    check(false, `${description}：找不到元素 ${selector}`)
    return
  }
  check(
    info.hasSvg && info.visible,
    `${description}：${info.hasSvg ? `SVG ${info.svgSize}` : "无 SVG（图标未注册）"}，容器 ${info.size}`
  )
}

console.log("=== 侧边栏底部：收起/展开按钮 ===")
/*
 * 位置说明：这个按钮在侧边栏**底部**（.collapse-btn），不是左上角。
 * 手机上顶栏另有一个 .drawer-toggle（.collapse-btn 在抽屉里看不到）。
 * 两者用的是同一组 Expand / Fold 图标。
 */
await checkIconAt("collapse", ".collapse-btn .el-icon", "收起菜单按钮图标")

console.log("\n=== 顶栏右侧：主题切换 / 新建对话 / 接口文档 ===")
const topbarIcons = await page.evaluate(() => {
  const right = document.querySelector(".topbar-right")
  if (!right) return null
  /*
   * 注意要连 <a> 一起选：接口文档按钮用了 `tag="a"`，
   * Element Plus 会把它渲染成 <a class="el-button">，不是 <button>。
   * 只查 button 会漏掉它（曾因此少验一个图标）。
   */
  const nodes = Array.from(right.querySelectorAll("button, a.el-button, .el-dropdown"))
  return nodes.map((b, i) => {
    const svg = b.querySelector("svg")
    const box = b.getBoundingClientRect()
    return {
      i,
      tag: b.tagName.toLowerCase(),
      // 用图形元素数量判断 SVG 是否真的画出了东西
      paths: svg ? svg.querySelectorAll("path,circle,rect,line,polygon").length : 0,
      hasSvg: !!svg,
      visible: box.width > 0 && box.height > 0,
      size: `${Math.round(box.width)}x${Math.round(box.height)}`,
      hidden: getComputedStyle(b).display === "none"
    }
  })
})

if (!topbarIcons) {
  check(false, "找不到 .topbar-right")
} else {
  const shown = topbarIcons.filter((b) => !b.hidden && b.visible)
  console.log(`  共 ${topbarIcons.length} 个（可见 ${shown.length}；窄屏会隐藏接口文档）`)
  for (const b of topbarIcons) {
    if (b.hidden) {
      console.log(`    <${b.tag}>${b.i}：窄屏隐藏（预期行为）`)
      continue
    }
    check(
      b.hasSvg && b.visible && b.paths > 0,
      `  <${b.tag}>${b.i}：${b.hasSvg ? `SVG 含 ${b.paths} 个图形` : "无 SVG（图标未注册）"}，${b.size}`
    )
  }
}

console.log("\n=== 侧边栏菜单图标 ===")
const menuIcons = await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll(".menu-item"))
  return items.map((el) => {
    const svg = el.querySelector("svg")
    return {
      text: (el.textContent || "").trim().slice(0, 12),
      hasSvg: !!svg
    }
  })
})
const menuWithSvg = menuIcons.filter((m) => m.hasSvg).length
check(
  menuWithSvg === menuIcons.length,
  `菜单图标齐全（${menuWithSvg}/${menuIcons.length}）`
)
const missing = menuIcons.filter((m) => !m.hasSvg)
if (missing.length) {
  console.log("  缺失：" + missing.map((m) => m.text).join(", "))
}

console.log("\n=== 用户下拉菜单图标 ===")
await page.locator(".user-chip").click()
await page.waitForTimeout(900)
const dropdownIcons = await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll(".el-dropdown-menu__item"))
  return items.map((el) => ({
    text: (el.textContent || "").trim().slice(0, 10),
    hasSvg: !!el.querySelector("svg")
  }))
})
const ddWithSvg = dropdownIcons.filter((d) => d.hasSvg).length
check(
  dropdownIcons.length === 0 || ddWithSvg === dropdownIcons.length,
  `下拉菜单图标齐全（${ddWithSvg}/${dropdownIcons.length}）`
)

await page.screenshot({ path: "storage/shots/icon-check-light.png" })

console.log("\n=== 切换暗色后再验一次（主题图标会换）===")
await page.keyboard.press("Escape")
await page.waitForTimeout(400)
await page.locator('.topbar-right button[aria-label*="切换"], .topbar-right button').first().click()
await page.waitForTimeout(1200)

const afterToggle = await page.evaluate(() => {
  const right = document.querySelector(".topbar-right")
  const first = right?.querySelector("button")
  return {
    isDark: document.documentElement.classList.contains("dark"),
    hasSvg: !!first?.querySelector("svg")
  }
})
check(afterToggle.isDark, "已切到暗色")
check(afterToggle.hasSvg, "暗色下主题图标仍有 SVG")

await page.screenshot({ path: "storage/shots/icon-check-dark.png" })

await browser.close()
console.log("\n" + "=".repeat(46))
console.log(failures === 0 ? "图标可见性全部通过" : `${failures} 项图标不可见`)
process.exit(failures === 0 ? 0 : 1)
