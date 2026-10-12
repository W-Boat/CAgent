/**
 * 启动遮罩（boot splash）审计。
 *
 * 「卡屏黑屏」在启动阶段有几种真实成因，逐个复现：
 *
 *   1. JS 加载失败（chunk 404 / 网络中断）→ 占位无休止转圈，用户无法自救
 *   2. 接口挂起（后端无响应）→ app.mount 清空占位后渲染不出内容 = 纯空白
 *   3. 暗色启动类 dark-boot 残留 → 与正式主题类叠加
 *   4. 占位与真实应用之间的「白闪」
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

/**
 * 等待启动占位撤下。
 *
 * 不用固定 sleep：线上经 Cloudflare 首屏可能 5-10 秒，固定值必然误报。
 * 轮询真实状态，超时才判定失败 —— 这也正是用户实际关心的问题
 * （「到底会不会一直卡着」）。
 */
async function waitSplashGone(page, timeoutMs = 25000) {
  try {
    await page.waitForFunction(
      () => {
        const splash = document.querySelector(".boot-splash")
        return !splash || splash.getClientRects().length === 0
      },
      { timeout: timeoutMs }
    )
    return true
  } catch {
    return false
  }
}

const browser = await chromium.launch()

// ============================================================
console.log("=== 1. JS 加载失败：必须给出提示与重试入口 ===")
{
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  // 拦截入口 JS，模拟 CDN 挂掉 / chunk 404
  await page.route("**/assets/index-*.js", (route) => route.abort("failed"))

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" })
  // 失败提示在 18s 触发，留出余量
  await page.waitForTimeout(21000)

  const state = await page.evaluate(() => {
    const splash = document.getElementById("boot-splash")
    const box = splash?.querySelector(".boot-loading")
    return {
      splashShowing: !!splash && splash.getClientRects().length > 0,
      failedClass: !!box && box.classList.contains("boot-failed"),
      hasRetry: !!splash?.querySelector(".boot-actions button"),
      text: (splash?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120)
    }
  })

  check(state.splashShowing, "占位仍在显示（未白屏）")
  check(state.failedClass, "已切换到失败态")
  check(state.hasRetry, "提供了重试按钮")
  console.log(`   文案：${JSON.stringify(state.text)}`)

  await page.screenshot({ path: `${SHOT_DIR}/boot-js-failed.png` })
  await ctx.close()
}

// ============================================================
console.log("\n=== 2. 接口挂起：不能停在空白页 ===")
{
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  // 让所有 API 永不响应，模拟后端假死
  await page.route("**/api/**", () => {
    /* 既不 fulfill 也不 abort，请求一直挂着 */
  })

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(23000)

  const state = await page.evaluate(() => {
    const splash = document.querySelector(".boot-splash")
    const box = document.querySelector(".boot-loading")
    return {
      splashShowing: !!splash && splash.getClientRects().length > 0,
      failedClass: !!box && box.classList.contains("boot-failed"),
      hasRetry: !!document.querySelector(".boot-splash .boot-actions button"),
      bodyText: (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 100)
    }
  })

  /*
   * 关键：mount 会清空 index.html 占位，若路由一直卡着，
   * 就必须由 Vue 侧再盖一层（.boot-splash），否则是纯空白。
   */
  check(state.splashShowing, "挂起 23s 后仍有可见占位（不是纯空白）")
  check(state.hasRetry, "给出了重试入口")
  console.log(`   可见文本：${JSON.stringify(state.bodyText)}`)

  await page.screenshot({ path: `${SHOT_DIR}/boot-api-hang.png` })
  await ctx.close()
}

// ============================================================
console.log("\n=== 3. 慢加载安抚（5s 后换文案）===")
{
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  // 延迟 API 响应，制造「偏慢但最终成功」的场景
  await page.route("**/api/settings/public", async (route) => {
    await new Promise((r) => setTimeout(r, 9000))
    await route.continue()
  })

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" })

  /*
   * 等安抚文案出现，而不是固定 sleep 7 秒。
   * 线上首屏本身就慢，固定等待可能落在「还没到 5 秒」或「已经加载完」，
   * 两种都会误报。直接等那个文案出现才是准的。
   */
  const slowShown = await page
    .waitForFunction(
      () => {
        const splash = document.querySelector(".boot-splash")
        return /较慢|继续加载/.test(splash?.textContent || "")
      },
      { timeout: 30000 }
    )
    .then(() => true)
    .catch(() => false)

  const slow = await page.evaluate(() => {
    const splash = document.querySelector(".boot-splash")
    return {
      showing: !!splash && splash.getClientRects().length > 0,
      text: (splash?.textContent || "").replace(/\s+/g, " ").trim()
    }
  })
  check(slowShown && slow.showing, "慢加载期间占位仍在且已切换安抚文案")
  console.log(`   文案：${JSON.stringify(slow.text.slice(0, 60))}`)

  // 等接口返回后占位应自动撤下
  const gone = await waitSplashGone(page, 30000)
  const done = await page.evaluate(() => ({
    appLen: document.querySelector("#app")?.innerHTML.length ?? -1
  }))
  check(gone, "接口恢复后占位已撤下")
  check(done.appLen > 500, `应用已渲染（#app 长度 ${done.appLen}）`)
  await ctx.close()
}

// ============================================================
console.log("\n=== 4. 暗色启动：无 dark-boot 残留、无白闪 ===")
{
  const ctx = await browser.newContext()
  await ctx.addInitScript(() => localStorage.setItem("cagent-theme", "dark"))
  const page = await ctx.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" })

  /*
   * 首帧判色必须尽早采样：等到 main.ts 挂载后再读，测的就是应用样式
   * 而不是「防白闪」那层。这里在 domcontentloaded 立刻取一次 body 背景。
   */
  const early = await page.evaluate(() => ({
    bg: getComputedStyle(document.body).backgroundColor
  }))
  const isDarkRgb = (s) => {
    const m = String(s).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
    if (!m) return false
    // 深色判定：三通道都较低
    return Number(m[1]) < 60 && Number(m[2]) < 60 && Number(m[3]) < 60
  }
  check(isDarkRgb(early.bg), `首帧即深色，无白闪（${early.bg}）`)

  await waitSplashGone(page, 25000)
  const late = await page.evaluate(() => ({
    htmlClass: document.documentElement.className,
    isDark: document.documentElement.classList.contains("dark"),
    darkBoot: document.documentElement.classList.contains("dark-boot")
  }))
  check(late.isDark, "暗色主题已应用")
  check(!late.darkBoot, `dark-boot 已清理（html class="${late.htmlClass}"）`)
  await ctx.close()
}

// ============================================================
console.log("\n=== 5. 正常启动：占位撤下、无残留遮挡 ===")
{
  for (const [name, device] of [
    ["桌面", null],
    ["移动", { ...devices["iPhone 12"] }]
  ]) {
    const ctx = await browser.newContext(device ? device : {})
    const page = await ctx.newPage()
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" })

    // 轮询真实就绪状态，而不是赌一个固定等待时长
    const gone = await waitSplashGone(page, 30000)
    await page.waitForTimeout(600)

    const state = await page.evaluate(() => {
      const boot = document.querySelector(".boot-splash")
      const app = document.querySelector("#app")
      // 全屏且拦截点击的残留层
      const blockers = Array.from(document.querySelectorAll("body *")).filter((el) => {
        const cs = getComputedStyle(el)
        if (cs.position !== "fixed") return false
        if (cs.pointerEvents === "none" || cs.display === "none") return false
        const r = el.getBoundingClientRect()
        return r.width > window.innerWidth * 0.9 && r.height > window.innerHeight * 0.9
      }).length
      return {
        bootStillThere: !!boot,
        appLen: app?.innerHTML.length ?? -1,
        blockers
      }
    })

    check(gone && !state.bootStillThere, `${name}端：占位已撤下`)
    check(state.appLen > 500, `${name}端：应用已渲染（#app 长度 ${state.appLen}）`)
    check(state.blockers === 0, `${name}端：无全屏遮挡层残留（${state.blockers} 个）`)
    await ctx.close()
  }
}

await browser.close()
console.log("\n" + "=".repeat(48))
console.log(failures === 0 ? "启动遮罩全部检查通过" : `${failures} 项需要修复`)
process.exit(failures === 0 ? 0 : 1)
