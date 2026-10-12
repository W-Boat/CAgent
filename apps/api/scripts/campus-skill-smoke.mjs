/**
 * 融合验证：技能 campus-guide 与智能体 ucass-guide 是否真正接上校园导览数据。
 *
 * 用法：cd apps/api && node scripts/campus-skill-smoke.mjs
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
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json).slice(0, 300)}`)
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

  // 1. 技能是否注册
  const skills = await api("/skills", { token })
  const list = Array.isArray(skills) ? skills : (skills.items ?? [])
  const campus = list.find((s) => s.key === "campus-guide" || s.code === "campus-guide")
  ok("技能已注册", !!campus, campus ? `${campus.name}（${campus.type}，权限 ${campus.permissionCode}）` : "未找到")

  // 2. 跑一次技能
  if (campus) {
    const run = await api(`/skills/${campus.id}/run`, {
      method: "POST",
      token,
      body: { input: { query: "校园卡丢了怎么补办" } }
    })
    const text = typeof run === "string" ? run : (run.output?.text ?? run.text ?? JSON.stringify(run))
    ok("技能命中导览索引", String(text).includes("入口") || String(text).includes("网络中心"),
      `${String(text).length} 字`)
    console.log("  预览：", String(text).replace(/\s+/g, " ").slice(0, 200))
    if (run.output?.hits) {
      ok("技能返回结构化命中", run.output.hits.length > 0, `${run.output.hits.length} 条`)
    }
    if (run.output?.mode) console.log(`  模式：${run.output.mode}，快照：${run.output.verifiedAt ?? "-"}`)
  }

  // 3. 智能体是否注册且挂了 campus-guide 技能
  const agents = await api("/agents", { token })
  const agentList = Array.isArray(agents) ? agents : (agents.items ?? [])
  const guide = agentList.find((a) => a.code === "ucass-guide" || a.key === "ucass-guide" || a.name?.includes("校园导览"))
  ok("智能体已注册", !!guide, guide ? `${guide.name}｜技能 ${(guide.skills ?? []).map((s) => s.key ?? s.code ?? s).join(", ")}` : "未找到")
  if (guide) {
    ok("智能体允许浏览器", guide.allowBrowser === true)
    ok("智能体是公开可见", guide.visibility === "PUBLIC", guide.visibility)
    const sp = guide.systemPrompt || ""
    ok("系统提示含「指路不代办」纪律", /指路|不代办|代为/.test(sp), `${sp.length} 字`)
    ok("系统提示要求给出核实时间", /2026-09-23|核实/.test(sp))
  }

  console.log("\n技能 / 智能体融合验证完成 🎉")
}

main().catch((err) => {
  console.error("\n❌ 失败：", err.message)
  process.exit(1)
})