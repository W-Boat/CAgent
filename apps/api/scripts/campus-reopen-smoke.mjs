/**
 * 回归测试：连续打开不同事项时，不得再报
 *   Unique constraint failed on the fields: (`browser_session_id`)
 *
 * 根因回顾：browser_session_id 曾带唯一约束（一会话一记录），
 * 而切换事项时后端刻意复用同一个 Chromium 会话、只换页面并新建记录，
 * 于是第二次 open 必然崩。约束已在迁移 20260924013000 移除。
 *
 * 用法：cd apps/api && node scripts/campus-reopen-smoke.mjs
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
    body: { email: "admin@cagent.local", password: "CHANGE_ME_SEED_ADMIN_PASSWORD" }
  })
  const token = login.json.data.accessToken

  // 取三个**互不相同**的事项，逐个打开
  const search = await raw(`/campus/search?q=${encodeURIComponent("报名")}&limit=5`, { token })
  const hits = (search.json.data?.hits ?? []).filter((h) => h.url)
  if (hits.length < 3) throw new Error(`候选不足，只有 ${hits.length} 条`)

  const runs = []
  for (let i = 0; i < 3; i++) {
    const hit = hits[i]
    const res = await raw("/campus/runs", {
      method: "POST",
      token,
      body: { itemId: hit.id }
    })
    const detail = res.json?.message || res.json?.details || ""
    const uniqueClash = /Unique constraint|browser_session_id/i.test(String(detail))
    ok(
      `第 ${i + 1} 次打开不同事项（${hit.title.slice(0, 18)}）`,
      res.status < 300 && !!res.json.data?.runId && !uniqueClash,
      `HTTP ${res.status}${uniqueClash ? " ← 唯一约束冲突复发！" : ""} runId=${res.json.data?.runId ?? "-"}`
    )
    if (res.status >= 300) {
      console.log(`   ⚠️ 响应：${JSON.stringify(res.json).slice(0, 300)}`)
      break
    }
    runs.push({ ...res.json.data, itemId: hit.id, title: hit.title })
  }

  // 复用同一会话的证据：三次打开的 sessionId 应当相同
  const sessions = [...new Set(runs.map((r) => r.sessionId))]
  ok("三次打开复用同一个浏览器会话（设计如此）", sessions.length === 1,
    `sessionId 去重后 ${sessions.length} 个：${sessions.join(", ").slice(0, 60)}`)

  // 同一事项重复打开也不应崩
  if (hits[0]) {
    for (let i = 0; i < 2; i++) {
      const res = await raw("/campus/runs", {
        method: "POST",
        token,
        body: { itemId: hits[0].id }
      })
      ok(`同一事项重复打开第 ${i + 1} 次`, res.status < 300, `HTTP ${res.status}`)
    }
  }

  // 记录列表：应能容纳多条指向同一会话的历史记录
  const list = await raw("/campus/runs?all=true&pageSize=100", { token })
  const items = list.json.data?.items ?? []
  const bySession = new Map()
  for (const r of items) {
    if (!r.browserSessionId) continue
    bySession.set(r.browserSessionId, (bySession.get(r.browserSessionId) ?? 0) + 1)
  }
  const maxShared = Math.max(0, ...bySession.values())
  ok("同一会话可挂多条历史记录（唯一约束确已解除）", maxShared > 1,
    `单会话最多关联 ${maxShared} 条记录，共 ${items.length} 条`)

  // 旧记录的详情不应错挂新事项的画面
  const closed = items.filter((r) => r.closedAt)
  if (closed.length > 0) {
    const d = await raw(`/campus/runs/${closed[0].id}`, { token })
    const frameUrl = d.json.data?.frame?.url ?? ""
    const visited = d.json.data?.run?.visitedUrls ?? []
    const mismatched =
      frameUrl && visited.length > 0 &&
      !visited.some((u) => frameUrl === u || frameUrl.startsWith(String(u).split("?")[0]))
    ok("已结束记录不会错挂别的页面画面", !mismatched,
      mismatched ? `画面 ${frameUrl.slice(0, 60)} 不属于该记录` : "画面归属正确或按设计留空")
  }

  // 收尾
  for (const r of runs) {
    await raw(`/campus/runs/${r.runId}/close`, { method: "POST", token })
  }
  console.log("\n连续打开回归测试完成 🎉")
}

main().catch((err) => {
  console.error("\n❌ 失败：", err.message)
  process.exit(1)
})