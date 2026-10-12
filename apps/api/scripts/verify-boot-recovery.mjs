/**
 * 启动失败态的可操作性验证。
 *
 * 前一个审计只确认「按钮存在」，这里要确认它们**真的能用** ——
 * 失败提示如果不能自救，等于没做。
 */
import { chromium, devices } from "playwright"

const BASE = process.env.BASE_URL || "http://127.0.0.1:4173"
let failures = 0
const check = (cond, msg) => {
  console.log(`${cond ? "OK " : "NG "} ${msg}`)
  if (!cond) failures++
}

const browser = await chromium.launch()

// ============================================================
console.log("=== 1. 「重新加载」真的能恢复 ===")
{
  const ctx = await browser.newContext()
  const page = await ctx.newPage()

  // 先让入口 JS 失败，制造失败态
  let blockJs = true
  await page.route("**/assets/index-*.js", (route) => {
    if (blockJs) route.abort("failed")
    else route.continue()
  })

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(20000)

  const failed = await page.evaluate(
    () => !!document.querySelector(".boot-failed")
  )
  check(failed, "已进入失败态")

  // 放行 JS，点「重新加载」应能恢复
  blockJs = false
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => undefined),
    page.locator(".boot-actions button").first().click()
  ])
  await page.waitForTimeout(4000)

  const recovered = await page.evaluate(() => {
    const splash = document.querySelector(".boot-splash")
    const bootFail = document.querySelector(".boot-failed")
    return {
      splashGone: !splash || splash.getClientRects().length === 0,
      stillFailed: !!bootFail,
      appLen: document.querySelector("#app")?.innerHTML.length ?? -1
    }
  })
  check(!recovered.stillFailed, "重试后不再是失败态")
  check(recovered.appLen > 500, `应用已正常渲染（#app 长度 ${recovered.appLen}）`)

  await ctx.close()
}

// ============================================================
console.log("\n=== 2. 「先去登录页」能跳出卡死 ===")
{
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  /*
   * 必须让接口「挂起」而不是 abort。
   * abort 会让请求立刻失败，路由守卫随即判定未登录并跳转 /login，
   * 根本进不到失败态 —— 那是另一种（正常的）降级路径。
   * 只有后端假死（连接建立但不返回）才会真的卡住，这才是要兜底的场景。
   */
  await page.route("**/api/**", () => {
    /* 既不 fulfill 也不 abort：请求一直挂着 */
  })

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(22000)

  const hasBtn = await page.locator(".boot-actions button").count()
  check(hasBtn >= 2, `挂起场景下提供两个入口（${hasBtn} 个）`)

  if (hasBtn >= 2) {
    // 「先去登录页」是第二个按钮，用整页跳转绕开半初始化的路由
    await page.locator(".boot-actions button").nth(1).click()
    await page.waitForTimeout(2500)
    const url = page.url()
    check(url.includes("/login"), `已跳转到登录页（${url}）`)
  }

  await ctx.close()
}

// ============================================================
console.log("\n=== 3. 暗色模式下失败态配色正确 ===")
{
  const ctx = await browser.newContext()
  await ctx.addInitScript(() => localStorage.setItem("cagent-theme", "dark"))
  const page = await ctx.newPage()
  await page.route("**/assets/index-*.js", (route) => route.abort("failed"))

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(20000)

  const style = await page.evaluate(() => {
    const box = document.querySelector(".boot-loading")
    const btnPrimary = document.querySelector(".boot-actions .boot-btn.primary")
    const btnPlain = document.querySelector(".boot-actions .boot-btn:not(.primary)")
    if (!box) return null
    return {
      isFailed: box.classList.contains("boot-failed"),
      textColor: getComputedStyle(box.querySelector("[data-boot-text]")).color,
      // 主按钮刻意用品牌蓝，这里要验的是**次要按钮**在暗色下不发白
      primaryBg: btnPrimary ? getComputedStyle(btnPrimary).backgroundColor : "",
      plainBg: btnPlain ? getComputedStyle(btnPlain).backgroundColor : "",
      plainColor: btnPlain ? getComputedStyle(btnPlain).color : "",
      plainBorder: btnPlain ? getComputedStyle(btnPlain).borderColor : ""
    }
  })

  check(!!style, "失败态已渲染")
  if (style) {
    /** 相对亮度（WCAG），比「三个通道都小于某值」更贴合实际观感 */
    const luminance = (s) => {
      const m = String(s).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
      if (!m) return NaN
      const f = (v) => {
        const c = Number(v) / 255
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
      }
      return 0.2126 * f(m[1]) + 0.7152 * f(m[2]) + 0.0722 * f(m[3])
    }

    const bgLum = luminance(style.plainBg)
    const fgLum = luminance(style.plainColor)
    const borderLum = luminance(style.plainBorder)

    // 暗色下按钮底色必须是深色（亮度低）
    check(bgLum < 0.05, `次要按钮底色为深色（${style.plainBg}，亮度 ${bgLum.toFixed(3)}）`)
    // 文字要比底色亮得多，否则看不清
    check(
      fgLum > bgLum * 5,
      `次要按钮文字与底色对比充足（${style.plainColor} 亮度 ${fgLum.toFixed(3)}）`
    )
    // 边框应介于两者之间，既可见又不刺眼
    check(
      borderLum > bgLum && borderLum < fgLum,
      `边框亮度介于底色与文字之间（${style.plainBorder}，亮度 ${borderLum.toFixed(3)}）`
    )
    // 主按钮是品牌色，暗色下保持蓝底白字即可
    check(
      /rgb\(37,\s*99,\s*235\)/.test(style.primaryBg),
      `主按钮保持品牌蓝（${style.primaryBg}）`
    )
  }

  await page.screenshot({ path: "storage/shots/boot-dark-failed.png" })
  await ctx.close()
}

// ============================================================
console.log("\n=== 4. 失败态在移动端不溢出 ===")
{
  const ctx = await browser.newContext({ ...devices["iPhone 12"] })
  const page = await ctx.newPage()
  await page.route("**/assets/index-*.js", (route) => route.abort("failed"))
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(20000)

  const layout = await page.evaluate(() => {
    const vw = window.innerWidth
    const buttons = Array.from(document.querySelectorAll(".boot-actions button"))
    return {
      overflow: document.documentElement.scrollWidth > vw + 2,
      buttonsVisible: buttons.filter((b) => b.getClientRects().length > 0).length,
      // 按钮是否都点得到（没有被挤出视口）
      allInView: buttons.every((b) => {
        const r = b.getBoundingClientRect()
        return r.left >= 0 && r.right <= vw && r.height >= 32
      })
    }
  })

  check(!layout.overflow, "移动端无横向溢出")
  check(layout.buttonsVisible === 2, `两个按钮都可见（${layout.buttonsVisible}）`)
  check(layout.allInView, "按钮都在视口内且可点（高度 ≥32px）")

  await page.screenshot({ path: "storage/shots/boot-mobile-failed.png" })
  await ctx.close()
}

await browser.close()
console.log("\n" + "=".repeat(48))
console.log(failures === 0 ? "失败态可操作性验证通过" : `${failures} 项需要修复`)
process.exit(failures === 0 ? 0 : 1)
