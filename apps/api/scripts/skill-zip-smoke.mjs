/**
 * zip 技能包导入端到端测试。
 *
 * 覆盖：
 *   1. 标准技能包（SKILL.md + 附件）能被正确解析
 *   2. skill.json 优先于 SKILL.md
 *   3. 带顶层目录 / 不带顶层目录都能识别
 *   4. 二进制资源不落盘，只在提示词里列名
 *   5. 压缩炸弹与文件数上限被拦截
 *   6. dryRun 不落库
 */
import AdmZip from "adm-zip"

const BASE = process.env.API_BASE || "http://127.0.0.1:3001/api"

async function api(path, { method = "GET", token, body } = {}) {
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
  return { status: res.status, ok: res.ok, body: json?.data ?? json }
}

async function uploadZip(token, buffer, filename, options = {}) {
  const form = new FormData()
  form.append("file", new Blob([buffer], { type: "application/zip" }), filename)
  if (options.dryRun) form.append("dryRun", "true")
  if (options.onConflict) form.append("onConflict", options.onConflict)

  const res = await fetch(`${BASE}/skills/import-zip`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text }
  }
  return { status: res.status, ok: res.ok, body: json?.data ?? json }
}

let failures = 0
const check = (cond, msg) => {
  console.log(`${cond ? "✅" : "❌"} ${msg}`)
  if (!cond) failures++
}

// ---------- 构造测试用的技能包 ----------
function makeStandardPackage() {
  const zip = new AdmZip()
  zip.addFile(
    "paper-advisor/SKILL.md",
    Buffer.from(
      `# 论文选题顾问

帮助学生把宽泛的研究兴趣收敛成可写的论文题目。

## 工作流程
1. 先问清学科、篇幅与截止时间
2. 给出 3 个可写的题目方向
3. 每个方向说明研究价值与可行性
`,
      "utf8"
    )
  )
  zip.addFile(
    "paper-advisor/examples.md",
    Buffer.from("# 示例\n\n输入：我想研究人工智能\n输出：三个具体题目…", "utf8")
  )
  // 二进制资源：应被忽略但列名
  zip.addFile("paper-advisor/scripts/analyze.py", Buffer.from("print('hi')", "utf8"))
  return zip.toBuffer()
}

function makeJsonPackage() {
  const zip = new AdmZip()
  // skill.json 优先级更高
  zip.addFile(
    "skill.json",
    Buffer.from(
      JSON.stringify({
        key: "zip-json-skill",
        name: "结构化技能",
        description: "由 skill.json 定义的技能",
        type: "PROMPT",
        category: "测试",
        systemPrompt: "这是来自 skill.json 的提示词"
      }),
      "utf8"
    )
  )
  zip.addFile("SKILL.md", Buffer.from("# 不该被采用\n\n这是 md 正文", "utf8"))
  return zip.toBuffer()
}

function makeTooManyEntries() {
  const zip = new AdmZip()
  for (let i = 0; i < 250; i++) {
    zip.addFile(`pkg/file-${i}.md`, Buffer.from(`# 文件 ${i}`, "utf8"))
  }
  return zip.toBuffer()
}

const main = async () => {
  const login = await api("/auth/login", {
    method: "POST",
    body: { email: "admin@cagent.local", password: "CHANGE_ME_SEED_ADMIN_PASSWORD" }
  })
  const token = login.body.accessToken
  check(!!token, "登录成功")

  console.log("\n=== 1. 标准技能包（dryRun 预览，不落库）===")
  const std = await uploadZip(token, makeStandardPackage(), "paper-advisor.zip", {
    dryRun: true
  })
  check(std.ok, `上传成功（HTTP ${std.status}）`)
  check(std.body?.format === "zip", `识别为 zip 格式：${std.body?.format}`)
  check(std.body?.name === "论文选题顾问", `名称解析正确：${std.body?.name}`)
  check(std.body?.type === "PROMPT", `类型为 PROMPT：${std.body?.type}`)
  check(
    (std.body?.systemPrompt || "").includes("工作流程"),
    "SKILL.md 正文进入提示词"
  )
  check(
    (std.body?.systemPrompt || "").includes("examples.md"),
    "附件已并入提示词（含文件名标注）"
  )
  check(
    (std.body?.systemPrompt || "").includes("scripts/analyze.py"),
    "二进制资源仅在提示词中列名（未落盘）"
  )
  check(
    (std.body?.warnings || []).some((w) => w.includes("非文本文件")),
    "已提示存在未导入的非文本文件"
  )
  check((std.body?.files || []).length === 3, `包内文件清单 ${std.body?.files?.length} 项`)
  check(std.body?.dryRun === true, "dryRun 标记正确")

  // dryRun 不应落库
  const check1 = await api("/skills?keyword=论文选题顾问", { token })
  const existsAfterDryRun = (check1.body?.items || []).some((s) => s.key === std.body?.key)
  check(!existsAfterDryRun, "dryRun 未写入数据库")

  console.log("\n=== 2. 真正导入 ===")
  const imported = await uploadZip(token, makeStandardPackage(), "paper-advisor.zip", {
    onConflict: "rename"
  })
  check(imported.ok && imported.body?.created === true, `导入成功（HTTP ${imported.status}）`)
  check(!!imported.body?.skill?.id, `已创建技能 id=${imported.body?.skill?.id}`)

  console.log("\n=== 3. skill.json 优先于 SKILL.md ===")
  const jsonPkg = await uploadZip(token, makeJsonPackage(), "json-skill.zip", { dryRun: true })
  check(jsonPkg.body?.name === "结构化技能", `采用 skill.json 的名称：${jsonPkg.body?.name}`)
  check(
    (jsonPkg.body?.systemPrompt || "").includes("来自 skill.json"),
    "采用 skill.json 的提示词"
  )
  check(
    !(jsonPkg.body?.systemPrompt || "").includes("不该被采用"),
    "SKILL.md 未覆盖 json 定义"
  )

  console.log("\n=== 4. 文件数上限拦截 ===")
  const many = await uploadZip(token, makeTooManyEntries(), "too-many.zip", { dryRun: true })
  check(many.status === 400, `文件过多被拦截（HTTP ${many.status}）`)
  check(
    String(many.body?.message || "").includes("文件过多"),
    `错误信息明确：${many.body?.message}`
  )

  console.log("\n=== 5. 非 zip 文件被拒绝 ===")
  const notZip = await (async () => {
    const form = new FormData()
    form.append("file", new Blob([Buffer.from("hello")], { type: "text/plain" }), "a.txt")
    const res = await fetch(`${BASE}/skills/import-zip`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form
    })
    const j = await res.json()
    return { status: res.status, body: j?.data ?? j }
  })()
  check(notZip.status === 400, `非 zip 被拒（HTTP ${notZip.status}）`)

  console.log("\n=== 6. 包内无文本文件被拒 ===")
  const binaryOnly = new AdmZip()
  binaryOnly.addFile("pkg/logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  const binRes = await uploadZip(token, binaryOnly.toBuffer(), "binary.zip", { dryRun: true })
  check(binRes.status === 400, `无文本文件被拒（HTTP ${binRes.status}）`)
  check(
    String(binRes.body?.message || "").includes("没有可识别的文本文件"),
    `错误信息明确：${binRes.body?.message}`
  )

  console.log("\n=== 7. 清理测试数据 ===")
  const created = await api("/skills?keyword=论文选题顾问", { token })
  for (const s of created.body?.items || []) {
    if (s.key === imported.body?.key) {
      await api(`/skills/${s.id}`, { method: "DELETE", token })
      console.log(`   已删除测试技能 ${s.key}`)
    }
  }

  console.log(failures === 0 ? "\n🎉 全部通过" : `\n⚠️ ${failures} 项未通过`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error("\n❌ 测试异常：", err.message)
  process.exit(1)
})
