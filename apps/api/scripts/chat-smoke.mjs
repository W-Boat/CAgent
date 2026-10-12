/**
 * 通过 SSE 接口跑一次真实对话，验证流式输出、技能调用与用量落库。
 * 用法：node scripts/chat-smoke.mjs "你的问题"
 */
import { existsSync, readFileSync } from "node:fs"

const API = process.env.API_BASE || "http://127.0.0.1:3001/api"
const EMAIL = process.env.SHOOT_EMAIL || "admin@cagent.local"
const PASSWORD = process.env.SHOOT_PASSWORD || "CHANGE_ME_SEED_ADMIN_PASSWORD"
const prompt = process.argv[2] || "请用一句话说明你可以帮学生做什么。"

const login = await fetch(`${API}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD })
}).then((r) => r.json())
if (login.code !== 0) throw new Error(`登录失败: ${login.message}`)
const token = login.data.accessToken

const models = await fetch(`${API}/models`, {
  headers: { Authorization: `Bearer ${token}` }
}).then((r) => r.json())
const model = models.data.find((m) => m.key === "deepseek-chat") || models.data[0]
console.log(`使用模型：${model.key}（${model.name}）`)

const res = await fetch(`${API}/chat/completions`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    Authorization: `Bearer ${token}`
  },
  body: JSON.stringify({ content: prompt, modelId: model.id })
})

if (!res.ok) {
  console.log(`HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`)
  process.exit(1)
}

const reader = res.body.getReader()
const decoder = new TextDecoder()
let buffer = ""
let text = ""
const events = []
let conversationId = ""

while (true) {
  const { done, value } = await reader.read()
  if (done) break
  buffer += decoder.decode(value, { stream: true })
  const chunks = buffer.split("\n\n")
  buffer = chunks.pop() || ""
  for (const chunk of chunks) {
    const evLine = chunk.split("\n").find((l) => l.startsWith("event:"))
    const dataLine = chunk.split("\n").find((l) => l.startsWith("data:"))
    if (!evLine || !dataLine) continue
    const name = evLine.slice(6).trim()
    let payload = null
    try {
      payload = JSON.parse(dataLine.slice(5).trim())
    } catch {
      payload = dataLine.slice(5).trim()
    }
    events.push(name)
    if (name === "meta") conversationId = payload?.conversationId || ""
    if (name === "text") text += payload?.text ?? payload?.delta ?? ""
    if (name === "tool_call" || name === "tool_start" || name === "tool_result") {
      console.log(`[${name}] ${JSON.stringify(payload).slice(0, 200)}`)
    }
    if (name === "usage") console.log(`[usage] ${JSON.stringify(payload)}`)
    if (name === "error") console.log(`[error] ${JSON.stringify(payload)}`)
  }
}

console.log(`\n事件序列：${events.join(" -> ")}`)
console.log(`conversationId=${conversationId}`)
console.log(`\n模型回复：\n${text}`)

if (conversationId) {
  const detail = await fetch(`${API}/conversations/${conversationId}`, {
    headers: { Authorization: `Bearer ${token}` }
  }).then((r) => r.json())
  console.log(`\n会话消息数=${detail.data?.messages?.length} 标题=${detail.data?.title}`)
}

const usage = await fetch(`${API}/usage/me`, {
  headers: { Authorization: `Bearer ${token}` }
}).then((r) => r.json())
console.log(
  `\n用量：请求 ${usage.data.overview.totals.requests} 次，Token ${usage.data.overview.totals.totalTokens}`
)

if (!existsSync("noop")) {
  try {
    readFileSync("noop")
  } catch {
    /* ignore */
  }
}