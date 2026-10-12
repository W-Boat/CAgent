/**
 * 学生端聊天前端的端到端校验。
 *
 * 覆盖三件事：
 *   1. 学生登录后确实落在 /student，且**看不到任何管理端导航**
 *   2. 学生直接输入管理端 URL 会被重定向回 /student（前端守卫生效）
 *   3. 中国风外观与暗色模式正常渲染（截图 + 关键元素计算样式）
 *   4. 管理员不受影响，仍能进工作台与后台
 *
 * 用法：node apps/api/scripts/verify-student-ui.mjs
 * 前提：API(3001) 与 web(5173) 均已启动，且已 seed 过数据库。
 */
import { chromium } from "playwright"
import { mkdirSync } from "node:fs"

const BASE = process.env.BASE_URL || "http://127.0.0.1:5173"
const SHOTS = "storage/shots"
mkdirSync(SHOTS, { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()

let failures = 0
let checks = 0
const check = (cond, msg) => {
  checks++
  console.log(`${cond ? "OK " : "NG "} ${msg}`)
  if (!cond) failures++
}

/** 把令牌写进 localStorage 并进入指定路径 */
async function signInAs(email, password, path) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" })
  const res = await page.evaluate(
    async ({ base, email, password }) => {
      const r = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      })
      const j = await r.json()
      if (!j?.data?.accessToken) return { ok: false, raw: JSON.stringify(j).slice(0, 200) }
      localStorage.setItem("cagent.accessToken", j.data.accessToken)
      localStorage.setItem("cagent.refreshToken", j.data.refreshToken || "")
      return { ok: true, permissions: j.data.user.permissions }
    },
    { base: BASE, email, password }
  )
  if (!res.ok) throw new Error(`登录失败: ${res.raw}`)
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" })
  // 等首屏挂载（等元素而不是估时长，理由见 waitForApp）
  await page
    .waitForSelector(".student-app, .layout", { timeout: 20000 })
    .catch(() => undefined)
  await page.waitForTimeout(300)
  return res.permissions
}

/**
 * 轮询等待路径变为期望值。
 *
 * ⚠️ 不要用固定 waitForTimeout 等待重定向 —— 本地够用，线上会假失败。
 *
 * 线上一次「学生被重定向」要经过：首屏 JS 下载 → 路由守卫 fetchMe →
 * 二次导航，在云服务器 + Cloudflare 下实测 1.7~4.6 秒，而本地通常
 * 200ms 内完成。曾经因为写死 1500ms 而在生产环境误报 5 项失败，
 * 实际功能完全正常 —— 是测试在「估时间」，而不是在「等条件」。
 *
 * @param expected 期望的 pathname
 * @param timeoutMs 上限；超时返回当前实际路径，供失败信息定位问题
 */
async function waitForPath(expected, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  let current = new URL(page.url()).pathname
  while (Date.now() < deadline) {
    current = new URL(page.url()).pathname
    if (current === expected) return current
    await page.waitForTimeout(150)
  }
  return current
}

/**
 * 等首屏渲染完成。
 *
 * 统一收口「导航后要等多久」这件事：等**元素出现**而不是等固定时长。
 * 线上（云服务器 + Cloudflare）从 HTML 到界面可用要 2~5 秒，
 * 本地往往不到 1 秒 —— 任何写死的等待都会在某一端出错。
 *
 * @param selector 标志性元素，出现即认为首屏就绪
 */
async function waitForApp(selector = ".student-app", timeoutMs = 20000) {
  await page.waitForSelector(selector, { timeout: timeoutMs }).catch(() => undefined)
  // 再给一帧，确保样式与数据驱动的渲染都已落定
  await page.waitForTimeout(300)
}

console.log("=== 1. 学生登录后的落地页 ===")
await signInAs("student@cagent.local", "User@123456", "/login")
const afterLogin = await waitForPath("/student")
check(afterLogin === "/student", `学生登录后落在 ${afterLogin}（期望 /student）`)

console.log("\n=== 2. 学生端看不到管理端外壳 ===")
const shell = await page.evaluate(() => ({
  hasSidebar: !!document.querySelector(".sidebar"),
  hasTopbar: !!document.querySelector(".topbar"),
  hasMenuItems: document.querySelectorAll(".menu-item").length,
  // 学生端自己的外壳
  hasStudentApp: !!document.querySelector(".student-app"),
  hasSeal: !!document.querySelector(".sc-seal"),
  sealText: document.querySelector(".sc-seal")?.textContent?.trim() || "",
  // 管理端独有的菜单文案不应出现
  bodyHasAdminText: /用户管理|角色权限|审计日志|系统设置|数据看板/.test(
    document.body.innerText || ""
  )
}))
check(!shell.hasSidebar, "无管理端侧边栏 .sidebar")
check(!shell.hasTopbar, "无管理端顶栏 .topbar")
check(shell.hasMenuItems === 0, `无管理端菜单项（实到 ${shell.hasMenuItems} 个）`)
check(shell.hasStudentApp, "学生端外壳 .student-app 存在")
check(shell.hasSeal && shell.sealText.length > 0, `朱砂印章已渲染（「${shell.sealText}」）`)
// 印章必须是汉字才有中国风的味道，取到拉丁字母说明回退逻辑被误触
check(
  /[\u4e00-\u9fa5]/.test(shell.sealText),
  `印章为汉字（「${shell.sealText}」），不是拉丁字母`
)
check(!shell.bodyHasAdminText, "页面上不出现任何后台功能文案")

console.log("\n=== 3. 学生直接访问其他路径被重定向 ===")
const blocked = [
  "/dashboard",
  "/admin/users",
  "/admin/settings",
  "/skills",
  "/agents",
  "/memory",
  "/usage",
  "/profile",
  "/chat"
]
for (const path of blocked) {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" })
  // 轮询而不是估时间 —— 理由见 waitForPath 的说明
  const landed = await waitForPath("/student")
  check(landed === "/student", `${path} → ${landed}`)
}

console.log("\n=== 4. 中国风外观 ===")
await page.goto(`${BASE}/student`, { waitUntil: "domcontentloaded" })
await waitForApp(".sc-seal")

const theme = await page.evaluate(() => {
  const app = document.querySelector(".student-app")
  if (!app) return null
  const cs = getComputedStyle(app)
  const seal = document.querySelector(".sc-seal")
  const sealCs = seal ? getComputedStyle(seal) : null
  const send = document.querySelector(".sc-send")
  const sendCs = send ? getComputedStyle(send) : null
  return {
    paper: cs.getPropertyValue("--sc-paper").trim(),
    ink: cs.getPropertyValue("--sc-ink").trim(),
    cinnabar: cs.getPropertyValue("--sc-cinnabar").trim(),
    sealBg: sealCs?.backgroundColor || "",
    sendBg: sendCs?.backgroundColor || "",
    bg: cs.backgroundColor,
    font: cs.fontFamily
  }
})
check(!!theme, "能读到学生端主题令牌")
if (theme) {
  console.log(`     宣纸 --sc-paper=${theme.paper}  墨 --sc-ink=${theme.ink}  朱砂 --sc-cinnabar=${theme.cinnabar}`)
  check(theme.paper.length > 0, "宣纸底色令牌已定义")
  check(theme.cinnabar.length > 0, "朱砂点缀色令牌已定义")
  // 朱砂是红色系：R 明显大于 G/B
  const m = theme.sealBg.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
  check(
    !!m && Number(m[1]) > Number(m[2]) && Number(m[1]) > Number(m[3]),
    `印章是朱砂红（${theme.sealBg}）`
  )
  check(/Songti|STSong|SimSun|serif/i.test(theme.font), "标题使用衬线字体（书卷气）")
}

await page.screenshot({ path: `${SHOTS}/student-light.png`, fullPage: false })
console.log(`     截图 → ${SHOTS}/student-light.png`)

console.log("\n=== 4b. 智能体头像不出现碎图 ===")
/*
 * 数据库里智能体的 avatar 存的是 emoji（"🧭"、"🏫"），不是图片地址。
 * 若模板写成 `<img :src="a.avatar">`，浏览器会去请求名为「🧭」的资源，
 * 每张卡片都显示碎图占位符 —— 实测踩过。
 *
 * 判据：卡片里要么是正常加载完成的 <img>（naturalWidth > 0），
 * 要么根本没有 <img>。**不允许出现 naturalWidth === 0 的图片**。
 *
 * 智能体卡片只在「空对话」的欢迎态出现，因此先点「新建对话」。
 */
await page.click(".sc-new")
await page.waitForTimeout(900)

const avatars = await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll(".sc-agent"))
  return cards.map((c) => {
    const img = c.querySelector("img")
    const name = c.querySelector(".sc-agent-name")?.textContent?.trim() || ""
    return {
      name,
      hasImg: !!img,
      // 加载成功才有非零宽度；碎图为 0
      broken: img ? img.naturalWidth === 0 : false,
      text: (c.querySelector(".sc-agent-avatar")?.textContent || "").trim()
    }
  })
})
const broken = avatars.filter((a) => a.broken)
console.log(`     智能体卡片 ${avatars.length} 个，碎图 ${broken.length} 个`)
if (broken.length) console.log(`     碎图：${broken.map((b) => b.name).join(", ")}`)
check(avatars.length > 0, "页面上存在智能体卡片（断言有对象）")
check(broken.length === 0, "无碎图占位符（emoji 头像按文本渲染）")

console.log("\n=== 5. 暗色模式 ===")
await page.evaluate(() => localStorage.setItem("cagent-theme", "dark"))
await page.reload({ waitUntil: "domcontentloaded" })
await waitForApp(".student-app")
const dark = await page.evaluate(() => {
  const app = document.querySelector(".student-app")
  return {
    isDarkClass: app?.classList.contains("is-dark") ?? false,
    paper: app ? getComputedStyle(app).getPropertyValue("--sc-paper").trim() : "",
    bg: app ? getComputedStyle(app).backgroundColor : ""
  }
})
check(dark.isDarkClass, "暗色模式已应用 .is-dark")
check(dark.paper === "#14120f", `暗色纸色为墨色（${dark.paper}）`)
await page.screenshot({ path: `${SHOTS}/student-dark.png`, fullPage: false })
console.log(`     截图 → ${SHOTS}/student-dark.png`)

console.log("\n=== 6. 移动端（抽屉式会话列表）===")
await page.setViewportSize({ width: 390, height: 844 })
await page.evaluate(() => localStorage.setItem("cagent-theme", "light"))
await page.reload({ waitUntil: "domcontentloaded" })

/*
 * 等元素出现，而不是等固定时长。
 * 线上「重新加载 → 下载 JS → 拉数据 → 渲染侧栏」比本地慢得多，
 * 写死 2600ms 会偶发拿不到 .sc-side（实测在云服务器上失败过一次）。
 */
await page
  .waitForSelector(".sc-side", { timeout: 20000 })
  .catch(() => undefined)
await page.waitForTimeout(400)

const mobile = await page.evaluate(() => {
  const side = document.querySelector(".sc-side")
  const burger = document.querySelector(".sc-hamburger")
  if (!side) return null
  const cs = getComputedStyle(side)
  return {
    position: cs.position,
    transform: cs.transform,
    burgerVisible: burger ? getComputedStyle(burger).display !== "none" : false,
    // 侧栏应已被 transform 移出视口
    offscreen: side.getBoundingClientRect().right <= 1
  }
})
check(!!mobile, "移动端能读到侧栏")
if (mobile) {
  check(mobile.position === "fixed", `窄屏侧栏转为固定定位（${mobile.position}）`)
  check(mobile.burgerVisible, "汉堡按钮可见")
  check(mobile.offscreen, "侧栏默认收起（已移出视口）")
}
await page.screenshot({ path: `${SHOTS}/student-mobile.png`, fullPage: false })
console.log(`     截图 → ${SHOTS}/student-mobile.png`)

console.log("\n=== 7. 顶栏进度条节点（切页反馈）===")
await page.setViewportSize({ width: 1440, height: 900 })
const bar = await page.evaluate(() => {
  const el = document.getElementById("cg-route-progress")
  return el ? getComputedStyle(el).position : null
})
check(bar === "fixed", `路由进度条已创建且固定定位（${bar}）`)

console.log("\n=== 8. 管理员不受影响 ===")
await page.evaluate(() => localStorage.clear())
await signInAs("admin@cagent.local", "CHANGE_ME_SEED_ADMIN_PASSWORD", "/dashboard")
// 同样轮询而非估时间：管理端侧边栏渲染完才算到达
const adminPath = await waitForPath("/dashboard")
check(adminPath === "/dashboard", `管理员落在 ${adminPath}（期望 /dashboard，未被学生守卫拦截）`)
const adminShell = await page.evaluate(() => ({
  hasSidebar: !!document.querySelector(".sidebar"),
  menuItems: document.querySelectorAll(".menu-item").length
}))
check(adminShell.hasSidebar, "管理员仍能看到管理端侧边栏")
check(adminShell.menuItems > 5 && adminShell.menuItems <= 23, `管理端菜单正常（${adminShell.menuItems} 项，隐藏浏览器与自学习后上限 23）`)

// 管理员访问 /student 也应正常（不是硬性禁止，只是学生专属入口）
await page.goto(`${BASE}/student`, { waitUntil: "domcontentloaded" })
await waitForApp(".student-app")
const adminOnStudent = new URL(page.url()).pathname
check(adminOnStudent === "/student", `管理员可查看学生端 ${adminOnStudent}`)

await browser.close()

console.log("\n" + "=".repeat(52))
console.log(
  failures === 0
    ? `学生端校验全部通过（${checks} 项）`
    : `${failures}/${checks} 项未通过`
)
process.exit(failures === 0 ? 0 : 1)
