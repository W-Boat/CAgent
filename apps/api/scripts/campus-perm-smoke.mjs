/**
 * 权限边界冒烟：学生账号（student@cagent.local）应有的导览能力与限制。
 *
 * 期望：
 *   - 可以 campus:read（检索、分类、记录）
 *   - 可以 campus:guide（打开页面、勾选步骤、结束）
 *   - 不可以 campus:full（请求 full 会被降级为 guide）
 *   - 不可以 campus:admin（导览统计 403）
 *
 * 用法：cd apps/api && node scripts/campus-perm-smoke.mjs
 */
const BASE = process.env.API_BASE || "http://127.0.0.1:3001/api"

async function raw(path, { method = "GET", body, token } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}

const ok = (label, cond, extra = "") =>
  console.log(`${cond ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`)

async function main() {
  const login = await raw("/auth/login", {
    method: "POST",
    body: { email: "student@cagent.local", password: "User@123456" }
  })
  if (!login.json?.data?.accessToken) {
    throw new Error(`学生登录失败：${JSON.stringify(login.json).slice(0, 200)}`)
  }
  const token = login.json.data.accessToken
  const perms = login.json.data.user.permissions || []
  console.log(`已登录：${login.json.data.user.email}`)
  console.log(`权限：${perms.filter((p) => p.startsWith("campus")).join(", ") || "（无 campus 权限）"}\n`)

  ok("拥有 campus:read", perms.includes("campus:read"))
  ok("拥有 campus:guide", perms.includes("campus:guide"))
  ok("没有 campus:full", !perms.includes("campus:full"))
  ok("没有 campus:admin", !perms.includes("campus:admin"))

  // 1. 检索：即使显式请求 full 也应降级
  const search = await raw(
    `/campus/search?q=${encodeURIComponent("校园卡补办")}&mode=full&limit=2`,
    { token }
  )
  ok("检索可用", search.status === 200 && search.json.data.hits.length > 0)
  ok(
    "full 请求被降级为 guide",
    search.json.data.mode === "guide" && search.json.data.hits[0].detail == null,
    `mode=${search.json.data.mode}`
  )

  // 2. 打开页面
  const target = search.json.data.hits[0]
  const opened = await raw("/campus/runs", {
    method: "POST",
    token,
    body: { itemId: target.id }
  })
  ok("学生可以打开导览页面", opened.status === 201 || opened.status === 200 || opened.status === 202,
    `runId=${opened.json.data?.runId ?? "-"}`)
  const runId = opened.json.data?.runId
  if (runId) {
    ok("策略仍是「只打开不代办」", opened.json.data.policy.openOnly === true)

    // 3. 离权接口：导览统计应 403
    const stats = await raw("/campus/runs/stats?days=7", { token })
    ok("学生访问导览统计被拒", stats.status === 403, `HTTP ${stats.status}`)

    // 4. 别人的记录不可见：列表只返回自己的
    const list = await raw("/campus/runs?all=true&pageSize=50", { token })
    const mine = (list.json.data?.items ?? []).every((r) => r.userId === login.json.data.user.id)
    ok("记录列表只含本人数据（all 参数对非管理员无效）", mine,
      `${(list.json.data?.items ?? []).length} 条`)

    // 5. 结束导览
    const closed = await raw(`/campus/runs/${runId}/close`, { method: "POST", token })
    ok("学生可以结束自己的导览", closed.status < 300)
  }

  console.log("\n权限边界冒烟完成 🎉")
}

main().catch((err) => {
  console.error("\n❌ 失败：", err.message)
  process.exit(1)
})