/**
 * 智能体 browser_control 降级路径测试。
 *
 * 服务器不装 Chromium，工具应退回 HTTP 抓取并仍返回可用正文，
 * 而不是抛错让对话中断。
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
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`)
  try {
    return JSON.parse(text)?.data ?? JSON.parse(text)
  } catch {
    return text
  }
}

const main = async () => {
  const login = await call("/auth/login", {
    method: "POST",
    body: { email: "admin@cagent.local", password: "CHANGE_ME_SEED_ADMIN_PASSWORD" }
  })
  const token = login.accessToken
  console.log("✅ 登录成功")

  // 用一个真实可访问的静态页验证 HTTP 抓取链路
  const target = "https://example.com"
  console.log(`\n=== 用 SSE 让智能体调用 browser_control 抓 ${target} ===`)

  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      content: `请用 browser_control 工具打开 ${target}，然后告诉我这个页面的标题是什么。`,
      agentId: undefined
    })
  })

  if (!res.ok) {
    console.log(`❌ 对话请求失败：HTTP ${res.status}`)
    process.exit(1)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let toolCalled = false
  let toolResult = ""
  let finalText = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const events = buffer.split("\n\n")
    buffer = events.pop() || ""

    for (const evt of events) {
      const typeMatch = evt.match(/^event: (.+)$/m)
      const dataMatch = evt.match(/^data: (.+)$/m)
      if (!typeMatch || !dataMatch) continue
      const type = typeMatch[1]
      let payload
      try {
        payload = JSON.parse(dataMatch[1])
      } catch {
        continue
      }

      if (type === "tool_start") {
        toolCalled = true
        console.log(`  → 调用工具：${payload.name}`)
      }
      if (type === "tool_result") {
        toolResult = String(payload.result || "")
        console.log(`  ← 工具返回 ${toolResult.length} 字符`)
      }
      if (type === "text") finalText += payload.text || ""
      if (type === "error") console.log(`  ⚠️ 错误事件：${payload.message}`)
    }
  }

  console.log("\n=== 结果 ===")
  if (!toolCalled) {
    console.log("⚠️ 模型未调用 browser_control（可能直接作答）")
    console.log("回复片段：", finalText.slice(0, 200))
  } else {
    const looksLikeHttp = toolResult.includes("由 HTTP 抓取获得")
    const hasTitle = /Example Domain/i.test(toolResult)
    console.log(`${looksLikeHttp ? "✅" : "⚠️"} 走了 HTTP 抓取降级路径：${looksLikeHttp}`)
    console.log(`${hasTitle ? "✅" : "❌"} 抓到页面标题 Example Domain：${hasTitle}`)
    console.log(`   工具结果片段：${toolResult.slice(0, 220)}`)
  }
  console.log(`\n最终回复片段：${finalText.slice(0, 200)}`)
}

main().catch((err) => {
  console.error("❌ 测试异常：", err.message)
  process.exit(1)
})
