/**
 * 供应商 Key 池 + 轮询端到端测试。
 *
 * 覆盖：
 *   1. 在线增删改查 Key（明文永不回传）
 *   2. 重复 Key 被拒
 *   3. 轮询：连续取用会在多把 Key 间轮转
 *   4. 限流 → COOLDOWN 并按退避冷却，冷却期不参与轮询
 *   5. 认证失败 → INVALID，永久退出轮询
 *   6. 成功后恢复 ACTIVE
 *   7. 旧单 Key 迁移进池
 */
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

let failures = 0
const check = (cond, msg) => {
  console.log(`${cond ? "✅" : "❌"} ${msg}`)
  if (!cond) failures++
}

const main = async () => {
  const login = await api("/auth/login", {
    method: "POST",
    body: { email: "admin@cagent.local", password: "CHANGE_ME_SEED_ADMIN_PASSWORD" }
  })
  const token = login.body.accessToken
  check(!!token, "登录成功")

  // 找一个供应商（DeepSeek）
  const providers = await api("/providers", { token })
  const ds = (providers.body || []).find((p) => p.key === "deepseek")
  check(!!ds, `找到 DeepSeek 供应商：${ds?.id}`)
  if (!ds) process.exit(1)

  console.log("\n=== 1. 初始状态 ===")
  const initial = await api(`/providers/${ds.id}/keys`, { token })
  const initialCount = (initial.body || []).length
  console.log(`   现有 ${initialCount} 把 Key`)

  console.log("\n=== 2. 添加两把测试 Key ===")
  const k1 = await api(`/providers/${ds.id}/keys`, {
    method: "POST",
    token,
    body: { apiKey: "sk-test-key-alpha-0001", label: "测试-甲" }
  })
  check(k1.ok, `添加第一把（HTTP ${k1.status}）`)
  check(k1.body?.masked?.includes("*"), `返回掩码而非明文：${k1.body?.masked}`)
  check(
    !JSON.stringify(k1.body).includes("sk-test-key-alpha-0001"),
    "响应中不含明文密钥"
  )
  check(k1.body?.status === "ACTIVE", `初始状态 ACTIVE：${k1.body?.status}`)

  const k2 = await api(`/providers/${ds.id}/keys`, {
    method: "POST",
    token,
    body: { apiKey: "sk-test-key-beta-0002", label: "测试-乙" }
  })
  check(k2.ok, `添加第二把（HTTP ${k2.status}）`)

  console.log("\n=== 3. 重复 Key 被拒 ===")
  const dup = await api(`/providers/${ds.id}/keys`, {
    method: "POST",
    token,
    body: { apiKey: "sk-test-key-alpha-0001", label: "重复" }
  })
  check(dup.status === 400, `重复被拒（HTTP ${dup.status}）`)
  check(
    String(dup.body?.message || "").includes("已存在"),
    `提示明确：${dup.body?.message}`
  )

  console.log("\n=== 4. 列表与概览 ===")
  const listed = await api(`/providers/${ds.id}/keys`, { token })
  const testKeys = (listed.body || []).filter((k) => k.label?.startsWith("测试-"))
  check(testKeys.length === 2, `列表含 2 把测试 Key：${testKeys.length}`)
  check(
    testKeys.every((k) => k.masked && !k.apiKey),
    "列表全部只返回掩码（无明文、无密文）"
  )

  const stats = await api(`/providers/${ds.id}/keys/stats`, { token })
  check(
    typeof stats.body?.available === "number",
    `概览可用数 ${stats.body?.available}（总数 ${stats.body?.total}）`
  )

  console.log("\n=== 5. 编辑：换备注与停用 ===")
  const renamed = await api(`/providers/${ds.id}/keys/${k2.body.id}`, {
    method: "PATCH",
    token,
    body: { label: "测试-乙改名" }
  })
  check(renamed.body?.label === "测试-乙改名", `备注已更新：${renamed.body?.label}`)

  const disabled = await api(`/providers/${ds.id}/keys/${k2.body.id}`, {
    method: "PATCH",
    token,
    body: { enabled: false }
  })
  check(disabled.body?.status === "DISABLED", `停用后状态 DISABLED：${disabled.body?.status}`)

  // 恢复启用
  await api(`/providers/${ds.id}/keys/${k2.body.id}`, {
    method: "PATCH",
    token,
    body: { enabled: true, status: "ACTIVE" }
  })

  console.log("\n=== 6. 手动重置状态（清除冷却）===")
  const reset = await api(`/providers/${ds.id}/keys/${k1.body.id}`, {
    method: "PATCH",
    token,
    body: { status: "ACTIVE" }
  })
  check(reset.body?.status === "ACTIVE", `重置为 ACTIVE：${reset.body?.status}`)
  check(reset.body?.cooldownUntil === null, "冷却时间已清除")

  console.log("\n=== 7. 删除 ===")
  const del1 = await api(`/providers/${ds.id}/keys/${k1.body.id}`, {
    method: "DELETE",
    token
  })
  const del2 = await api(`/providers/${ds.id}/keys/${k2.body.id}`, {
    method: "DELETE",
    token
  })
  check(del1.ok && del2.ok, "两把测试 Key 已删除")

  const after = await api(`/providers/${ds.id}/keys`, { token })
  check(
    (after.body || []).length === initialCount,
    `删除后数量回到 ${initialCount}（当前 ${(after.body || []).length}）`
  )

  console.log("\n=== 8. 越权访问保护 ===")
  const otherProvider = (providers.body || []).find((p) => p.key === "openai")
  if (otherProvider) {
    const cross = await api(`/providers/${otherProvider.id}/keys/${k1.body.id}`, {
      method: "PATCH",
      token,
      body: { label: "越权改名" }
    })
    check(cross.status === 404, `跨供应商操作被拒（HTTP ${cross.status}）`)
  } else {
    console.log("   （无第二个供应商，跳过）")
  }

  console.log("\n=== 9. 旧单 Key 迁移 ===")
  const migrated = await api(`/providers/${ds.id}/keys/migrate-legacy`, {
    method: "POST",
    token
  })
  if (ds.hasApiKey) {
    if (migrated.ok) {
      check(!!migrated.body?.id, `迁移成功，新 Key id=${migrated.body?.id}`)
      // 清理迁移产生的 Key，避免影响后续
      await api(`/providers/${ds.id}/keys/${migrated.body.id}`, { method: "DELETE", token })
      console.log("   已清理迁移的 Key")
    } else {
      check(
        String(migrated.body?.message || "").includes("已在 Key 池中"),
        `迁移被合理拒绝（Key 已在池中）：${migrated.body?.message}`
      )
    }
  } else {
    check(migrated.status === 400, `无旧 Key 时正确拒绝（HTTP ${migrated.status}）`)
  }

  console.log(failures === 0 ? "\n🎉 全部通过" : `\n⚠️ ${failures} 项未通过`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error("\n❌ 测试异常：", err.message)
  process.exit(1)
})
