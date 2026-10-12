/**
 * 检查「触控目标偏小」的元素是否真的可点。
 *
 * 审计脚本会报出 <i>/<span> 这类元素尺寸不足，但它们通常是
 * 按钮内部的图标容器——真正响应点击的是父级 <button>。
 * 这里把父级尺寸一并打出来，判断是否属于误报。
 */
import { chromium, devices } from "playwright"

const BASE = process.env.BASE_URL || "http://127.0.0.1:5173"
const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices["iPhone 12"] })
const page = await ctx.newPage()

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" })
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

for (const path of ["/chat", "/browser"]) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" })
  await page.waitForTimeout(1400)

  const rows = await page.evaluate(() => {
    const out = []
    for (const el of Array.from(document.querySelectorAll("i, span"))) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      if (r.height >= 32 && r.width >= 24) continue
      const cs = getComputedStyle(el)
      if (cs.display === "none" || cs.visibility === "hidden") continue

      // 往上找最近的可点击祖先
      let clickable = el.parentElement
      let depth = 0
      while (clickable && depth < 4) {
        const tag = clickable.tagName.toLowerCase()
        if (tag === "button" || tag === "a" || clickable.getAttribute("role") === "button") break
        clickable = clickable.parentElement
        depth++
      }
      const cr = clickable?.getBoundingClientRect()
      out.push({
        tag: el.tagName.toLowerCase(),
        cls: String(el.className || "").slice(0, 40),
        size: `${Math.round(r.width)}x${Math.round(r.height)}`,
        clickableTag: clickable ? clickable.tagName.toLowerCase() : "(无)",
        clickableCls: clickable ? String(clickable.className || "").slice(0, 40) : "",
        clickableSize: cr ? `${Math.round(cr.width)}x${Math.round(cr.height)}` : "-"
      })
    }
    return out.slice(0, 8)
  })

  console.log(`\n=== ${path} ===`)
  for (const r of rows) {
    const ok = r.clickableSize !== "-" && !/x(1?\d|2\d)$/.test(r.clickableSize)
    console.log(
      `  <${r.tag} class="${r.cls}"> ${r.size}` +
        `  → 可点祖先 <${r.clickableTag} class="${r.clickableCls}"> ${r.clickableSize}` +
        `  ${ok ? "✅ 可点区域足够" : "⚠️ 需处理"}`
    )
  }
}

await browser.close()
