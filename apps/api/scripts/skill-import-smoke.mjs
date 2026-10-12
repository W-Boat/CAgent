/**
 * 技能导入接口冒烟测试。
 *
 * 覆盖三种格式（JSON / Markdown / 纯文本）、预览模式、冲突处理三种策略，
 * 以及导入后技能是否真的能跑。
 *
 * 用法：cd apps/api && node scripts/skill-import-smoke.mjs
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
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}

const login = await api("/auth/login", {
  method: "POST",
  body: { email: "admin@cagent.local", password: "CHANGE_ME_SEED_ADMIN_PASSWORD" }
})
const token = login.json.data.accessToken
ok("管理员登录", !!token)

const created = []

// ---------- 1. 内置工具目录 ----------
console.log("\n=== 内置工具目录 ===")
const tools = await api("/skills/tools", { token })
ok("工具目录可访问", tools.status === 200 && Array.isArray(tools.json.data),
  `HTTP ${tools.status}`)
const toolList = tools.json.data || []
ok("工具数量充足", toolList.length >= 12, `${toolList.length} 个内置工具`)
ok("每个工具都有名称/描述/分类",
  toolList.every((t) => t.name && t.description && t.category))
ok("目录里不泄露 handler 实现",
  toolList.every((t) => !("handler" in t)))
const noKey = toolList.filter((t) => !t.requiresKey).length
ok("多数工具无需额外密钥即可用", noKey >= 10, `${noKey}/${toolList.length} 个零配置`)
console.log("   工具：" + toolList.map((t) => t.name).join("、"))

// ---------- 2. JSON 导入 ----------
console.log("\n=== JSON 导入 ===")
const jsonSkill = {
  key: "smoke-json-skill",
  name: "冒烟测试技能",
  description: "由导入测试创建的技能，用于验证 JSON 导入链路。",
  type: "PROMPT",
  category: "测试",
  icon: "MagicStick",
  systemPrompt: "你是一个测试助手，请用一句话回答。"
}
const dry = await api("/skills/import", {
  method: "POST",
  token,
  body: { content: JSON.stringify(jsonSkill), dryRun: true }
})
ok("预览模式不落库", dry.status === 201 && dry.json.data?.dryRun === true,
  `format=${dry.json.data?.format}`)
ok("预览识别出 JSON 格式", dry.json.data?.format === "json")
ok("预览解析出正确名称", dry.json.data?.name === "冒烟测试技能")
ok("预览报告 key 是否已存在", dry.json.data?.exists === false)

const imp = await api("/skills/import", {
  method: "POST",
  token,
  body: { content: JSON.stringify(jsonSkill) }
})
ok("JSON 导入成功", imp.status === 201 && imp.json.data?.created === true,
  `key=${imp.json.data?.key}`)
if (imp.json.data?.skill?.id) created.push(imp.json.data.skill)

// ---------- 3. 冲突处理 ----------
console.log("\n=== 冲突处理 ===")
const skip = await api("/skills/import", {
  method: "POST",
  token,
  body: { content: JSON.stringify(jsonSkill), onConflict: "skip" }
})
ok("skip 策略跳过已存在技能", skip.json.data?.skipped === true,
  skip.json.data?.reason)

const rename = await api("/skills/import", {
  method: "POST",
  token,
  body: { content: JSON.stringify(jsonSkill), onConflict: "rename" }
})
ok("rename 策略自动改名", /-2$/.test(rename.json.data?.key || ""),
  `${imp.json.data?.key} → ${rename.json.data?.key}`)
if (rename.json.data?.skill?.id) created.push(rename.json.data.skill)

const overwrite = await api("/skills/import", {
  method: "POST",
  token,
  body: {
    content: JSON.stringify({ ...jsonSkill, description: "被覆盖后的新描述。" }),
    onConflict: "overwrite"
  }
})
ok("overwrite 策略覆盖成功", overwrite.json.data?.overwritten === true)

// ---------- 4. Markdown 导入 ----------
console.log("\n=== Markdown（SKILL.md）导入 ===")
const mdContent = `# 论文选题顾问

帮助学生把宽泛的兴趣收敛成可写的论文题目，并给出检索关键词。

## 工作流程

1. 先问清学科、篇幅与截止时间
2. 给出 3 个候选题目，每个都说明可行性
3. 附上中英文检索关键词

## 注意

不要替学生定题，只提供选项与理由。
`
const mdImp = await api("/skills/import", {
  method: "POST",
  token,
  body: { content: mdContent }
})
ok("Markdown 导入成功", mdImp.json.data?.created === true)
ok("识别出 Markdown 格式", mdImp.json.data?.format === "markdown")
ok("一级标题作为技能名", mdImp.json.data?.name === "论文选题顾问",
  mdImp.json.data?.name)
ok("首段作为描述", /兴趣收敛/.test(mdImp.json.data?.description || ""),
  (mdImp.json.data?.description || "").slice(0, 40) + "…")
ok("正文作为系统提示词", /调度场|工作流程/.test(mdImp.json.data?.systemPrompt || ""),
  `${(mdImp.json.data?.systemPrompt || "").length} 字`)
ok("Markdown 导入默认 PROMPT 型", mdImp.json.data?.type === "PROMPT")
ok("自动生成了合法 key", /^[a-z0-9-]+$/.test(mdImp.json.data?.key || ""),
  mdImp.json.data?.key)
if (mdImp.json.data?.skill?.id) created.push(mdImp.json.data.skill)

// ---------- 5. 纯文本导入 ----------
console.log("\n=== 纯文本导入 ===")
const txtImp = await api("/skills/import", {
  method: "POST",
  token,
  body: {
    content: "会议纪要整理助手\n\n把零散的会议记录整理成决议、待办与责任人三部分。",
    fallbackName: "会议纪要整理"
  }
})
ok("纯文本导入成功", txtImp.json.data?.created === true)
ok("识别出文本格式", txtImp.json.data?.format === "text")
ok("给出格式提示", (txtImp.json.data?.warnings || []).some((w) => /未识别出结构化/.test(w)),
  (txtImp.json.data?.warnings || []).join("；"))
if (txtImp.json.data?.skill?.id) created.push(txtImp.json.data.skill)

// ---------- 6. 异常输入 ----------
console.log("\n=== 异常输入 ===")
const empty = await api("/skills/import", { method: "POST", token, body: { content: "" } })
ok("空内容被拒绝", empty.status === 400, `HTTP ${empty.status}`)

const badJson = await api("/skills/import", {
  method: "POST",
  token,
  body: { content: '{ "foo": "bar" }' }
})
ok("缺 name 的 JSON 被拒绝（不静默创建垃圾技能）",
  badJson.status === 400 && /name/.test(badJson.json.message || ""),
  badJson.json.message)

// ---------- 7. 导入的技能真的可用 ----------
console.log("\n=== 导入结果可用性 ===")
const list = await api("/skills?keyword=论文选题", { token })
const found = (list.json.data?.items || list.json.data || []).find(
  (s) => s.key === mdImp.json.data?.key
)
ok("导入的技能出现在列表里", !!found, found?.name)

if (found) {
  const detail = await api(`/skills/${found.id}`, { token })
  ok("详情能读到系统提示词", (detail.json.data?.systemPrompt || "").length > 50,
    `${(detail.json.data?.systemPrompt || "").length} 字`)
  ok("导入的技能默认启用", detail.json.data?.enabled === true)

  // 真的运行一次（PROMPT 型返回提示词）
  const runRes = await api(`/skills/${found.id}/run`, {
    method: "POST",
    token,
    body: { input: { topic: "乡村振兴" } }
  })
  ok("导入的技能可以运行", runRes.status < 300 && runRes.json.data?.success !== false,
    `HTTP ${runRes.status}`)
}

// ---------- 8. 权限 ----------
console.log("\n=== 权限校验 ===")
const student = await api("/auth/login", {
  method: "POST",
  body: { email: "student@cagent.local", password: "User@123456" }
})
const studentToken = student.json.data?.accessToken
ok("学生登录成功", !!studentToken)

const studentImport = await api("/skills/import", {
  method: "POST",
  token: studentToken,
  body: { content: JSON.stringify(jsonSkill) }
})
ok("学生不能导入技能（需 skill:create）", studentImport.status === 403,
  `HTTP ${studentImport.status}`)

const studentTools = await api("/skills/tools", { token: studentToken })
ok("学生不能读取工具目录（配置项，需 skill:update）", studentTools.status === 403,
  `HTTP ${studentTools.status}`)

// ---------- 收尾 ----------
for (const s of created) {
  if (s?.id) await api(`/skills/${s.id}`, { method: "DELETE", token })
}
console.log(`\n已清理 ${created.length} 个测试技能`)

console.log(`\n技能导入冒烟：${pass} 项通过，${fail} 项失败`)
if (fail > 0) process.exit(1)
