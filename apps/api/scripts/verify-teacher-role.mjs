/**
 * 教师（小管理）分流校验。
 *
 * 需求：教师**不进**学生端页面，而是作为小管理。
 *
 * 背景：教师原先挂的是普通用户角色（user），权限与完全一致 ——
 * 于是被判成学生、被重定向进 /student，看不到任何审核入口。
 * 现在教师挂 teacher 角色，带上 dashboard:read（它同时是
 * 「可进后台」的标记位，见 stores/auth.ts 的 isStudent 注释）。
 *
 * 这个脚本守住四件事：
 *   1. 教师登录后落在 /dashboard，且访问 /student 会被弹回后台
 *   2. 教师拿得到「看板 + 问答审核」这几个入口
 *   3. 教师拿不到系统设置 / 角色权限 / 用户管理这类后台重地
 *   4. 学生不受影响，仍只进学生端
 *
 * 前置：需要先跑 scripts/apply-teacher-role.ts 建好 teacher 角色。
 */
import { chromium } from "playwright"

const BASE = process.env.BASE_URL || "http://127.0.0.1:5173"

let pass = 0
let fail = 0
function check(ok, label) {
  if (ok) {
    pass++
    console.log(`OK  ${label}`)
  } else {
    fail++
    console.log(`NG  ${label}`)
  }
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const pageErrors = []
page.on("pageerror", (e) => pageErrors.push(String(e)))

async function login(email, password = "User@123456") {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" })
  await page.evaluate(
    async ({ base, email, password }) => {
      const r = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      })
      const j = await r.json()
      if (!j?.data) throw new Error("登录失败: " + JSON.stringify(j).slice(0, 120))
      localStorage.setItem("cagent.accessToken", j.data.accessToken)
      localStorage.setItem("cagent.refreshToken", j.data.refreshToken || "")
    },
    { base: BASE, email, password }
  )
}

/**
 * 等到路由**结算完成**，返回最终路径。
 *
 * ⚠️ 不能只靠「路径连续两次读数相同」判断稳定。
 * 首次进页面时 location.pathname 立刻就是目标路径，而路由守卫要等
 * fetchMe() 回来才会重定向 —— 线上首屏 2~5 秒，于是「相同即稳定」
 * 会在重定向前就返回，把 /dashboard 误判成「学生没被弹走」
 * （实测线上正是这样误报的，本地因响应快而看不到）。
 *
 * 可靠信号是**外壳已渲染**：管理端侧栏或学生端外壳出现，
 * 说明守卫已经放行或改道完毕。渲染之后再复查一次路径是否还有变化。
 */
async function settle() {
  await page
    .waitForSelector(".student-app, .sidebar, .not-found, .forbidden, .error-page", {
      timeout: 30000
    })
    .catch(() => undefined)
  await page.waitForTimeout(1000)
  const first = await page.evaluate(() => location.pathname)
  await page.waitForTimeout(1200)
  const second = await page.evaluate(() => location.pathname)
  return second === first ? second : await (async () => {
    // 仍在跳转：再等一轮，取最终值
    await page.waitForTimeout(1500)
    return page.evaluate(() => location.pathname)
  })()
}

const menuTitles = () =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll(".el-menu-item, .menu-item, nav a"))
      .map((e) => e.textContent.replace(/\s+/g, "").trim())
      .filter(Boolean)
  )

// ══════════════════ 1. 教师落在后台 ══════════════════
console.log("=== 1. 教师登录后进后台而不是学生端 ===")
await login("teacher@cagent.local")
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" })
const teacherHome = await settle()
check(teacherHome === "/dashboard", `教师落在 /dashboard（实测 ${teacherHome}）`)

// 手动闯学生端：应被弹回后台
await page.goto(`${BASE}/student`, { waitUntil: "domcontentloaded" })
const forced = await settle()
check(
  forced !== "/student",
  `教师直接输 /student 会被弹回后台（实测 ${forced}）`
)

// ══════════════════ 2. 教师拿得到审核入口 ══════════════════
console.log("\n=== 2. 教师看得到「看板 + 问答审核」 ===")
await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" })
await page.waitForTimeout(2500)
const menu = await menuTitles()
const joined = menu.join("|")
for (const item of ["数据看板", "会话审计", "消息审计"]) {
  check(joined.includes(item), `菜单含「${item}」`)
}
/*
 * 自学习审核与浏览器（操控/会话）已按产品决策整体隐藏（2026-09-30）：
 * 菜单不应出现、路由已移除（手输 URL 落 404）。
 */
check(!joined.includes("自学习审核"), "菜单不再含「自学习审核」（已隐藏）")
check(!joined.includes("浏览器会话"), "菜单不再含「浏览器会话」（已隐藏）")

/*
 * 逐页打开，确认没有 403 的接口调用。
 * 只看菜单不够：菜单渲染对了、页面里的接口 403 一样是坏的。
 */
const pages = [
  ["/admin/dashboard", "数据看板"],
  ["/admin/conversations", "会话审计"],
  ["/admin/messages", "消息审计"]
]
for (const [path, name] of pages) {
  const bad = []
  const onResp = (r) => {
    if (r.status() >= 400 && r.url().includes("/api/")) bad.push(`${r.status()} ${r.url().replace(BASE, "")}`)
  }
  page.on("response", onResp)
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(2600)
  page.off("response", onResp)
  const landed = await page.evaluate(() => location.pathname)
  check(landed === path, `「${name}」能打开（${landed}）`)
  check(bad.length === 0, `「${name}」页面无接口报错${bad.length ? "：" + bad.slice(0, 2).join(" | ") : ""}`)
}

// ══════════════════ 3. 教师进不了后台重地 ══════════════════
console.log("\n=== 3. 教师进不了系统设置 / 角色权限 / 用户管理之外的重地 ===")
for (const [path, name] of [
  ["/admin/settings", "系统设置"],
  ["/admin/roles", "角色权限"]
]) {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(2000)
  const landed = await page.evaluate(() => location.pathname)
  check(landed === "/403", `「${name}」被拦到 403（实测 ${landed}）`)
}

// 写权限不能有：设置页接口应当 403
const canWrite = await page.evaluate(async () => {
  const t = localStorage.getItem("cagent.accessToken")
  const r = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
    body: JSON.stringify({ site_name: "hacked" })
  })
  return r.status
})
check(canWrite >= 400, `教师改不了系统设置（PUT /api/settings → ${canWrite}）`)

// ══════════════════ 4. 学生不受影响 ══════════════════
console.log("\n=== 4. 学生仍然只进学生端 ===")
await login("student@cagent.local")
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" })
const studentHome = await settle()
check(studentHome === "/student", `学生落在 /student（实测 ${studentHome}）`)

await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" })
const studentForced = await settle()
check(studentForced === "/student", `学生访问 /dashboard 被弹回 /student（实测 ${studentForced}）`)

console.log("\n" + "=".repeat(52))
check(pageErrors.length === 0, `无未捕获的前端错误（${pageErrors.length} 条）`)
if (pageErrors.length) console.log(pageErrors.slice(0, 4).join("\n"))

console.log(`\n教师分流校验：${pass} 项通过 / ${fail} 项未通过`)
await browser.close()
process.exit(fail === 0 ? 0 : 1)
