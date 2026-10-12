/**
 * 移动端登录页布局验证：模拟 360x640 / 390x844 视口，
 * 检查页面内容是否超出视口高度、底部元素是否可达（可滚动到）。
 */
import { chromium } from "playwright"

const BASE = process.env.BASE_URL || "http://localhost:5173"
const VIEWPORTS = [
  { name: "iPhone 5/SE1", width: 320, height: 568 },
  { name: "iPhone SE2", width: 375, height: 667 },
  { name: "iPhone 12", width: 390, height: 844 },
  { name: "小屏安卓", width: 360, height: 640 },
  { name: "横屏手机", width: 667, height: 375 }
]

const browser = await chromium.launch({ headless: true })

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2
  })
  const page = await context.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" })
  await page.waitForTimeout(600)

  const result = await page.evaluate(() => {
    const doc = document.documentElement
    const panel = document.querySelector(".auth-panel")
    const btn = document.querySelector(".submit-btn")
    const demo = document.querySelector(".demo-accounts")
    const foot = document.querySelector(".panel-foot")

    const rect = (el) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) }
    }

    return {
      scrollHeight: doc.scrollHeight,
      clientHeight: doc.clientHeight,
      canScroll: doc.scrollHeight > doc.clientHeight,
      panel: rect(panel),
      submitBtn: rect(btn),
      demoAccounts: rect(demo),
      panelFoot: rect(foot),
      hasHorizontalOverflow: doc.scrollWidth > doc.clientWidth
    }
  })

  // 关键判断：底部元素（注册链接 / 演示账号）必须能通过滚动看到
  let bottomReachable = true
  if (result.panelFoot || result.demoAccounts) {
    const target = result.demoAccounts || result.panelFoot
    await page.evaluate((y) => window.scrollTo(0, y), 2000)
    await page.waitForTimeout(300)
    bottomReachable = await page.evaluate((sel) => {
      const el = document.querySelector(sel)
      if (!el) return true
      const r = el.getBoundingClientRect()
      return r.bottom <= window.innerHeight + 2 && r.top >= -2
    }, result.demoAccounts ? ".demo-accounts" : ".panel-foot")
  }

  console.log(`\n[${vp.name} ${vp.width}x${vp.height}]`)
  console.log(`  文档高度=${result.scrollHeight} 视口=${result.clientHeight} 可滚动=${result.canScroll}`)
  console.log(`  横向溢出=${result.hasHorizontalOverflow}`)
  console.log(`  登录按钮 bottom=${result.submitBtn?.bottom}`)
  console.log(`  演示账号 bottom=${result.demoAccounts?.bottom ?? "(无)"}`)
  console.log(`  底部链接 bottom=${result.panelFoot?.bottom ?? "(无)"}`)
  console.log(`  >>> 底部元素滚动后可见: ${bottomReachable ? "✅" : "❌"}`)

  await context.close()
}

await browser.close()
