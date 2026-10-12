/**
 * 本地浏览器指令队列端到端测试。
 *
 * 验证：创建 LOCAL 会话 → 下发指令 → 模拟本地客户端领取 → 回填结果（含截图）
 * → 服务端留痕（BrowserStep）→ 截图落盘可访问。
 */
const BASE = process.env.API_BASE || "http://127.0.0.1:3001/api"

async function call(path, { method = "GET", token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text }
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json).slice(0, 300)}`)
  }
  return json?.data ?? json
}

const log = (ok, msg) => console.log(`${ok ? "✅" : "❌"} ${msg}`)
let failures = 0
function check(cond, msg) {
  log(cond, msg)
  if (!cond) failures++
}

// 1x1 透明 PNG，用作模拟截图
const FAKE_PNG =
  "data:image/png;base64," +
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=="

const main = async () => {
  console.log("=== 1. 登录 ===")
  const login = await call("/auth/login", {
    method: "POST",
    body: { email: "admin@cagent.local", password: "CHANGE_ME_SEED_ADMIN_PASSWORD" }
  })
  const token = login.accessToken
  check(!!token, `登录成功（token ${token?.length ?? 0} 字符）`)

  console.log("\n=== 2. 创建本地会话（LOCAL）===")
  const session = await call("/browser/sessions", {
    method: "POST",
    token,
    body: {
      name: "本地执行测试",
      executor: "LOCAL",
      clientKind: "WEB",
      startUrl: "https://example.com"
    }
  })
  check(session.id?.length > 0, `会话已创建：${session.id}`)
  check(session.executor === "LOCAL", `执行器为 LOCAL（实际 ${session.executor}）`)

  console.log("\n=== 3. 下发指令 ===")
  const cmd = await call(`/browser/sessions/${session.id}/commands`, {
    method: "POST",
    token,
    body: { action: "extract", selector: "body" }
  })
  check(cmd.status === "PENDING", `指令入队，状态 ${cmd.status}，seq=${cmd.seq}`)

  console.log("\n=== 4. 本地客户端领取 ===")
  const claimed = await call(`/browser/sessions/${session.id}/commands/claim`, {
    method: "POST",
    token,
    body: { clientKind: "WEB" }
  })
  check(claimed.command?.id === cmd.id, `领取到指令 ${claimed.command?.id}`)

  console.log("\n=== 5. 串行性：再有指令时不应重复下发 ===")
  const second = await call(`/browser/sessions/${session.id}/commands/claim`, {
    method: "POST",
    token,
    body: { clientKind: "WEB" }
  })
  check(second.command === null, "同会话串行执行（执行中不再下发新指令）")

  console.log("\n=== 6. 回填结果 + 截图 ===")
  const report = await call(`/browser/commands/${cmd.id}/report`, {
    method: "POST",
    token,
    body: {
      ok: true,
      result: { url: "https://example.com", title: "Example", text: "测试正文" },
      screenshot: FAKE_PNG,
      url: "https://example.com",
      title: "Example Domain",
      durationMs: 42
    }
  })
  check(report.success === true, "回填成功")
  check(!!report.screenshotPath, `截图已落盘：${report.screenshotPath}`)

  console.log("\n=== 7. 服务端留痕（BrowserStep）===")
  const detail = await call(`/browser/sessions/${session.id}`, { token })
  check(detail.steps?.length === 1, `操作轨迹记录了 ${detail.steps?.length} 步`)
  check(detail.steps?.[0]?.status === "SUCCESS", `步骤状态 ${detail.steps?.[0]?.status}`)
  check(detail.steps?.[0]?.screenshotPath?.length > 0, "步骤含截图路径")
  check(detail.currentUrl === "https://example.com", `会话 URL 已更新：${detail.currentUrl}`)

  console.log("\n=== 8. 指令状态回查 ===")
  const list = await call(`/browser/sessions/${session.id}/commands`, { token })
  const done = list.items?.find((c) => c.id === cmd.id)
  check(done?.status === "DONE", `指令状态 ${done?.status}`)
  check(done?.durationMs === 42, `耗时记录 ${done?.durationMs}ms`)

  console.log("\n=== 9. 心跳与在线状态 ===")
  await call(`/browser/sessions/${session.id}/heartbeat`, {
    method: "POST",
    token,
    body: { clientKind: "WEB" }
  })
  const after = await call(`/browser/sessions/${session.id}`, { token })
  check(after.clientOnline === true, "心跳后显示本地浏览器在线")

  console.log("\n=== 10. 截图可通过 /static 访问 ===")
  const asset = await fetch(
    `http://127.0.0.1:3001/static/${report.screenshotPath}`.replace(/\/+/g, "/").replace(":/", "://")
  )
  check(asset.ok, `截图可访问（HTTP ${asset.status}）`)

  console.log("\n=== 11. 关闭会话会作废未完成指令 ===")
  await call(`/browser/sessions/${session.id}/commands`, {
    method: "POST",
    token,
    body: { action: "click", selector: "#nope" }
  })
  await call(`/browser/sessions/${session.id}`, { method: "DELETE", token })
  const closed = await call(`/browser/sessions/${session.id}/commands`, { token }).catch(
    () => null
  )
  const pending = closed?.items?.filter((c) => c.status === "PENDING") ?? []
  check(pending.length === 0, `关闭后无遗留 PENDING 指令（${pending.length} 条）`)

  console.log(
    failures === 0
      ? "\n🎉 全部通过"
      : `\n⚠️ 有 ${failures} 项未通过`
  )
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error("\n❌ 测试异常：", err.message)
  process.exit(1)
})
