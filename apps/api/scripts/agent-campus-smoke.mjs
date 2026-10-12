/**
 * 端到端：让**真实的**「社科大校园导览」智能体回答一个校园问题，
 * 验证它确实接上了校园导览能力，而不是在凭空编。
 *
 * 判定要点：
 *   - 答案里出现索引中的真实事实（部门 / 电话 / 地点）
 *   - 出现数据核实时间（硬性规则）
 *   - 不出现代办口吻（「我帮你提交 / 已为你办理」这类）
 *
 * 用法：cd apps/api && node scripts/agent-campus-smoke.mjs
 */
const API = process.env.API_BASE || "http://127.0.0.1:3001/api"
const EMAIL = process.env.SHOOT_EMAIL || "admin@cagent.local"
const PASSWORD = process.env.SHOOT_PASSWORD || "CHANGE_ME_SEED_ADMIN_PASSWORD"
const QUESTION = process.argv[2] || "校园卡丢了怎么补办？我该去哪、带什么？"

const ok = (label, cond, extra = "") =>
  console.log(`${cond ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`)

async function main() {
  const login = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD })
  }).then((r) => r.json())
  const token = login.data.accessToken

  // 找到播种出来的导览智能体
  const agents = await fetch(`${API}/agents`, {
    headers: { Authorization: `Bearer ${token}` }
  }).then((r) => r.json())
  const list = Array.isArray(agents.data) ? agents.data : (agents.data.items ?? [])
  const agent = list.find((a) => a.key === "ucass-guide")
  if (!agent) throw new Error("未找到 ucass-guide 智能体")
  console.log(`智能体：${agent.name}（${agent.id}）`)
  console.log(`问题：${QUESTION}\n`)

  const models = await fetch(`${API}/models`, {
    headers: { Authorization: `Bearer ${token}` }
  }).then((r) => r.json())
  const model = models.data.find((m) => m.key === "deepseek-chat") || models.data[0]
  console.log(`模型：${model.key}`)

  const res = await fetch(`${API}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ content: QUESTION, modelId: model.id, agentId: agent.id })
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let text = ""
  const events = []
  const tools = []

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
      if (name === "text") text += payload?.text ?? payload?.delta ?? ""
      if (/tool/i.test(name)) {
        tools.push(`${name}:${JSON.stringify(payload).slice(0, 160)}`)
      }
      if (name === "error") console.log(`[error] ${JSON.stringify(payload)}`)
    }
  }

  console.log(`\n事件序列：${[...new Set(events)].join(", ")}`)
  if (tools.length) {
    console.log(`工具事件 ${tools.length} 条：`)
    tools.slice(0, 6).forEach((t) => console.log("  " + t))
  }
  console.log(`\n模型回复：\n${text}\n`)

  const answer = text.replace(/\s+/g, " ")
  ok("产生了回答", answer.length > 40, `${answer.length} 字`)

  const dept = (answer.match(/网络中心|教务处|研究生院|图书馆|后勤|学生处/) || [])[0]
  ok("引用了索引里的办理部门", !!dept, dept ?? "未出现任何部门（说明没拿到索引数据）")

  const place = (answer.match(/010-\d{7,8}|新教学综合楼|望京校区办公楼|办公楼/) || [])[0]
  ok("给出了可核实的联系方式或地点", !!place, place ?? "未出现地点/电话")

  ok("标注了数据核实时间", /2026-09-23|核实于/.test(answer),
    (answer.match(/2026-09-23/) || [])[0] ?? "未标注")
  ok("没有代办口吻（不代替学生办理）",
    !/我(已经)?(帮你|替你)(提交|办理|填写|登录)|已为你(提交|办理|完成)/.test(answer))
  ok("没有 tool 结果未序列化（[object Object]）",
    !answer.includes("[object Object]"))
  ok("通篇中文，无英文开场白",
    !/^[A-Za-z][^。！？\n]{0,60}[.！]?\s*(?=\*\*|【|\S)/.test(answer.trim()),
    answer.slice(0, 40))

  console.log("\n智能体端到端验证完成 🎉")
}

main().catch((err) => {
  console.error("\n❌ 失败：", err.message)
  process.exit(1)
})