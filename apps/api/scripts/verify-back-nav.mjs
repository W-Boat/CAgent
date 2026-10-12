/**
 * 移动端后退机制 + PC 引导提示 验证。
 *
 * ⚠️ 关键前提：必须用 SPA 内部导航切换路由。
 * `page.goto()` 会整页加载，历史里是两个独立文档，返回属于浏览器级导航，
 * 测不出 popstate 行为 —— 早期几个「假失败」都源于此。
 *
 * 验证点：
 *   1. 抽屉打开时按返回 → 抽屉关闭，且仍停留在原页面
 *   2. 抽屉收起时按返回 → 正常回退路由
 *   3. 反复开关抽屉不污染历史（history.length 恒定，一次返回即离开）
 *   4. 弹窗打开时按返回 → 弹窗关闭，路由不变
 *   5. PC 引导：移动端劝去电脑；PC 端引导装扩展
 */
import { chromium, devices } from "playwright"
import { mkdirSync } from "node:fs"

const BASE = process.env.BASE_URL || "http://127.0.0.1:5173"
const SHOT_DIR = process.env.SHOT_DIR || "storage/shots"
mkdirSync(SHOT_DIR, { recursive: true })

let failures = 0
const check = (cond, msg) => {
  console.log(`${cond ? "✅" : "❌"} ${msg}`)
  if (!cond) failures++
}

const browser = await chromium.launch()

// ---------- 登录取 token ----------
const ctxSetup = await browser.newContext({ ...devices["iPhone 12"] })
const setupPage = await ctxSetup.newPage()
await setupPage.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" })
const auth = await setupPage.evaluate(async (base) => {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@cagent.local", password: "CHANGE_ME_SEED_ADMIN_PASSWORD" })
  })
  const j = await res.json()
  const d = j.data ?? j
  return { token: d?.accessToken, refresh: d?.refreshToken }
}, BASE)
await ctxSetup.close()
check(!!auth.token, "登录成功")

async function newMobilePage() {
  const ctx = await browser.newContext({ ...devices["iPhone 12"] })
  await ctx.addInitScript(
    ([t, r]) => {
      localStorage.setItem("cagent.accessToken", t)
      localStorage.setItem("cagent.refreshToken", r || "")
    },
    [auth.token, auth.refresh]
  )
  const page = await ctx.newPage()
  return { ctx, page }
}

const state = (page) =>
  page.evaluate(() => ({
    path: location.pathname,
    historyLen: history.length,
    drawerOpen: (() => {
      const el = document.querySelector(".sidebar")
      return el ? !el.classList.contains("collapsed") : false
    })(),
    visibleOverlays: Array.from(
      document.querySelectorAll(".el-dialog, .el-overlay")
    ).filter((d) => d.getClientRects().length > 0).length
  }))

async function openDrawer(page) {
  if ((await state(page)).drawerOpen) return
  await page.click(".drawer-toggle")
  await page.waitForTimeout(550)
}

/**
 * 点遮罩关闭抽屉。
 *
 * 不能用 `backdrop.click()`：Element Plus 的遮罩铺满全屏，
 * Playwright 默认点**元素中心**，而窄屏下侧边栏宽 280px、屏宽 390px，
 * 中心点 (195, y) 恰好落在侧边栏上，会误点菜单项跳走。
 * 因此显式点右侧的空白区域。
 */
async function closeDrawerByBackdrop(page) {
  const backdrop = page.locator(".menu-backdrop")
  if (!(await backdrop.count())) return
  const box = await backdrop.boundingBox()
  if (!box) return
  // 取屏幕右侧 90% 处，确保落在侧边栏之外
  await page.mouse.click(box.x + box.width * 0.9, box.y + box.height / 2)
  await page.waitForTimeout(550)
}

/** 走 SPA 内部导航（点侧边栏菜单），而不是 page.goto */
async function spaNavigate(page, label) {
  await openDrawer(page)
  await page.locator(`.menu-item:has-text("${label}")`).first().click()
  await page.waitForTimeout(1100)
}

/**
 * 建立「应用内历史」并停在有前驱的位置。
 *
 * 注意不能停在最早的应用内条目上：那时再按返回会走到文档最初的
 * about:blank（跨文档导航，popstate 拦不住，也不该拦）——
 * 这正是早期测试里 location.pathname 变成 "blank" 的原因。
 *
 * 做法：先打开一个页面，再用菜单跳一次，此时位于第二个应用内条目，
 * 身后有一个同文档的前驱，返回才有意义。
 */
async function establishInAppHistory(page, initialPath, viaLabel) {
  await page.goto(`${BASE}${initialPath}`, { waitUntil: "networkidle" })
  await page.waitForTimeout(1300)
  await spaNavigate(page, viaLabel)
  await page.waitForTimeout(600)
}

// ============================================================
console.log("\n=== 1. 抽屉打开时按返回：只关抽屉，不离开页面 ===")
{
  const { ctx, page } = await newMobilePage()
  // 先建立同文档历史，让「返回」有可回退的前驱
  await establishInAppHistory(page, "/dashboard", "技能中心")

  const started = await state(page)
  console.log(`   起点：${started.path}，历史长度 ${started.historyLen}`)

  await openDrawer(page)
  const opened = await state(page)
  check(opened.drawerOpen, "抽屉已展开")

  await page.goBack({ waitUntil: "commit" }).catch(() => {})
  await page.waitForTimeout(1400)

  const after = await state(page)
  check(!after.drawerOpen, "返回键关闭了抽屉")
  /*
   * 不用 page.url()：goBack 被拦截后 Playwright 可能回报 about:blank
   * 或待定目标，而应用实际没动。以页面内 location 为准。
   */
  check(
    after.path === opened.path,
    `仍停留在原页面（${opened.path} → ${after.path}）`
  )
  check(
    after.historyLen === opened.historyLen,
    `历史长度不变（${opened.historyLen} → ${after.historyLen}）`
  )
  const heading = await page.evaluate(
    () => document.querySelector(".page-title")?.textContent?.trim() || ""
  )
  check(heading.length > 0, `页面内容仍正常渲染（标题「${heading}」）`)

  await page.screenshot({ path: `${SHOT_DIR}/back-drawer-closed.png` })
  await ctx.close()
}

// ============================================================
console.log("\n=== 2. 抽屉收起时按返回：正常回退路由 ===")
{
  const { ctx, page } = await newMobilePage()
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" })
  await page.waitForTimeout(1300)

  await spaNavigate(page, "技能中心")
  const atSkills = await state(page)
  check(atSkills.path === "/skills", `已通过菜单导航到 ${atSkills.path}`)
  check(!atSkills.drawerOpen, "菜单跳转后抽屉自动收起")

  await page.goBack({ waitUntil: "commit" }).catch(() => {})
  await page.waitForTimeout(1300)

  const after = await state(page)
  check(after.path === "/dashboard", `返回键正常回退路由：/skills → ${after.path}`)
  await ctx.close()
}

// ============================================================
console.log("\n=== 3. 反复开关抽屉不污染历史 ===")
{
  const { ctx, page } = await newMobilePage()
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" })
  await page.waitForTimeout(1300)
  await spaNavigate(page, "技能中心")

  const before = await state(page)
  console.log(`   基线：路径 ${before.path}，历史长度 ${before.historyLen}`)

  for (let i = 0; i < 3; i++) {
    await openDrawer(page)
    await closeDrawerByBackdrop(page)
  }

  const after = await state(page)
  check(
    after.historyLen === before.historyLen,
    `开关 3 次后历史长度仍为 ${after.historyLen}（无垃圾条目）`
  )
  check(after.path === before.path, `路径未变（${after.path}）`)

  await page.goBack({ waitUntil: "commit" }).catch(() => {})
  await page.waitForTimeout(1300)
  const back = await state(page)
  check(back.path === "/dashboard", `一次返回即回退到 /dashboard（当前 ${back.path}）`)
  await ctx.close()
}

// ============================================================
console.log("\n=== 4. 弹窗打开时按返回：关弹窗、路由不变 ===")
{
  const { ctx, page } = await newMobilePage()
  await page.goto(`${BASE}/skills`, { waitUntil: "networkidle" })
  await page.waitForTimeout(1500)

  // 技能中心页面上的「导入」按钮
  const importBtn = page.locator("button:has-text('导入')").first()
  if (await importBtn.count()) {
    await importBtn.click()
    await page.waitForTimeout(900)

    const opened = await state(page)
    check(opened.visibleOverlays > 0, `弹窗已打开（可见浮层 ${opened.visibleOverlays}）`)

    await page.goBack({ waitUntil: "commit" }).catch(() => {})
    await page.waitForTimeout(1300)

    const after = await state(page)
    check(after.visibleOverlays === 0, `返回键关闭了弹窗（剩余 ${after.visibleOverlays}）`)
    check(after.path === "/skills", `路由未变（${after.path}）`)
  } else {
    console.log("   （技能中心没有导入按钮，跳过该组）")
  }
  await ctx.close()
}

// ============================================================
console.log("\n=== 5. 移动端访问浏览器操控台：提示需要电脑 ===")
{
  const { ctx, page } = await newMobilePage()
  await page.goto(`${BASE}/browser`, { waitUntil: "networkidle" })
  await page.waitForTimeout(1900)

  const guard = await page.evaluate(() => {
    const dialog = document.querySelector(".pc-guard")
    if (!dialog || dialog.getClientRects().length === 0) return { shown: false }
    const text = dialog.textContent || ""
    return {
      shown: true,
      title: dialog.querySelector(".pcg-title")?.textContent?.trim() || "",
      mentionsPc: /电脑|PC/i.test(text),
      hasCloseBtn: !!dialog.querySelector(".el-dialog__headerbtn")
    }
  })

  check(guard.shown, "移动端弹出了引导")
  check(guard.title.includes("电脑"), `标题提示需要电脑：「${guard.title}」`)
  check(guard.mentionsPc, "正文说明需在电脑上使用")
  check(!guard.hasCloseBtn, "移动端硬拦截：不提供右上角关闭")

  await page.screenshot({ path: `${SHOT_DIR}/pc-guard-mobile.png` })
  await ctx.close()
}

// ============================================================
console.log("\n=== 6. PC 访问：引导安装扩展 ===")
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  /*
   * 注意：addInitScript 每次导航都会执行，所以**不能**在里面清
   * localStorage 的标记 —— 否则 reload 时会把刚写入的「不再提示」
   * 标记一并删掉，测出来永远是「还会弹出」。
   * 清理动作改为进入页面前执行一次（下面的 evaluate）。
   */
  await ctx.addInitScript(
    ([t, r]) => {
      localStorage.setItem("cagent.accessToken", t)
      localStorage.setItem("cagent.refreshToken", r || "")
    },
    [auth.token, auth.refresh]
  )
  const page = await ctx.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" })
  await page.evaluate(() => localStorage.removeItem("cagent.browser-tip-dismissed"))

  await page.goto(`${BASE}/browser`, { waitUntil: "networkidle" })
  await page.waitForTimeout(1900)

  const guard = await page.evaluate(() => {
    const dialog = document.querySelector(".pc-guard")
    if (!dialog || dialog.getClientRects().length === 0) return { shown: false }
    const text = dialog.textContent || ""
    return {
      shown: true,
      hasExtGuide: /chrome:\/\/extensions|开发者模式|加载已解压/.test(text),
      hasCopyInfo: /服务地址|会话 ID|访问令牌/.test(text),
      hasWebFallback: /网页端直连/.test(text),
      hasDismiss: /不再提示/.test(text)
    }
  })

  check(guard.shown, "PC 端弹出了引导")
  check(guard.hasExtGuide, "包含扩展安装步骤")
  check(guard.hasCopyInfo, "包含可复制的连接信息")
  check(guard.hasWebFallback, "提供「先用网页端直连」降级选项")
  check(guard.hasDismiss, "提供「不再提示」选项")

  await page.screenshot({ path: `${SHOT_DIR}/pc-guard-desktop.png` })

  // 「不再提示」应持久化
  await page.locator(".pcg-remember").click()
  await page.waitForTimeout(350)
  await page.locator("button:has-text('暂不安装')").click()
  await page.waitForTimeout(800)

  const marker = await page.evaluate(() =>
    localStorage.getItem("cagent.browser-tip-dismissed")
  )
  check(marker === "1", `「不再提示」已持久化（标记=${marker}）`)

  await page.reload({ waitUntil: "networkidle" })
  await page.waitForTimeout(2200)
  const afterReload = await page.evaluate(() => {
    const dialog = document.querySelector(".pc-guard")
    return {
      visible: dialog ? dialog.getClientRects().length > 0 : false,
      marker: localStorage.getItem("cagent.browser-tip-dismissed")
    }
  })
  check(
    !afterReload.visible,
    `刷新后不再弹出引导（标记仍为 ${afterReload.marker}）`
  )

  await ctx.close()
}

await browser.close()

console.log("\n" + "=".repeat(50))
if (failures === 0) {
  console.log("🎉 全部通过")
} else {
  console.log(`⚠️ ${failures} 项未通过`)
}
process.exit(failures === 0 ? 0 : 1)
