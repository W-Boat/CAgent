/**
 * 真实模型是否按协议输出 ```card。
 *
 * 前面所有卡片测试都靠注入 SSE —— 那只验证「模型给了卡片，前端渲染对不对」，
 * 没验证更根本的一环：**给了协议提示词后，真实模型到底会不会照做**。
 * 这一环不测，整套「模型驱动卡片」可能是永远不触发的死代码。
 *
 * ── 为什么直接打 API 而不是走浏览器 ──
 *
 * 浏览器路径要先选对模型。学生端「新建对话」会沿用上一条会话的模型，
 * 而本机只有 deepseek 配了 Key，其余供应商都没配 ——
 * 走浏览器时实测继承了「通义千问」，于是每次都失败在
 * 「供应商尚未配置 API Key」，测出来的 0% 是配置的锅，不是协议的锅。
 * 这里显式指定模型，把变量收敛到一个。
 *
 * 用法：node apps/api/scripts/verify-card-protocol-real.mjs [modelKey]
 * 会消耗少量模型额度。
 */
const API = process.env.API_BASE || "http://127.0.0.1:3001/api"
const MODEL_KEY = process.argv[2] || process.env.MODEL_KEY || "deepseek-chat"

/** 明显该出卡片的问题：流程 → steps，多选一 → options，办事 → guide */
const CASES = [
  {
    q: "我校园卡丢了，请告诉我一步步怎么办理。",
    expect: ["steps", "guide", "options"]
  },
  {
    q: "我想预约学校的心理咨询，具体流程是什么？",
    expect: ["steps", "guide"]
  },
  {
    q: "期末压力很大，不知道从哪儿开始，给我几个方向让我挑。",
    expect: ["options", "guide"]
  }
]

const login = await fetch(`${API}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "student@cagent.local", password: "User@123456" })
}).then((r) => r.json())
if (!login?.data?.accessToken) {
  console.error("登录失败：", JSON.stringify(login).slice(0, 200))
  process.exit(1)
}
const token = login.data.accessToken

const models = await fetch(`${API}/models/available`, {
  headers: { Authorization: `Bearer ${token}` }
}).then((r) => r.json())
const model = (models.data || []).find((m) => m.key === MODEL_KEY)
if (!model) {
  console.error(`模型 ${MODEL_KEY} 不在可用列表里`)
  process.exit(1)
}

/*
 * 取协议提示词：读前端已经落库的那份，而不是在脚本里重抄。
 *
 * 曾想过两种做法，都不行：
 *   1. import 前端的 .ts —— Node 对 TS 的支持跨版本不稳定，
 *      还会把校验脚本绑到构建工具链上；
 *   2. 正则抠出模板字符串再手工反转义 —— 转义层级一多必错，
 *      而且抠出来的文本和真正发给模型的可能悄悄不一致。
 *
 * 学生端建会话时已把协议原样写进 conversation.systemPrompt，
 * 后端每条消息都会把它拼进 systemPrompts。所以直接读那条记录，
 * 测的就是线上真实发出去的那串字，零改写、零再转义。
 */
const convs = await fetch(`${API}/conversations?page=1&pageSize=50`, {
  headers: { Authorization: `Bearer ${token}` }
}).then((r) => r.json())

const withProto = (convs?.data?.items || []).find((c) =>
  (c.systemPrompt || "").includes("card")
)
if (!withProto) {
  console.error(
    "没有找到带卡片协议的会话。\n" +
      "  先用学生端发一条消息（前端会自动建带协议的会话），再跑本脚本。"
  )
  process.exit(1)
}
const protocol = withProto.systemPrompt
console.log(`协议取自会话「${withProto.title}」，${protocol.length} 字`)


let hits = 0
let validJson = 0
let total = 0

for (const c of CASES) {
  const conv = await fetch(`${API}/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title: "协议实测", modelId: model.id, systemPrompt: protocol })
  }).then((r) => r.json())

  const res = await fetch(`${API}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      Accept: "text/event-stream"
    },
    body: JSON.stringify({ conversationId: conv.data.id, content: c.q })
  })

  if (!res.ok) {
    console.log(`✗ 「${c.q.slice(0, 20)}…」HTTP ${res.status} ${await res.text().then((t) => t.slice(0, 120))}`)
    continue
  }

  const text = await res.text()
  let reply = ""
  let err = ""
  for (const block of text.split("\n\n")) {
    let ev = "message"
    const dl = []
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) ev = line.slice(6).trim()
      else if (line.startsWith("data:")) dl.push(line.slice(5).trimStart())
    }
    if (!dl.length) continue
    try {
      const d = JSON.parse(dl.join("\n"))
      if (ev === "text") reply += d.text || ""
      if (ev === "error") err = d.message || "unknown"
    } catch {
      /* 忽略非 JSON 帧 */
    }
  }

  if (err) {
    console.log(`✗ 「${c.q.slice(0, 22)}…」模型报错：${err}`)
    continue
  }

  total++
  // 与前端同一套解析：按行找 ```card 围栏
  const fences = [...reply.matchAll(/```card\s*\n([\s\S]*?)\n```/g)].map((m) => m[1])
  const types = []
  let bad = 0
  for (const f of fences) {
    try {
      const j = JSON.parse(f)
      types.push(j.type)
      if (!Array.isArray(j.options) || j.type !== "options") void 0 // 结构宽松
    } catch {
      bad++
    }
  }

  const matched = types.some((t) => c.expect.includes(t))
  if (fences.length) hits++
  if (fences.length && bad === 0) validJson++

  const mark = fences.length ? (matched ? "✓" : "△") : "✗"
  console.log(
    `${mark} 「${c.q.slice(0, 24)}…」 ${reply.length} 字｜卡片 ${fences.length} 张 [${types.join(",") || "无"}]` +
      (bad ? `｜⚠ ${bad} 张 JSON 不合法` : "") +
      (fences.length && !matched ? `｜期望 ${c.expect.join("/")}` : "")
  )
}

console.log("\n" + "=".repeat(56))
console.log(`出卡率 ${hits}/${total}｜其中 JSON 全部合法 ${validJson}/${hits}`)
if (hits === 0) {
  console.log(
    "\n⚠ 真实模型一次都没按协议输出卡片。\n" +
      "  模型驱动卡片这一路实际不可用，当前只有欢迎页的内置卡片在工作。\n" +
      "  可选方向：(a) 强化协议（给 few-shot 示例）；(b) 改为前端在特定意图下\n" +
      "  主动渲染内置卡，不依赖模型自觉；(c) 用支持结构化输出的模型/函数调用。"
  )
} else if (validJson < hits) {
  console.log("\n⚠ 有卡片输出但 JSON 不合法 —— 前端会降级成代码块，需收紧协议措辞")
} else {
  console.log("\n✓ 协议有效：真实模型会按格式输出卡片")
}
process.exit(hits > 0 ? 0 : 2)
