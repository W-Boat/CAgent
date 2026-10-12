/**
 * 校园导览「无服务端浏览器」降级测试。
 *
 * 服务器不装 Chromium 时，导览必须仍然可用：
 *   1. open 返回完整指引（hints / banner / policy）
 *   2. hasLiveFrame=false，frame 为 null，sessionId 为 null
 *   3. 调用 frame 接口返回 SERVER_BROWSER_DISABLED（前端据此停止轮询）
 *   4. 步骤打卡（advance）不依赖浏览器，仍然可用
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
  return { status: res.status, ok: res.ok, body: json?.data ?? json, envelope: json }
}

let failures = 0
const check = (cond, msg) => {
  console.log(`${cond ? "✅" : "❌"} ${msg}`)
  if (!cond) failures++
}

const main = async () => {
  const login = await call("/auth/login", {
    method: "POST",
    body: { email: "admin@cagent.local", password: "CHANGE_ME_SEED_ADMIN_PASSWORD" }
  })
  const token = login.body.accessToken
  check(!!token, "登录成功")

  console.log("\n=== 1. 检索导览条目 ===")
  const search = await call("/campus/search?q=%E6%A0%A1%E5%9B%AD%E5%8D%A1&limit=3", { token })
  const hits = search.body?.hits || []
  check(hits.length > 0, `检索到 ${hits.length} 条（${hits[0]?.title ?? "无"}）`)

  console.log("\n=== 2. 打开导览（服务器无浏览器）===")
  const opened = await call("/campus/runs", {
    method: "POST",
    token,
    body: { itemId: hits[0].id, mode: "guide", width: 900, height: 600 }
  })
  const res = opened.body
  check(opened.ok, `open 接口返回 ${opened.status}`)
  check(typeof res?.runId === "string", `导览记录已创建：${res?.runId}`)
  check(res?.sessionId === null, `sessionId 为 null（无浏览器会话）：${res?.sessionId}`)
  check(res?.frame === null, `frame 为 null：${JSON.stringify(res?.frame)}`)
  check(res?.hasLiveFrame === false, `hasLiveFrame=false：${res?.hasLiveFrame}`)

  console.log("\n=== 3. 指引内容完整（降级不影响核心价值）===")
  check(Array.isArray(res?.hints) && res.hints.length > 0, `分步指引 ${res?.hints?.length} 条`)
  check(typeof res?.banner === "string", `横幅文案已给出`)
  check(res?.policy?.openOnly === true, `策略仍是「只打开不代办」`)
  const warns = res?.warnings || []
  check(
    warns.some((w) => w.includes("服务器不渲染页面")),
    `已提示用户自行打开：${warns.find((w) => w.includes("服务器不渲染")) || "(未找到)"}`
  )

  console.log("\n=== 4. frame 接口明确告知不可用 ===")
  const frameRes = await call(`/campus/runs/${res.runId}/frame`, { token })
  check(
    frameRes.status === 400 && String(frameRes.body?.message || "").includes("SERVER_BROWSER_DISABLED"),
    `frame 返回 400 + SERVER_BROWSER_DISABLED（HTTP ${frameRes.status}）`
  )

  console.log("\n=== 5. 步骤打卡不依赖浏览器 ===")
  const advance = await call(`/campus/runs/${res.runId}/steps`, {
    method: "POST",
    token,
    body: { step: 1, done: true }
  })
  check(advance.ok, `步骤打卡成功（HTTP ${advance.status}）`)
  check(
    advance.body?.doneCount === 1,
    `已完成计数 = ${advance.body?.doneCount}`
  )

  console.log("\n=== 6. 回看导览记录 ===")
  const detail = await call(`/campus/runs/${res.runId}`, { token })
  check(detail.ok, `记录可回看（HTTP ${detail.status}）`)
  check(
    Array.isArray(detail.body?.hints) && detail.body.hints.length > 0,
    `回看仍带 ${detail.body?.hints?.length} 条指引`
  )

  console.log("\n=== 7. 结束导览 ===")
  const closed = await call(`/campus/runs/${res.runId}/close`, { method: "POST", token })
  check(closed.ok, `结束成功（HTTP ${closed.status}）`)

  console.log(failures === 0 ? "\n🎉 全部通过" : `\n⚠️ ${failures} 项未通过`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error("\n❌ 测试异常：", err.message)
  process.exit(1)
})
