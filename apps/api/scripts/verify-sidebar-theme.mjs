/**
 * 侧边栏配色验证（日间浅色 / 夜间深色）。
 *
 * 改浅色侧边栏最大的风险是**浅底配浅字不可读**：
 * 原样式里大量硬编码了深色专用的颜色（#f8fafc、#94a3b8、
 * rgba(255,255,255,0.08) 等），只改底色就会全部失效。
 *
 * 因此这里逐项验证：
 *   1. 日间底色的亮度确实高（浅色）、夜间确实低
 *   2. 每一类文字（品牌名 / 副标题 / 分组标题 / 菜单项 / 激活项 /
 *      底部按钮）与其实际背景的对比度达标
 *   3. 激活态在日间是浅底深字，夜间是深底浅字
 *   4. 品牌图标在两种主题下都可见（不是白图白底）
 *   5. 分隔线可见但不过重
 */
import { chromium } from "playwright"
import { mkdirSync } from "node:fs"

const BASE = process.env.BASE_URL || "http://127.0.0.1:4173"
const SHOT_DIR = process.env.SHOT_DIR || "storage/shots"
mkdirSync(SHOT_DIR, { recursive: true })

let failures = 0
const check = (cond, msg) => {
  console.log(`${cond ? "OK " : "NG "} ${msg}`)
  if (!cond) failures++
}

/** 解析 rgb(a) → [r,g,b,a] */
function rgb(str) {
  const m = String(str).match(/rgba?\(([^)]+)\)/)
  if (!m) return null
  const p = m[1].split(",").map((s) => parseFloat(s.trim()))
  return [p[0], p[1], p[2], p[3] ?? 1]
}

/**
 * 把带透明度的颜色合成到背景上。
 *
 * 分隔线这类颜色是 `rgba(255,255,255,0.08)` —— 直接算对比度会得到
 * 18:1 的荒谬结果（把 8% 的白色当成纯白）。必须按 alpha 合成为实际观感色。
 */
function composite(fg, bg) {
  const f = rgb(fg)
  const b = bg ? rgb(bg) : [255, 255, 255, 1]
  if (!f || !b) return fg
  const a = f[3]
  if (a >= 1) return fg
  const mix = [0, 1, 2].map((i) => Math.round(f[i] * a + b[i] * (1 - a)))
  return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`
}

/** WCAG 相对亮度 */
function luminance([r, g, b]) {
  const f = (v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

/**
 * 两色对比度。
 * @param bgForComposite 前景若带 alpha，用它作为合成背景
 */
function contrast(a, b, bgForComposite) {
  const aC = alpha(bgForComposite ? composite(a, bgForComposite) : a)
  const bC = alpha(b)
  if (!aC || !bC) return NaN
  const l1 = luminance(aC)
  const l2 = luminance(bC)
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

/** 取 rgb 数组 */
function alpha(c) {
  return rgb(c)
}

/**
 * 取元素的实际背景色。
 * 元素自身 background 常是 transparent，需要向上找到真正有底色的祖先
 * —— 否则对比度算出来是「文字 vs 透明」，毫无意义。
 */
const EFFECTIVE_BG = `
  (el) => {
    let cur = el
    while (cur) {
      const bg = getComputedStyle(cur).backgroundColor
      const m = bg.match(/rgba?\\(([^)]+)\\)/)
      if (m) {
        const parts = m[1].split(',').map(s => parseFloat(s.trim()))
        const a = parts[3] ?? 1
        if (a > 0.05) return bg
      }
      cur = cur.parentElement
    }
    return getComputedStyle(document.body).backgroundColor
  }
`

const browser = await chromium.launch()

async function auditTheme(mode) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(
    ([m]) => {
      localStorage.setItem("cagent-theme", m)
    },
    [mode]
  )
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
  await page.waitForSelector(".menu-item", { timeout: 25000 })
  await page.waitForTimeout(1800)

  console.log(`\n=== ${mode === "dark" ? "夜间" : "日间"}模式 ===`)

  const data = await page.evaluate((bgFnSrc) => {
    const effectiveBg = eval(bgFnSrc)
    const pick = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const cs = getComputedStyle(el)
      return {
        color: cs.color,
        bg: effectiveBg(el),
        ownBg: cs.backgroundColor,
        text: (el.textContent || "").trim().slice(0, 14),
        fontSize: cs.fontSize
      }
    }
    const sidebar = document.querySelector(".sidebar")
    const active = document.querySelector(".menu-item.active")
    const divider = document.querySelector(".menu-group-divider, .brand")
    return {
      htmlDark: document.documentElement.classList.contains("dark"),
      sidebarBg: sidebar ? getComputedStyle(sidebar).backgroundColor : null,
      sidebarBorder: sidebar ? getComputedStyle(sidebar).borderRightColor : null,
      brandName: pick(".brand-name"),
      brandSub: pick(".brand-sub"),
      menuGroup: pick(".menu-group"),
      menuItem: pick(".menu-item:not(.active)"),
      menuActive: active
        ? {
            color: getComputedStyle(active).color,
            bg: getComputedStyle(active).backgroundColor,
            text: (active.textContent || "").trim()
          }
        : null,
      collapseBtn: pick(".collapse-btn"),
      sidebarFoot: pick(".sidebar-foot"),
      // 品牌图标：读它自己的 color（SVG 用 currentColor）
      brandLogoColor: (() => {
        const el = document.querySelector(".brand-logo")
        return el ? getComputedStyle(el).color : null
      })(),
      // 激活项相对普通项的亮度差
      dividerColor: divider ? getComputedStyle(divider).borderBottomColor : null
    }
  }, EFFECTIVE_BG)

  check(
    data.htmlDark === (mode === "dark"),
    `${mode === "dark" ? "已应用暗色类" : "未错误应用暗色类"}（html.dark=${data.htmlDark}）`
  )

  const sbLum = data.sidebarBg ? luminance(rgb(data.sidebarBg)) : NaN
  if (mode === "light") {
    check(sbLum > 0.8, `侧边栏底色为浅色：${data.sidebarBg}（亮度 ${sbLum.toFixed(3)}）`)
  } else {
    check(sbLum < 0.05, `侧边栏底色为深色：${data.sidebarBg}（亮度 ${sbLum.toFixed(3)}）`)
  }

  // 逐项检查对比度
  const items = [
    ["品牌名", data.brandName, 4.5],
    ["品牌副标题", data.brandSub, 3],
    ["分组标题", data.menuGroup, 3],
    ["菜单项", data.menuItem, 4.5],
    ["底部按钮", data.collapseBtn, 3]
  ]

  for (const [name, info, need] of items) {
    if (!info) {
      check(false, `${name}：找不到元素`)
      continue
    }
    // 文字色若带 alpha 也需先合成到底色上
    const ratio = contrast(info.color, info.bg, info.bg)
    check(
      ratio >= need,
      `${name}「${info.text}」对比度 ${ratio.toFixed(2)}:1（需 ≥${need}）— ${info.color} on ${info.bg}`
    )
  }

  // 激活态
  if (!data.menuActive) {
    check(false, "找不到激活的菜单项")
  } else {
    const ratio = contrast(data.menuActive.color, data.menuActive.bg)
    check(
      ratio >= 4.5,
      `激活项「${data.menuActive.text}」对比度 ${ratio.toFixed(2)}:1 — ${data.menuActive.color} on ${data.menuActive.bg}`
    )
    const activeLum = luminance(rgb(data.menuActive.bg))
    const baseLum = sbLum
    if (mode === "light") {
      // 日间：激活底色应是浅色（比侧边栏底略深一点点的浅蓝），而不是深色块
      check(
        activeLum > 0.5,
        `日间激活态为浅底（亮度 ${activeLum.toFixed(3)}，侧边栏底 ${baseLum.toFixed(3)}）`
      )
      check(
        activeLum <= baseLum + 0.02,
        `激活底比侧边栏底稍深，能看出选区（${activeLum.toFixed(3)} ≤ ${(baseLum + 0.02).toFixed(3)}）`
      )
    } else {
      check(activeLum > baseLum, `夜间激活态比底色亮（${activeLum.toFixed(3)} > ${baseLum.toFixed(3)}）`)
    }
  }

  // 品牌图标可见性：图标 color 与侧边栏底的对比度必须够
  if (data.brandLogoColor && data.sidebarBg) {
    const ratio = contrast(data.brandLogoColor, data.sidebarBg)
    check(
      ratio >= 3,
      `品牌图标可见：${data.brandLogoColor} on ${data.sidebarBg}，对比度 ${ratio.toFixed(2)}:1`
    )
  } else {
    check(false, "读不到品牌图标颜色")
  }

  // 分隔线：应能与底色区分，但不要过重
  if (data.sidebarBorder) {
    /*
     * 先把带 alpha 的边框色合成到侧边栏底色上，再算对比度。
     * 深色主题的分隔线是 rgba(255,255,255,0.08)，不合成会得出 18:1 的假结果。
     */
    const composited = composite(data.sidebarBorder, data.sidebarBg)
    const ratio = contrast(composited, data.sidebarBg)
    check(
      ratio > 1.05 && ratio < 4,
      `侧边栏分隔线可见且不刺眼（对比度 ${ratio.toFixed(2)}:1，合成色 ${composited}）`
    )
  }

  await page.screenshot({ path: `${SHOT_DIR}/sidebar-${mode}.png` })
  await ctx.close()
}

await auditTheme("light")
await auditTheme("dark")

await browser.close()
console.log("\n" + "=".repeat(48))
console.log(failures === 0 ? "侧边栏配色全部通过" : `${failures} 项需要修复`)
process.exit(failures === 0 ? 0 : 1)
