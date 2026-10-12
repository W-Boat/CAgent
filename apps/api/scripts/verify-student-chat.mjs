/**
 * 学生端「流式对话」端到端校验。
 *
 * 前面几套校验只覆盖了路由限制与外观 —— 那是「壳」。
 * 这个脚本验证**学生端真的能对话**：
 *   1. 输入并发送一条消息，用户气泡立即出现（乐观渲染）
 *   2. 助手回复以流式方式逐步增长（而不是一次性出现）
 *   3. 流式光标在生成期间存在、结束后消失
 *   4. 结束后按钮从「停止」切回「发送」
 *   5. 全程无未捕获错误
 *
 * 流式部分靠页面内替换 window.fetch 注入确定性的分块 SSE 响应 ——
 * 不依赖真实模型（那会消耗额度且结果不稳定），
 * 但走的是与生产完全相同的 SSE 消费代码路径。
 *
 * 用法：node apps/api/scripts/verify-student-chat.mjs
 */
import { chromium } from "playwright"

const BASE = process.env.BASE_URL || "http://127.0.0.1:5173"

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()

let failures = 0
let checks = 0
const check = (cond, msg) => {
  checks++
  console.log(`${cond ? "OK " : "NG "} ${msg}`)
  if (!cond) failures++
}

const errors = []
page.on("pageerror", (e) => errors.push(String(e)))

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" })
await page.evaluate(async (base) => {
  const r = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "student@cagent.local", password: "User@123456" })
  })
  const j = await r.json()
  localStorage.setItem("cagent.accessToken", j.data.accessToken)
  localStorage.setItem("cagent.refreshToken", j.data.refreshToken || "")
}, BASE)

/*
 * 伪造 SSE 流。
 *
 * ⚠️ 不能用 Playwright 的 route.fulfill 来「流式」返回。
 *    fulfill 接受的是一个**已完成的 body**，浏览器会一次性收到全文 ——
 *    这样测出来永远是「不是流式」，把客户端的正确行为误判成缺陷
 *    （实测踩过：文本长度采样全是 0，因为流在被消费前就已缓冲完毕）。
 *
 * 正确做法：用 addInitScript 在页面里替换 window.fetch，
 * 针对 /api/chat/completions 返回一个**由 ReadableStream 驱动**的
 * Response，并在每个事件之间插入真实延时。
 * 这样走的是与生产完全相同的 SSE 消费路径（response.body.getReader()），
 * 又能精确控制分块节奏。
 */
const REPLY_PARTS = ["你好，", "我是校园智能助手。", "有什么可以帮你？"]

/** 在页面上下文中构造带延时的 SSE 响应 */
const FETCH_MOCK = `
  (function () {
    var PARTS = ${JSON.stringify(REPLY_PARTS)};
    var origFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.indexOf('/api/chat/completions') === -1) return origFetch(input, init);

      var convId = 'verify-conv-' + Date.now();
      var enc = new TextEncoder();
      var frames = [];
      frames.push('event: meta\\ndata: ' + JSON.stringify({
        conversationId: convId,
        userMessageId: 'verify-user-msg',
        assistantMessageId: 'verify-assistant-msg',
        model: { id: 'm1', key: 'deepseek-chat', name: 'DeepSeek Chat', provider: 'deepseek' },
        title: '校验会话'
      }) + '\\n\\n');
      PARTS.forEach(function (t) {
        frames.push('event: text\\ndata: ' + JSON.stringify({ text: t }) + '\\n\\n');
      });
      frames.push('event: usage\\ndata: ' + JSON.stringify({
        promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0, latencyMs: 120
      }) + '\\n\\n');
      frames.push('event: done\\ndata: ' + JSON.stringify({
        conversationId: convId,
        assistantMessageId: 'verify-assistant-msg',
        status: 'SUCCESS'
      }) + '\\n\\n');

      var i = 0;
      var stream = new ReadableStream({
        start: function (controller) {
          function push() {
            if (i >= frames.length) { controller.close(); return; }
            controller.enqueue(enc.encode(frames[i++]));
            // 每个事件之间停 320ms，给「逐步增长」留出观察窗口
            setTimeout(push, 320);
          }
          push();
        }
      });

      return Promise.resolve(new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' }
      }));
    };
  })();
`

await page.addInitScript(FETCH_MOCK)

console.log("=== 1. 进入学生端并新建对话 ===")
await page.goto(`${BASE}/student`, { waitUntil: "domcontentloaded" })
await page.waitForTimeout(2600)
await page.click(".sc-new")
await page.waitForTimeout(700)
const emptyBefore = await page.evaluate(() => document.querySelectorAll(".sc-msg").length)
check(emptyBefore === 0, `新对话初始无消息（${emptyBefore} 条）`)

console.log("\n=== 2. 发送消息 ===")
await page.fill(".sc-textarea", "你好，请介绍一下自己")
await page.waitForTimeout(200)
const sendEnabled = await page.evaluate(
  () => !document.querySelector(".sc-send")?.disabled
)
check(sendEnabled, "输入内容后发送按钮可用")

await page.click(".sc-send")
// 立刻检查用户气泡是否已出现（乐观渲染）
await page.waitForTimeout(120)
const afterSend = await page.evaluate(() => ({
  count: document.querySelectorAll(".sc-msg").length,
  userText: document.querySelector(".sc-msg.is-user .sc-bubble")?.textContent?.trim() || ""
}))
check(afterSend.count >= 1, `用户消息立即出现（${afterSend.count} 条消息）`)
check(
  afterSend.userText.includes("请介绍一下自己"),
  `用户气泡内容正确：「${afterSend.userText.slice(0, 20)}」`
)

console.log("\n=== 3. 助手回复逐步增长（流式）===")
/*
 * 密集采样助手气泡的文本长度。
 *
 * 采样窗口必须覆盖「第一段到达之前」到「全部到达之后」：
 * 事件间隔 320ms，共 3 段文本，因此约 1 秒后才拼完。
 * 每 150ms 采一次、共 10 次（1.5 秒），足以看到阶梯式增长。
 *
 * 判据是「长度至少增加过两次」而不是「最终变长」——
 * 后者一次性渲染也能满足，测不出流式。
 */
const samples = []
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(150)
  const len = await page.evaluate(() => {
    const bots = document.querySelectorAll(".sc-msg:not(.is-user) .sc-bubble")
    const last = bots[bots.length - 1]
    return last ? (last.textContent || "").trim().length : 0
  })
  samples.push(len)
}
console.log(`     文本长度采样：${samples.join(" → ")}`)

// 统计「增长」的次数（相邻采样严格变大的次数）
let growths = 0
for (let i = 1; i < samples.length; i++) {
  if (samples[i] > samples[i - 1]) growths++
}
console.log(`     观察到 ${growths} 次增长`)
check(growths >= 2, `助手气泡多次逐步增长（${growths} 次），确认是流式渲染`)

console.log("\n=== 4. 流式结束后状态正确 ===")
await page.waitForTimeout(2200)
const final = await page.evaluate(() => {
  const bots = document.querySelectorAll(".sc-msg:not(.is-user) .sc-bubble")
  const last = bots[bots.length - 1]
  return {
    text: last ? (last.textContent || "").trim() : "",
    caret: document.querySelectorAll(".sc-caret").length,
    // 生成结束后应重新出现发送按钮（而不是停止按钮）
    hasSendBtn: !!document.querySelector(".sc-send:not(.is-stop)"),
    hasStopBtn: !!document.querySelector(".sc-send.is-stop"),
    hasError: document.querySelectorAll(".sc-error").length
  }
})
check(final.text.length > 0, `助手回复已渲染：「${final.text.slice(0, 30)}」`)
check(final.text.includes("校园智能助手"), "回复内容完整（三段文本都已拼接）")
check(final.caret === 0, "流式光标已消失")
check(final.hasSendBtn && !final.hasStopBtn, "已切回「发送」按钮（生成结束）")
check(final.hasError === 0, "无错误提示")

console.log("\n=== 5. 侧栏会话列表仍在（未被伪会话破坏）===")
/*
 * 伪造的 conversationId 在后端并不存在，因此不能断言「新会话出现在侧栏」。
 * 这里只确认一件事：流结束后客户端重新拉取了列表且没有把它清空 ——
 * 那是 send() 的 finally 里 `loadConversations()` 的职责，
 * 也是真实使用时「发完消息侧栏标题会更新」所依赖的路径。
 */
const convCount = await page.evaluate(() => document.querySelectorAll(".sc-conv").length)
console.log(`     侧栏会话数：${convCount}`)
check(convCount > 0, `流结束后侧栏会话列表仍然正常（${convCount} 个）`)

console.log("\n=== 6. 无运行时错误 ===")
check(errors.length === 0, `控制台无未捕获错误（${errors.length} 条）`)
for (const e of errors.slice(0, 5)) console.log(`     ⚠ ${e.slice(0, 140)}`)

await browser.close()

console.log("\n" + "=".repeat(52))
console.log(
  failures === 0 ? `学生端对话校验全部通过（${checks} 项）` : `${failures}/${checks} 项未通过`
)
process.exit(failures === 0 ? 0 : 1)
