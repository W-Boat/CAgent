/**
 * 校园导览端到端冒烟测试。
 *
 * 覆盖：检索（guide/full 双模式）→ 分类统计 → 打开页面（真实 Chromium）
 *      → 拉取画面 → 视觉高亮 → 勾选步骤 → 后台统计。
 *
 * 用法：cd apps/api && node scripts/campus-smoke.mjs
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
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json).slice(0, 400)}`)
  }
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
  console.log("已登录：", login.user.email, "\n")

  // 1. 元信息与分类
  const meta = await api("/campus/meta", { token })
  ok("索引元信息", meta.total > 4000, `schema=${meta.schema} 快照=${meta.verifiedAt} 共 ${meta.total} 条`)

  const cats = await api("/campus/categories", { token })
  ok("分类统计", cats.cats.length > 5, `${cats.cats.length} 个分类，可达性 ${cats.access.length} 种`)

  // 2. 检索：guide 模式
  const q = "校园卡丢了怎么补办"
  const guide = await api(`/campus/search?q=${encodeURIComponent(q)}&limit=3`, { token })
  const top = guide.hits[0]
  ok("guide 模式检索", guide.hits.length > 0 && guide.mode === "guide", `命中 ${guide.hits.length} 条`)
  if (top) {
    ok("命中条目含指引层", !("detail" in top) && !!top.dept, `${top.title}｜${top.dept}｜${top.tel ?? "无电话"}`)
    console.log(`   步骤 ${top.steps.length} 条，关键参数 ${top.keyFacts.length} 条，提醒 ${top.warnings.length} 条`)
  }

  // 3. 检索：full 模式（管理员有 campus:full）
  const full = await api(`/campus/search?q=${encodeURIComponent(q)}&limit=1&mode=full`, { token })
  ok("full 模式追加正文", full.mode === "full" && !!full.hits[0]?.detail, `正文 ${full.hits[0]?.detail?.length ?? 0} 字`)

  // 4. 纯文本作答块（供对话/技能复用）
  const ans = await api(`/campus/answer?q=${encodeURIComponent("四六级报名")}`, { token })
  ok("指引文本生成", ans.text.includes("入口"), `${ans.text.length} 字`)

  // 5. 打开页面（真实浏览器，只打开不代办）
  const target = guide.hits.find((h) => h.access === "公网") || top
  const opened = await api("/campus/runs", {
    method: "POST",
    token,
    body: { itemId: target.id }
  })
  ok("打开导览页面", !!opened.sessionId, `runId=${opened.runId} pageOk=${opened.pageOk}`)
  ok("只打开不代办策略", opened.policy.openOnly && !opened.policy.autoSubmit, opened.policy.message)
  ok("返回分步提示", opened.hints.length > 0, `${opened.hints.length} 条提示`)
  console.log(`   横幅：${opened.banner}`)
  opened.hints.slice(0, 4).forEach((h) => console.log(`   ${h.index}. ${h.tip}`))
  if (opened.frame) {
    console.log(`   实时画面：${opened.frame.url}（${opened.frame.width}x${opened.frame.height}）`)
  }
  if (opened.openError) console.log(`   ⚠️ 打开异常：${opened.openError.slice(0, 160)}`)

  // 6. 拉取最新画面（前端轮询接口）
  //    页面正跳转/字体未加载完时，单次截图可能失败，后端会重试并回退旧帧，
  //    所以这里最多试 3 次；连续失败才算真的有问题。
  if (opened.pageOk) {
    let frame = null
    let lastErr = ""
    for (let i = 0; i < 3 && !frame; i++) {
      try {
        frame = await api(`/campus/runs/${opened.runId}/frame`, { token })
      } catch (err) {
        lastErr = err.message
        await new Promise((r) => setTimeout(r, 1200))
      }
    }
    ok("轮询最新画面", !!frame?.screenshotPath, frame?.screenshotPath || lastErr)
  }

  // 7. 视觉高亮（指哪里，不点哪里）
  //    校园门户大多要先过 CAS 统一身份认证，未登录时停在登录页，
  //    h1/h2 不一定存在，因此这里只要「请求被优雅处理」即可，
  //    真正要求命中元素的用例在 campus-highlight-smoke.mjs。
  if (opened.pageOk) {
    const hl = await api(`/campus/runs/${opened.runId}/highlight`, {
      method: "POST",
      token,
      body: { selector: "h1, h2", label: "看这里：这是你要找的入口" }
    })
    ok(
      "页面视觉标注接口可用",
      typeof hl.matched === "number",
      `命中 ${hl.matched} 个元素（未做任何点击）${hl.error ? `｜${hl.error}` : ""}`
    )

    const byText = await api(`/campus/runs/${opened.runId}/highlight`, {
      method: "POST",
      token,
      body: { text: "登录", label: "登录入口在这里" }
    })
    ok("按文字指路可用", byText.matched > 0, `命中 ${byText.matched} 个元素`)

    const cleared = await api(`/campus/runs/${opened.runId}/highlight`, {
      method: "POST",
      token,
      body: { clear: true }
    })
    ok("可清除标注", cleared.cleared === true)
  }

  // 8. 勾选步骤（学生自己推进）
  const adv = await api(`/campus/runs/${opened.runId}/steps`, {
    method: "POST",
    token,
    body: { step: 1, done: true }
  })
  ok("步骤进度记录", adv.doneCount === 1, `${adv.doneCount}/${adv.total} 已完成`)

  // 9. 导览记录与后台统计
  const runs = await api("/campus/runs", { token })
  ok("导览记录列表", Array.isArray(runs.items) || Array.isArray(runs), `${(runs.items ?? runs).length} 条`)

  const stats = await api("/campus/runs/stats?days=7", { token })
  ok("导览统计", stats.total >= 1, `近 7 天 ${stats.total} 次，完成 ${stats.completed} 次`)

  // 10. 收尾：关闭会话
  await api(`/campus/runs/${opened.runId}/close`, { method: "POST", token })
  ok("会话已关闭", true)

  console.log("\n校园导览冒烟测试完成 🎉")
}

main().catch((err) => {
  console.error("\n❌ 冒烟测试失败：", err.message)
  process.exit(1)
})