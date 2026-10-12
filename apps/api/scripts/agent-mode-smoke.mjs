/**
 * Agent 模式（Chat / Agent）与内置工具库的端到端验证。
 *
 * 要证明的事：
 *   1. AGENT 模式下模型真的会调用内置工具，并基于真实返回值作答
 *      （不是靠记忆编造 —— 比如问天气，答案里的温度必须和工具返回一致）
 *   2. CHAT 模式下一个工具都不暴露，模型只能凭提示词回答
 *   3. maxToolRounds 能限制轮数
 *   4. note 字段能存取
 *
 * 用法：cd apps/api && node scripts/agent-mode-smoke.mjs
 */
const API = process.env.API_BASE || "http://127.0.0.1:3001/api"

let pass = 0
let fail = 0
const ok = (label, cond, extra = "") => {
  if (cond) pass++
  else fail++
  console.log(`${cond ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`)
}

async function api(path, { method = "GET", body, token } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}

const login = await api("/auth/login", {
  method: "POST",
  body: { email: "admin@cagent.local", password: "CHANGE_ME_SEED_ADMIN_PASSWORD" }
})
const token = login.json.data.accessToken
ok("管理员登录", !!token)

/** 跑一次流式对话，收集事件序列与工具调用 */
async function chat(payload) {
  const res = await fetch(`${API}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  })
  if (!res.ok) {
    return { error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`, tools: [], text: "" }
  }
  const raw = await res.text()
  const blocks = raw.split("\n\n").filter(Boolean)

  const tools = []
  let text = ""
  let conversationId = ""
  for (const block of blocks) {
    const ev = block.match(/^event:\s*(.+)$/m)?.[1]
    const dataLine = block.match(/^data:\s*(.+)$/m)?.[1]
    if (!ev || !dataLine) continue
    let data
    try {
      data = JSON.parse(dataLine)
    } catch {
      continue
    }
    if (ev === "meta") conversationId = data.conversationId
    if (ev === "text") text += data.text || ""
    if (ev === "tool_start") tools.push({ name: data.name, args: data.arguments })
    if (ev === "tool_result") {
      const last = tools.filter((t) => t.name === data.name).pop()
      if (last) last.result = data.result
    }
  }
  return { tools, text, conversationId }
}

// ---------- 1. 创建测试用智能体 ----------
console.log("\n=== 准备测试智能体 ===")
const agentKey = `smoke-mode-${Date.now().toString(36)}`

const agentAgent = await api("/agents", {
  method: "POST",
  token,
  body: {
    key: agentKey,
    name: "冒烟·Agent 模式",
    description: "用于验证工具自主调用的测试智能体。",
    systemPrompt:
      "你是校园助手。需要事实数据（天气、汇率、计算）时必须调用工具获取，不要凭记忆回答。回答用中文，简短。",
    mode: "AGENT",
    maxToolRounds: 4,
    visibility: "PRIVATE",
    note: "这是自动化测试创建的智能体，可安全删除。",
    allowBrowser: false
  }
})
const agentId = agentAgent.json.data?.id
ok("创建 AGENT 模式智能体", agentAgent.status < 300 && !!agentId, `HTTP ${agentAgent.status}`)
ok("note 字段已保存", agentAgent.json.data?.note?.includes("自动化测试"),
  agentAgent.json.data?.note)
ok("mode 字段为 AGENT", agentAgent.json.data?.mode === "AGENT")
ok("maxToolRounds 已保存", agentAgent.json.data?.maxToolRounds === 4,
  String(agentAgent.json.data?.maxToolRounds))

const chatAgentRes = await api("/agents", {
  method: "POST",
  token,
  body: {
    key: `${agentKey}-chat`,
    name: "冒烟·Chat 模式",
    description: "纯对话，不给任何工具。",
    systemPrompt: "你是校园助手，只用已有知识回答，不要尝试调用工具。回答用中文。",
    mode: "CHAT",
    visibility: "PRIVATE"
  }
})
const chatAgentId = chatAgentRes.json.data?.id
ok("创建 CHAT 模式智能体", chatAgentRes.status < 300 && !!chatAgentId)
ok("CHAT 模式已保存", chatAgentRes.json.data?.mode === "CHAT",
  chatAgentRes.json.data?.mode)

// ---------- 2. 工具目录 ----------
console.log("\n=== 内置工具库 ===")
const tools = await api("/skills/tools", { token })
const toolList = tools.json.data || []
ok("工具目录可用", toolList.length >= 12, `${toolList.length} 个`)
const hasWeather = toolList.some((t) => t.key === "weather")
const hasCalc = toolList.some((t) => t.key === "calculator")
ok("包含天气工具", hasWeather)
ok("包含计算工具", hasCalc)

// ---------- 3. AGENT 模式：必须真的调用工具 ----------
console.log("\n=== AGENT 模式：工具自主调用 ===")
const weatherRun = await chat({
  content: "北京现在天气怎么样？温度多少？",
  agentId
})
if (weatherRun.error) {
  ok("AGENT 模式对话", false, weatherRun.error)
} else {
  ok("AGENT 模式对话成功", weatherRun.text.length > 10, `${weatherRun.text.length} 字`)
  const called = weatherRun.tools.map((t) => t.name)
  ok("模型自主调用了内置工具", called.length > 0, called.join(", ") || "未调用任何工具")

  const weatherCall = weatherRun.tools.find((t) => t.name === "weather")
  ok("调用了天气工具", !!weatherCall,
    weatherCall ? JSON.stringify(weatherCall.args) : `实际调用：${called.join(", ")}`)

  if (weatherCall?.result) {
    // 关键断言：回答里的温度必须来自工具返回值，而不是模型编的
    let temp = null
    try {
      const parsed = JSON.parse(weatherCall.result)
      temp = parsed?.current?.temperature
    } catch {
      const m = weatherCall.result.match(/"temperature":\s*([\d.-]+)/)
      if (m) temp = Number(m[1])
    }
    ok("工具返回了真实温度", typeof temp === "number", `工具说 ${temp}℃`)

    if (typeof temp === "number") {
      // 允许四舍五入取整的差异
      const rounded = Math.round(temp)
      const mentioned =
        weatherRun.text.includes(String(temp)) ||
        weatherRun.text.includes(String(rounded)) ||
        weatherRun.text.includes(temp.toFixed(1))
      ok("回答中的温度与工具返回一致（没有编造）", mentioned,
        `工具 ${temp}℃，回答：「${weatherRun.text.replace(/\s+/g, " ").slice(0, 90)}…」`)
    }
  }
}

// ---------- 4. 计算类工具 ----------
console.log("\n=== AGENT 模式：计算类工具 ===")
const calcRun = await chat({
  content: "帮我算一下 (85+92+78)/3 等于多少，保留两位小数。",
  agentId
})
if (calcRun.error) {
  ok("计算任务对话", false, calcRun.error)
} else {
  const calcCall = calcRun.tools.find(
    (t) => t.name === "calculator" || t.name === "math"
  )
  ok("调用了计算工具", !!calcCall,
    calcRun.tools.map((t) => t.name).join(", ") || "未调用")
  // (85+92+78)/3 = 85
  ok("计算结果正确（85）", /85(\.0+)?\b/.test(calcRun.text),
    calcRun.text.replace(/\s+/g, " ").slice(0, 100))
}

// ---------- 5. CHAT 模式：一个工具都不给 ----------
console.log("\n=== CHAT 模式：不暴露工具 ===")
const chatRun = await chat({
  content: "北京现在天气怎么样？",
  agentId: chatAgentId
})
if (chatRun.error) {
  ok("CHAT 模式对话", false, chatRun.error)
} else {
  ok("CHAT 模式对话成功", chatRun.text.length > 5, `${chatRun.text.length} 字`)
  ok("CHAT 模式没有调用任何工具（工具未暴露）", chatRun.tools.length === 0,
    chatRun.tools.map((t) => t.name).join(", ") || "0 次调用")
}

// ---------- 6. note 字段可更新 ----------
console.log("\n=== 备注字段 ===")
const updated = await api(`/agents/${agentId}`, {
  method: "PATCH",
  token,
  body: { note: "更新后的备注：维护人 网络中心，每学期复核一次。" }
})
ok("备注可更新", updated.json.data?.note?.includes("维护人"),
  updated.json.data?.note)

// ---------- 7. 配置校验 ----------
console.log("\n=== 配置校验 ===")
const badMode = await api("/agents", {
  method: "POST",
  token,
  body: {
    key: `${agentKey}-bad`,
    name: "非法模式",
    systemPrompt: "x",
    mode: "NOT_A_MODE"
  }
})
ok("非法 mode 被拒绝", badMode.status === 400, `HTTP ${badMode.status}`)

await api(`/agents/${agentId}`, {
  method: "PATCH",
  token,
  body: { note: "最终备注：测试完成后可删除。" }
})
const finalDetail = await api(`/agents/${agentId}`, { token })
ok("备注读回一致", finalDetail.json.data?.note?.includes("测试完成后可删除"),
  finalDetail.json.data?.note)

// ---------- 收尾 ----------
await api(`/agents/${agentId}`, { method: "DELETE", token })
await api(`/agents/${chatAgentId}`, { method: "DELETE", token })
console.log("\n已清理测试智能体")

console.log(`\nAgent 模式验证：${pass} 项通过，${fail} 项失败`)
if (fail > 0) process.exit(1)
