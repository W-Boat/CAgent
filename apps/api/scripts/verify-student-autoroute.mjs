/**
 * 学生端语义路由校验。
 *
 * 需求：「自动 Agent 切换需要理解上下文语义后给出意见」。
 * 因此现在的行为是 —— **不再机械换人、也不再自动切**，
 * 而是把语义判断的结论作为一条**意见**交给学生确认：
 *
 *   答不上来 → 给出「建议交给 X，因为…」+ ［交给它］［不用］
 *   ［交给它］→ 切换并把原问题重问一遍
 *   ［不用］  → 不切、不再推荐
 *
 * 为了不依赖真实模型的稳定性，这里把两个接口都 mock 掉：
 *   /api/chat/completions —— 稳定复现「失败」
 *   /api/chat/suggest-agent —— 稳定返回一条固定的建议
 * 真实模型的判定能力另见 README 里记的实测（选课→校园百事通、
 * 查文献→科研助手，理由自然）。
 */
import { chromium } from "playwright"

const BASE = process.env.BASE_URL || "http://127.0.0.1:5173"
const STUDENT = { email: "student@cagent.local", password: "User@123456" }

let pass = 0
let fail = 0
function check(ok, label) {
  if (ok) {
    pass++
    console.log(`OK  ${label}`)
  } else {
    fail++
    console.log(`NG  ${label}`)
  }
}

/**
 * 注入 fetch 替换，伪造流式对话接口。
 *
 * ⚠️ 这里**只能**拦 /chat/completions：
 * vue 侧的 SSE 用的是原生 fetch，替换 window.fetch 有效；
 * 而 chatApi.suggestAgent 走的是 axios（浏览器下是 XHR），
 * 替换 fetch 拦不到 —— 那条用 page.route 在网络层拦（见下）。
 * 一开始我把两者都写在 fetch 替换里，结果「语义路由调用 0 次」，
 * 功能其实正常，只是没拦到。
 *
 * @param failWith 非空则 /chat/completions 直接回 error 帧（复现失败）
 */
function mockBackend({ failWith = "", chunks = [] } = {}) {
  return `
    (function () {
      var FAIL = ${JSON.stringify(failWith)};
      var CHUNKS = ${JSON.stringify(chunks)};
      var orig = window.fetch.bind(window);
      var enc = new TextEncoder();
      window.fetch = function (input, init) {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        if (url.indexOf('/api/chat/completions') === -1) return orig(input, init);
        var frames = [];
        frames.push('event: meta\\ndata: ' + JSON.stringify({
          conversationId: 'route-conv', userMessageId: 'u1', assistantMessageId: 'a1',
          model: { id: 'm1', key: 'deepseek-chat', name: 'DeepSeek Chat', provider: 'deepseek' },
          title: '语义路由校验'
        }) + '\\n\\n');
        if (FAIL) {
          frames.push('event: error\\ndata: ' + JSON.stringify({ message: FAIL }) + '\\n\\n');
        } else {
          CHUNKS.forEach(function (t) {
            frames.push('event: text\\ndata: ' + JSON.stringify({ text: t }) + '\\n\\n');
          });
          frames.push('event: done\\ndata: ' + JSON.stringify({
            conversationId: 'route-conv', assistantMessageId: 'a1', status: 'SUCCESS'
          }) + '\\n\\n');
        }
        var i = 0;
        var stream = new ReadableStream({
          start: function (c) {
            (function push() {
              if (i >= frames.length) { c.close(); return }
              c.enqueue(enc.encode(frames[i++]));
              setTimeout(push, 120);
            })();
          }
        });
        return Promise.resolve(new Response(stream, {
          status: 200, headers: { 'Content-Type': 'text/event-stream' }
        }));
      };
    })();
  `
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const pageErrors = []
page.on("pageerror", (e) => pageErrors.push(String(e)))
page.on("console", (m) => {
  if (m.type() === "error") pageErrors.push(m.text())
})

/**
 * 语义路由接口的桩。
 *
 * 用 page.route 在网络层拦 —— chatApi 走 axios(XHR)，替换 window.fetch
 * 拦不到它（实测「调用 0 次」）。非流式 JSON 用 fulfill 没有副作用；
 * 只有 SSE 才不能用 fulfill（那会缓冲整个 body、测不出流式）。
 *
 * 用可变变量而不是重新注册：route 注册一次对所有导航生效，
 * 每个用例改 current 即可。
 */
let suggestStub = null
let suggestCalls = 0
await page.route("**/api/chat/suggest-agent*", async (route) => {
  suggestCalls++
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      code: 0,
      message: "ok",
      data: { suggestion: suggestStub }
    })
  })
})

async function enterStudent(initScripts = []) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" })
  await page.evaluate(
    async ({ base, email, password }) => {
      const r = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      })
      const j = await r.json()
      localStorage.setItem("cagent.accessToken", j.data.accessToken)
      localStorage.setItem("cagent.refreshToken", j.data.refreshToken || "")
    },
    { base: BASE, ...STUDENT }
  )
  for (const s of initScripts) await page.addInitScript(s)
  await page.goto(`${BASE}/student`, { waitUntil: "domcontentloaded" })
  await page.waitForSelector(".student-app", { timeout: 30000 })
  await page.waitForTimeout(600)
  const narrow = await page.evaluate(() => window.innerWidth <= 860)
  if (narrow) {
    await page.click(".sc-hamburger")
    await page.waitForTimeout(300)
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.click(".sc-new")
    await page.waitForSelector(".sc-welcome", { timeout: 25000 }).catch(() => undefined)
    await page.waitForTimeout(700)
    const cleared = await page.evaluate(() => document.querySelectorAll(".sc-msg").length === 0)
    if (cleared) return
  }
  throw new Error("未能进入空会话，后续断言会取到历史消息")
}

async function waitIdle(timeoutMs = 30000) {
  await page.waitForSelector(".sc-msg:not(.is-user) .sc-bubble", { timeout: timeoutMs }).catch(() => undefined)
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const busy = await page.evaluate(() => !!document.querySelector(".sc-send.is-stop"))
    if (!busy || Date.now() > deadline) break
    await page.waitForTimeout(250)
  }
  await page.waitForTimeout(600)
}

const state = () =>
  page.evaluate(() => {
    const sub = document.querySelector(".sc-subtitle")?.textContent?.trim() || ""
    const m = /由「(.+?)」回答/.exec(sub)
    return {
      agentName: m ? m[1] : "",
      suggestText: document.querySelector(".sc-suggest-line")?.textContent?.trim() || "",
      suggestReason: document.querySelector(".sc-suggest-reason")?.textContent?.trim() || "",
      hasAccept: !!document.querySelector(".sc-suggest-ok"),
      hasDismiss: !!document.querySelector(".sc-suggest-no"),
      selects: document.querySelectorAll("select").length
    }
  })

const agents = await page.evaluate(async () => 1).then(() => null)
void agents

// ══════════════════ 1. 顶部仍然没有选择器 ══════════════════
console.log("=== 1. 学生不能自己选智能体 / 模型 ===")
await enterStudent()
const s0 = await state()
check(s0.selects === 0, `页面里没有 select 控件（实测 ${s0.selects} 个）`)
check(Boolean(s0.agentName), `标题栏显示当前智能体：${s0.agentName}`)
const current = s0.agentName

// 先取一个与当前不同的真实智能体，作为 mock 的建议目标
const target = await page.evaluate(async (cur) => {
  const t = localStorage.getItem("cagent.accessToken")
  const r = await fetch("/api/agents/available", { headers: { Authorization: `Bearer ${t}` } })
  const j = await r.json()
  const list = j?.data || []
  const other = list.find((a) => a.name !== cur)
  return other ? { agentId: other.id, name: other.name } : null
}, current)
check(Boolean(target), `取到可推荐的其它智能体：${target?.name}`)

const suggestion = {
  agentId: target.agentId,
  name: target.name,
  reason: "这属于它管的事"
}

// ══════════════════ 2. 失败 → 只给意见，不自动切 ══════════════════
console.log("\n=== 2. 答不上来：给意见而不是自动换人 ===")
suggestCalls = 0
suggestStub = suggestion
await enterStudent([mockBackend({ failWith: "上游暂时不可用" })])
await page.fill(".sc-textarea", "测试语义建议")
await page.click(".sc-send")
await waitIdle()
await page.waitForSelector(".sc-suggest", { timeout: 15000 }).catch(() => undefined)
await page.waitForTimeout(500)

const s1 = await state()
check(s1.agentName === current, `没有自动切换（仍是「${s1.agentName}」）`)
check(/建议交给/.test(s1.suggestText), `给出了意见：「${s1.suggestText}」`)
check(s1.suggestText.includes(target.name), `意见里点名了目标「${target.name}」`)
check(s1.suggestReason.length > 0, `附了理由：「${s1.suggestReason}」`)
check(s1.hasAccept && s1.hasDismiss, "提供「交给它 / 不用」两个出口")
check(suggestCalls >= 1, `确实问了后端语义路由（${suggestCalls} 次）`)

// ══════════════════ 3. 「交给它」→ 切换并重问 ══════════════════
console.log("\n=== 3. 点「交给它」：切换并重问 ===")
await page.click(".sc-suggest-ok")
await page.waitForTimeout(800)
const s2 = await state()
check(s2.agentName === target.name, `已切到「${target.name}」（实测 ${s2.agentName}）`)
check(!s2.suggestText, "建议条已收起")
const notice = await page.evaluate(
  () => document.querySelector(".sc-notice-text")?.textContent?.trim() || ""
)
check(/已交给/.test(notice), `给出切换提示：「${notice}」`)

// ══════════════════ 4. 「不用」→ 不切且不再推荐 ══════════════════
console.log("\n=== 4. 点「不用」：不切、也不再推荐 ===")
suggestCalls = 0
suggestStub = suggestion
await enterStudent([mockBackend({ failWith: "上游暂时不可用" })])
await page.fill(".sc-textarea", "再测一次建议")
await page.click(".sc-send")
await waitIdle()
await page.waitForSelector(".sc-suggest", { timeout: 15000 }).catch(() => undefined)
await page.waitForTimeout(400)
const s3 = await state()
check(/建议交给/.test(s3.suggestText), "先出现建议")
await page.click(".sc-suggest-no")
await page.waitForTimeout(600)
const s4 = await state()
check(!s4.suggestText, "建议条已收起")
check(s4.agentName === current, `没有切换（仍是「${s4.agentName}」）`)

// 再问一次：同一会话内不该再推荐同一个目标
await page.fill(".sc-textarea", "第三次提问")
await page.click(".sc-send")
await waitIdle()
await page.waitForTimeout(1500)
const s5 = await state()
check(!/建议交给/.test(s5.suggestText), "被拒绝过的目标不再推荐")

// ══════════════════ 5. 判不出来时不打扰 ══════════════════
console.log("\n=== 5. 语义判不出来：不显示任何建议 ===")
suggestCalls = 0
suggestStub = null
await enterStudent([mockBackend({ failWith: "上游暂时不可用" })])
await page.fill(".sc-textarea", "无法判断的提问")
await page.click(".sc-send")
await waitIdle()
await page.waitForTimeout(1800)
const s6 = await state()
check(!s6.suggestText, "没有建议条（不硬凑一个）")
check(s6.agentName === current, `也没有切换（仍是「${s6.agentName}」）`)

console.log("\n" + "=".repeat(52))
check(pageErrors.length === 0, `控制台无未捕获错误（${pageErrors.length} 条）`)
if (pageErrors.length) console.log(pageErrors.slice(0, 4).join("\n"))

console.log(`\n语义路由校验：${pass} 项通过 / ${fail} 项未通过`)
await browser.close()
process.exit(fail === 0 ? 0 : 1)
