/**
 * 导览「指给我看」专项冒烟：
 * 验证 highlight 支持 (a) CSS 选择器 与 (b) 页面可见文字定位，
 * 并确认只做视觉标注、不产生任何点击。
 *
 * 用法：cd apps/api && node scripts/campus-highlight-smoke.mjs
 */
const BASE = process.env.API_BASE || "http://127.0.0.1:3001/api"

async function api(path, { method = "GET", body, token } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json).slice(0, 300)}`)
  }
  return json.data
}

const ok = (label, cond, extra = "") =>
  console.log(`${cond ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`)

async function main() {
  const login = await api("/auth/login", {
    method: "POST",
    body: { email: "admin@cagent.local", password: "CHANGE_ME_SEED_ADMIN_PASSWORD" }
  })
  const token = login.accessToken

  // 直接用网址开一个必然可渲染的公网页（CAS 登录页），确保 DOM 里有文字
  const opened = await api("/campus/runs", {
    method: "POST",
    token,
    body: { url: "https://authserver.ucass.edu.cn/authserver/login" }
  })
  ok("按 url 打开", !!opened.runId, `pageOk=${opened.pageOk}，${opened.frame?.title ?? ""}`)
  if (opened.openError) console.log(`   ⚠️ ${opened.openError.slice(0, 140)}`)

  // 1. 文字定位（最小的包含关键字的元素）
  const byText = await api(`/campus/runs/${opened.runId}/highlight`, {
    method: "POST",
    token,
    body: { text: "登录", label: "看这里：登录按钮在这里" }
  })
  ok("按文字定位高亮", byText.matched > 0, `命中 ${byText.matched} 个元素`)
  ok("高亮后回传新画面", !!byText.screenshotPath, byText.screenshotPath ?? "")

  // 2. 选择器定位
  const bySel = await api(`/campus/runs/${opened.runId}/highlight`, {
    method: "POST",
    token,
    body: { selector: "input", label: "输入框" }
  })
  ok("按选择器定位高亮", bySel.matched > 0, `命中 ${bySel.matched} 个元素`)

  // 3. 清除
  const cleared = await api(`/campus/runs/${opened.runId}/highlight`, {
    method: "POST",
    token,
    body: { clear: true }
  })
  ok("清除标注", cleared.cleared === true)

  // 4. 滚动（学生主动触发）
  const scrolled = await api(`/campus/runs/${opened.runId}/scroll`, {
    method: "POST",
    token,
    body: { y: 400 }
  })
  ok("滚动页面", scrolled.success === true && !!scrolled.frame)

  // 5. 只标注不点击：页面地址不能变
  const frame = await api(`/campus/runs/${opened.runId}/frame`, { token })
  ok("页面未被导航（说明没有代点）", frame.url === opened.frame.url, frame.url.slice(0, 90))

  await api(`/campus/runs/${opened.runId}/close`, { method: "POST", token })
  console.log("\n「指给我看」专项冒烟完成 🎉")
}

main().catch((err) => {
  console.error("\n❌ 失败：", err.message)
  process.exit(1)
})