/**
 * 真实模型是否真的会输出卡片。
 *
 * 前面所有卡片测试都靠注入 SSE —— 那验证的是「模型给了卡片，前端渲染对不对」，
 * 但没验证更根本的一环：**给了协议提示词之后，真实模型到底会不会按协议输出**。
 * 这一环不测，整套卡片可能是「前端写得很精致但永远不会触发」的死代码。
 *
 * 所以这里走完整链路：真实登录 → 真实建会话（带协议）→ 真实发消息 →
 * 看渲染结果里有没有卡片。
 *
 * 用法：node apps/api/scripts/verify-student-cards-real.mjs
 * 说明：会消耗少量模型额度；模型不总按格式输出，因此判定是「多次尝试里有命中」，
 *       而不是「必须命中」。
 */
import { chromium } from "playwright"

const BASE = process.env.BASE_URL || "http://127.0.0.1:5173"
const ATTEMPTS = Number(process.env.ATTEMPTS || 3)

/** 明显适合出卡片的问题（引导卡 / 步骤卡 / 选项卡） */
const PROMPTS = [
  "我校园卡丢了，怎么办？请告诉我一步步怎么办理。",
  "我想预约学校的心理咨询，具体流程是什么？",
  "期末了压力好大，我该从哪儿开始复习？给我几个方向让我选。"
]

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()

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

let hits = 0
const detail = []

for (let i = 0; i < ATTEMPTS; i++) {
  const prompt = PROMPTS[i % PROMPTS.length]
  await page.goto(`${BASE}/student`, { waitUntil: "domcontentloaded" })
  await page.waitForSelector(".student-app", { timeout: 30000 })
  await page.waitForTimeout(800)
  // 抽屉在窄屏会收起，宽屏无影响
  await page.click(".sc-new")
  await page.waitForTimeout(400)
  await page.fill(".sc-textarea", prompt)
  await page.click(".sc-send")

  // 等流式结束（发送按钮回来）
  for (let t = 0; t < 90; t++) {
    await page.waitForTimeout(500)
    const busy = await page.evaluate(() => !!document.querySelector(".sc-send.is-stop"))
    if (!busy) break
  }
  await page.waitForTimeout(600)

  const state = await page.evaluate(() => {
    const bubbles = Array.from(document.querySelectorAll(".sc-msg:not(.is-user) .sc-bubble"))
    const last = bubbles[bubbles.length - 1]
    if (!last) return { cards: [], text: "" }
    return {
      cards: Array.from(last.querySelectorAll(".mc[data-card]")).map((e) => ({
        type: e.getAttribute("data-card"),
        title: e.querySelector(".mc-title,.mc-art-title,.mc-crisis-title")?.textContent?.trim() || ""
      })),
      // 有没有把围栏原文泄露成文本（说明分段没生效）
      leaksFence: (last.textContent || "").includes("```"),
      textLen: (last.textContent || "").trim().length
    }
  })

  const line = `Q${i + 1} 回复 ${state.textLen} 字｜卡片：${
    state.cards.length ? state.cards.map((c) => `${c.type}「${c.title}」`).join("、") : "无"
  }${state.leaksFence ? "｜⚠ 泄露围栏原文" : ""}`
  console.log(line)
  detail.push({ prompt, ...state })
  if (state.cards.length) hits++
}

console.log("\n" + "=".repeat(56))
console.log(`真实模型出卡率：${hits}/${ATTEMPTS}`)

if (hits === 0) {
  console.log(
    "\n⚠ 一次都没出卡片。可能是协议提示词不够强、模型不擅长稳定输出 JSON，" +
      "或该模型未启用工具/指令跟随能力。卡片功能仍然可用（内置卡常驻欢迎页），" +
      "但「模型驱动卡片」这一路的实际命中率需要重新评估。"
  )
} else {
  console.log("\n✓ 真实模型确实会按协议输出卡片，链路打通")
}

const leaked = detail.filter((d) => d.leaksFence)
if (leaked.length) console.log(`⚠ ${leaked.length} 次把围栏原文泄露成了文本`)

await browser.close()
process.exit(leaked.length === 0 ? 0 : 1)
