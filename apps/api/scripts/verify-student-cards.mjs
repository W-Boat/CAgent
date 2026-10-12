/**
 * 学生端「结构化卡片」端到端校验。
 *
 * 覆盖三件事：
 *   1. **欢迎页不再渲染内置卡片**：卡片只由模型按卡片协议输出（LLM 唤出），
 *      欢迎页保持干净；同时确认智能体网格/开场建议仍在
 *   2. **模型驱动的卡片**：注入含各类型 ```card 的 SSE 流，验证渲染、
 *      交互（勾选→提交→锁定、引导项点击）与降级
 *   3. **安全边界**：模型给的危险 url / 编造的求助号码，都不能影响界面
 *
 * ── 为什么第 3 组是重点 ──
 *
 * 卡片数据来自模型输出，属于不可信输入。它可能给出：
 *   - `url: "javascript:alert(1)"`
 *   - crisis 卡里编一个错误的求助号码
 * 前者是 XSS 面，后者是「打不通的求助电话比没有电话更糟」。
 * 所以号码由组件内置常量决定、url 只放行 http/https —— 这两条必须有断言，
 * 否则将来有人"顺手把号码改成读模型的"不会有任何东西拦住他。
 *
 * 用法：node apps/api/scripts/verify-student-cards.mjs
 * 前提：API(3001) 与 web(5173) 已启动。
 */
import { chromium } from "playwright"
import { mkdirSync } from "node:fs"

const BASE = process.env.BASE_URL || "http://127.0.0.1:5173"
const SHOTS = "storage/shots"
mkdirSync(SHOTS, { recursive: true })

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

/** 卡片协议里的围栏语言标记，与 card-segments.ts 保持一致 */
const FENCE = "card"

/**
 * 构造一条流式 SSE：把给定文本按段吐出。
 *
 * 用页面内替换 fetch 而不是 route.fulfill —— 后者要完整 body，
 * 无法模拟流式（会把「逐步渲染」这一关键行为测漏）。
 *
 * @param gapMs 段间隔。测「未闭合围栏的占位」时要把间隔拉大，
 *   否则占位窗口只有几百毫秒，单次采样会漏（实测误判过一次）。
 */
function mockStream(chunks, gapMs = 260) {
  return `
    (function () {
      var CHUNKS = ${JSON.stringify(chunks)};
      var GAP = ${gapMs};
      var orig = window.fetch.bind(window);
      window.fetch = function (input, init) {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        if (url.indexOf('/api/chat/completions') === -1) return orig(input, init);
        var convId = 'card-test-conv';
        var enc = new TextEncoder();
        var frames = [];
        frames.push('event: meta\\ndata: ' + JSON.stringify({
          conversationId: convId,
          userMessageId: 'card-test-user',
          assistantMessageId: 'card-test-assistant',
          model: { id: 'm1', key: 'deepseek-chat', name: 'DeepSeek Chat', provider: 'deepseek' },
          title: '卡片校验'
        }) + '\\n\\n');
        CHUNKS.forEach(function (t) {
          frames.push('event: text\\ndata: ' + JSON.stringify({ text: t }) + '\\n\\n');
        });
        frames.push('event: done\\ndata: ' + JSON.stringify({
          conversationId: convId, assistantMessageId: 'card-test-assistant', status: 'SUCCESS'
        }) + '\\n\\n');
        var i = 0;
        var stream = new ReadableStream({
          start: function (controller) {
            (function push() {
              if (i >= frames.length) { controller.close(); return; }
              controller.enqueue(enc.encode(frames[i++]));
              setTimeout(push, GAP);
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

/**
 * 等待刚发出的回复落定。
 *
 * 线上「建会话 → 建消息 → 流式」要 4~6 秒，本地 1~2 秒 ——
 * 固定等待会在这两端之间反复出错（实测线上 7 张卡里 3 张被误报未渲染）。
 * 所以等两件事，都不靠估时：
 *   1. 助手气泡出现
 *   2. 生成结束（「停止」按钮消失）
 */
async function waitReply(timeoutMs = 45000) {
  await page
    .waitForSelector(".sc-msg:not(.is-user) .sc-bubble", { timeout: timeoutMs })
    .catch(() => undefined)
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const busy = await page.evaluate(() => !!document.querySelector(".sc-send.is-stop"))
    if (!busy || Date.now() > deadline) break
    await page.waitForTimeout(300)
  }
  await page.waitForTimeout(500)
}

/**
 * 切到空会话。
 *
 * 窄屏时侧栏是抽屉，点「新建对话」会顺手把抽屉收起 ——
 * 所以每次都要先确认抽屉是开的，否则第二次点击会报
 * 「element is outside of the viewport」（实测踩过）。
 */
async function newChat() {
  const drawerClosed = await page.evaluate(() => {
    const side = document.querySelector(".sc-side")
    if (!side || window.innerWidth > 860) return false
    // translateX(-101%) 即收起
    return side.getBoundingClientRect().right <= 1
  })
  if (drawerClosed) {
    await page.click(".sc-hamburger")
    await page.waitForTimeout(400)
  }
  await page.click(".sc-new")

  /*
   * 等条件而不是等固定时长 —— 这里有个线上才暴露的竞态：
   * /student 挂载时会**异步**打开最近一条会话（loadMeta → loadConversations
   * → openConversation，两跳网络），本地几百毫秒就完成，线上要两三秒。
   * 固定等 500ms 时点击可能落在「自动打开尚未完成」的窗口里，
   * 随后 openConversation 的结果到达，把刚清空的消息又填回来。
   *
   * 以「欢迎态可见（.sc-welcome 渲染）」为准（内置卡片已改为 LLM 唤出，
   * 欢迎页不再有 .sc-builtin），并复查消息区确为空；
   * 若自动打开的结果晚到把消息填了回来，就再点一次新建重试。
   */
  await page.waitForSelector(".sc-welcome", { timeout: 25000 }).catch(() => undefined)
  await page.waitForTimeout(600)
  let cleared = await page.evaluate(() => document.querySelectorAll(".sc-msg").length === 0)
  if (!cleared) {
    await page.click(".sc-new")
    await page.waitForSelector(".sc-welcome", { timeout: 25000 }).catch(() => undefined)
    await page.waitForTimeout(600)
    cleared = await page.evaluate(() => document.querySelectorAll(".sc-msg").length === 0)
  }
  if (!cleared) throw new Error("未能进入空会话，后续断言会取到历史消息")
}

/**
 * 登录学生并进入 /student 的**空会话**。
 *
 * 必须显式切到空会话：/student 挂载时会自动打开最近一条会话
 * （那是刻意的设计，免得学生每次面对空白），于是消息区里会有历史助手
 * 消息。测试若直接查 `.sc-bubble`，取到的是**旧消息**而不是刚注入的回复
 * —— 实测因此误判「坏 JSON 没有降级」。
 * 清空后再注入，选择器才有唯一含义。
 */
async function enterStudent(initScripts = []) {
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
  for (const s of initScripts) await page.addInitScript(s)
  await page.goto(`${BASE}/student`, { waitUntil: "domcontentloaded" })
  await page.waitForSelector(".student-app", { timeout: 25000 })
  // 等自动打开的会话落定，再切空会话，避免两次渲染抢状态
  await page.waitForTimeout(600)
  await newChat()
}

// ══════════════════ 1. 欢迎页不再渲染内置卡片 ══════════════════
console.log("=== 1. 欢迎页：卡片只由模型唤出 ===")
await enterStudent()
await page.waitForTimeout(700)

/*
 * 需求变更：内置卡片不再常驻欢迎页，全部改由模型按卡片协议输出。
 * 这里守住两条边界：
 *   - 欢迎态不出现**任何**卡片（.mc 是所有卡片组件的根类）；
 *   - 但欢迎页本身没有塌：开场建议与智能体网格仍在（学生仍知道能问什么）。
 */
const welcome = await page.evaluate(() => ({
  cards: document.querySelectorAll(".mc").length,
  welcome: !!document.querySelector(".sc-welcome"),
  starters: document.querySelectorAll(".sc-starter").length,
  agents: document.querySelectorAll(".sc-agent").length
}))
console.log(
  `     欢迎态卡片 ${welcome.cards} 张｜开场建议 ${welcome.starters} 个｜智能体 ${welcome.agents} 个`
)
check(welcome.welcome, "欢迎态渲染（.sc-welcome）")
check(welcome.cards === 0, `欢迎页不再渲染内置卡片（实测 ${welcome.cards} 张）`)
check(welcome.starters > 0, "开场建议仍在")
check(welcome.agents > 0, "智能体网格仍在")

// ══════════════════ 2. 求助卡（LLM 唤出）号码是内置的、可拨的 ══════════════════
console.log("\n=== 2. 求助卡：模型唤出，号码内置可拨 ===")
await enterStudent([
  mockStream([
    `\`\`\`${FENCE}\n${JSON.stringify({
      type: "crisis",
      title: "我很在意你现在的状态",
      body: "先照顾好自己，我们一起想办法。",
      hotline: { label: "心理援助热线", number: "12356", note: "24 小时" }
    })}\n\`\`\``
  ])
])
await page.fill(".sc-textarea", "我最近很难受")
await page.click(".sc-send")
await waitReply()

const crisis = await page.evaluate(() => {
  const card = document.querySelector(".sc-msg:not(.is-user) .mc-crisis")
  if (!card) return null
  const lines = Array.from(card.querySelectorAll(".mc-crisis-line")).map((a) => ({
    num: a.querySelector(".mc-crisis-num")?.textContent?.trim(),
    href: a.getAttribute("href")
  }))
  return { lines, text: card.textContent || "" }
})
check(!!crisis, "模型输出的求助卡渲染（LLM 唤出）")
if (crisis) {
  const nums = crisis.lines.map((l) => l.num)
  console.log(`     号码：${nums.join(", ")}`)
  check(nums.includes("12356"), "含全国统一心理援助热线 12356")
  check(nums.includes("110"), "含紧急号码 110")
  check(
    crisis.lines.every((l) => l.href === `tel:${l.num}`),
    "每行都是 tel: 链接（手机可直接拨）"
  )
  check(/120/.test(crisis.text), "脚注提示 120")
}

// ══════════════════ 3. 选项卡交互（LLM 唤出）：勾选 → 提交 → 锁定 ══════════════════
console.log("\n=== 3. 选项卡：勾选 → 提交 → 锁定 ===")
const OPT_CARD = {
  type: "options",
  title: "你想先做哪件事",
  options: [
    { label: "查成绩", desc: "教务系统入口", action: "帮我查这学期 的成绩单" },
    { label: "借书续期", desc: "图书馆", action: "图书馆借的书怎么续期" }
  ]
}
await enterStudent([mockStream([`\`\`\`${FENCE}\n${JSON.stringify(OPT_CARD)}\n\`\`\``])])
await page.fill(".sc-textarea", "不知道从哪开始")
await page.click(".sc-send")
await waitReply()

const optCard = page.locator(".sc-msg:not(.is-user) .mc[data-card=options]").first()
check((await optCard.count()) === 1, "选项卡渲染（LLM 唤出）")
await optCard.locator(".mc-opt").nth(0).click()
const afterPick = await optCard.evaluate((el) => ({
  onCount: el.querySelectorAll(".mc-opt.is-on").length,
  submitDisabled: el.querySelector(".mc-submit")?.hasAttribute("disabled")
}))
check(afterPick.onCount === 1, `单选：点第一项后选中 1 个（${afterPick.onCount}）`)
check(afterPick.submitDisabled === false, "选中后提交按钮可用")

// 单选切换：点另一项应替换而不是叠加
await optCard.locator(".mc-opt").nth(1).click()
const afterSwitch = await optCard.evaluate((el) => el.querySelectorAll(".mc-opt.is-on").length)
check(afterSwitch === 1, `改点第二项后仍只选中 1 个（${afterSwitch}）`)

await optCard.locator(".mc-submit").click()
await page.waitForTimeout(2600)

const sentState = await page.evaluate(() => ({
  userMsgs: document.querySelectorAll(".sc-msg.is-user .sc-bubble").length,
  lastUser:
    Array.from(document.querySelectorAll(".sc-msg.is-user .sc-bubble")).pop()?.textContent?.trim() ||
    "",
  sentMark: !!document.querySelector(".mc-sent"),
  submitGone: !document.querySelector(".sc-msg:not(.is-user) .mc[data-card=options] .mc-submit")
}))
console.log(`     用户气泡 ${sentState.userMsgs} 条；最新：${sentState.lastUser.slice(0, 40)}`)
check(sentState.userMsgs >= 1, "提交后发出了消息（出现用户气泡）")
check(/续期|图书馆/.test(sentState.lastUser), "发出的是该项 action 原文，而非拼接标签")
check(sentState.sentMark || sentState.submitGone, "卡片进入已发送态（锁住，防重复提交）")

// ══════════════════ 4. 引导卡点击（LLM 唤出） ══════════════════
console.log("\n=== 4. 引导入口卡：点击即追问 ===")
const GUIDE_CARD = {
  type: "guide",
  title: "接下来",
  items: [
    { label: "校园卡服务中心", desc: "行政楼一层", action: "校园卡丢了要怎么挂失补办" },
    { label: "图书馆", desc: "两校区", action: "图书馆开放时间" }
  ]
}
await enterStudent([mockStream([`\`\`\`${FENCE}\n${JSON.stringify(GUIDE_CARD)}\n\`\`\``])])
await page.fill(".sc-textarea", "帮我指个路")
await page.click(".sc-send")
await waitReply()

const beforeCount = await page.evaluate(() => document.querySelectorAll(".sc-msg.is-user").length)
/*
 * 按文案定位而不是 .first()：引导项会随需求增删，
 * 用位置选会让断言悄悄换目标。按文案选，测试意图与页面结构解耦。
 */
const campusEntry = page
  .locator(".sc-msg:not(.is-user) .mc-guide")
  .filter({ hasText: "校园卡" })
  .first()
await campusEntry.click()
await page.waitForTimeout(2200)
const guideState = await page.evaluate(() => {
  const bubbles = Array.from(document.querySelectorAll(".sc-msg.is-user .sc-bubble")).map(
    (b) => b.textContent?.trim() || ""
  )
  return { count: bubbles.length, last: bubbles[bubbles.length - 1] || "" }
}, beforeCount)
console.log(`     发出：${guideState.last.slice(0, 44)}`)
check(guideState.count > beforeCount, "点击引导项后发出了一条消息")
check(/校园卡|挂失|补办/.test(guideState.last), "内容是该项 action 的完整追问（含细节）")

// ══════════════════ 5. 模型驱动的七类卡片 ══════════════════
console.log("\n=== 5. 模型输出各类型卡片 → 正确渲染 ===")

const CARDS = {
  options: {
    type: "options",
    title: "你想先做哪件事",
    options: [
      { label: "查成绩", desc: "教务系统入口" },
      { label: "借书续期", desc: "图书馆" }
    ]
  },
  guide: {
    type: "guide",
    title: "接下来",
    items: [{ label: "去服务中心", desc: "行政楼一层", action: "补办要带什么" }]
  },
  steps: {
    type: "steps",
    title: "补办校园卡",
    note: "需本人",
    steps: [
      { title: "挂失", desc: "App 内操作", done: true },
      { title: "交照片", desc: "一寸照" },
      { title: "领卡", desc: "3 个工作日" }
    ]
  },
  poem: {
    type: "poem",
    title: "赠毕业",
    body: "山水万程\n皆要好运",
    author: "致 2026 届",
    seal: "赠"
  },
  article: {
    type: "article",
    kicker: "校园生活",
    title: "如何用好后图书馆",
    lead: "两层楼，各有各的用法。",
    sections: [
      { heading: "一、找书", paragraphs: ["馆藏检索后记下架位号，负一层是密集书库。"], list: ["索书号", "架位"] },
      { heading: "二、占座", paragraphs: ["开馆前半小时排队。"], quote: "座位不是抢来的，是早起换来的。" }
    ],
    footer: "来源：图书馆读者手册"
  },
  agents: {
    type: "agents",
    title: "交给它更合适",
    reason: "这类问题它有专门的检索能力",
    agents: [{ id: "not-a-real-id", name: "科研助手", desc: "文献检索" }],
    skills: [{ key: "fake-skill", name: "论文提纲生成" }]
  },
  crisis: {
    type: "crisis",
    title: "我注意到你说的话",
    // 故意给一个假号码：组件必须忽略它
    hotline: { label: "假热线", number: "000-0000" }
  }
}

/** 逐张卡单独测：一次注入一张，避免相互干扰 */
for (const [name, card] of Object.entries(CARDS)) {
  const reply = `这是测试。\n\n\`\`\`${FENCE}\n${JSON.stringify(card, null, 2)}\n\`\`\`\n\n卡片之后还有一段正文。`
  await enterStudent([mockStream([reply])])
  await page.fill(".sc-textarea", "测试卡片")
  await page.click(".sc-send")
  await page.waitForTimeout(3000)

  const state = await page.evaluate(
    (n) => {
      // 按 data-card 定位卡片根节点（类型不再以 class 表达）
      const el = document.querySelector(`.sc-msg:not(.is-user) .mc[data-card=${n}]`)
      const bubble = el?.closest(".sc-bubble")
      return {
        rendered: !!el,
        hasMarkdownBefore: !!bubble?.querySelector(".markdown-body"),
        trailingText: bubble?.textContent?.includes("卡片之后还有一段正文") || false,
        kind: el?.querySelector(".mc-kind")?.textContent?.trim() || ""
      }
    },
    name
  )
  check(state.rendered, `${name.padEnd(8)} 渲染为卡片`)
  check(
    state.hasMarkdownBefore && state.trailingText,
    `${name.padEnd(8)} 卡片前后的 Markdown 正文都在`
  )
}

// ══════════════════ 6. 降级路径 ══════════════════
console.log("\n=== 6. 异常与降级 ===")

/* 6a. JSON 不合法 → 退化成代码块，内容不丢 */
await enterStudent([
  mockStream([
    `坏卡片：\n\n\`\`\`${FENCE}\n{ "type": "options", "title": "缺逗号" "options": [] }\n\`\`\``
  ])
])
await page.fill(".sc-textarea", "测试坏 JSON")
await page.click(".sc-send")
await waitReply()
const broken = await page.evaluate(() => {
  const bubble = document.querySelector(".sc-msg:not(.is-user) .sc-bubble")
  const code = bubble?.querySelector(".md-code")
  // 列出气泡里除占位/正文外的 mc-* 节点：有就说明渲染出了半成品卡片
  const cardNodes = Array.from(bubble?.querySelectorAll("[class]") || []).filter((el) =>
    [...el.classList].some((c) => c.startsWith("mc-") && !c.startsWith("mc-pending"))
  )
  return {
    hasCode: !!code,
    keepsContent: (bubble?.textContent || "").includes("缺逗号"),
    cardNodeCount: cardNodes.length
  }
})
check(broken.hasCode, "坏 JSON 降级为代码块而不是空白")
check(broken.keepsContent, "原文内容保留（不吞掉模型输出）")
check(broken.cardNodeCount === 0, "没有渲染出半成品卡片")

/* 6b. 未知类型 → 兜底提示 */
await enterStudent([
  mockStream([`\`\`\`${FENCE}\n{"type":"spaceship","title":"火星车"}\n\`\`\``])
])
await page.fill(".sc-textarea", "测试未知类型")
await page.click(".sc-send")
await waitReply()
const unknown = await page.evaluate(() => {
  const el = document.querySelector(".mc-unknown")
  return { rendered: !!el, text: el?.textContent?.trim() || "" }
})
check(unknown.rendered, "未知卡片类型走兜底而不是白屏")
check(/火星车|不认识/.test(unknown.text), `兜底有说明：${unknown.text.slice(0, 30)}`)

/* 6c. 流式期间：围栏未闭合时不得出现半截 JSON */
await enterStudent([
  mockStream(
    [
      `边写边给卡片：\n\n\`\`\`${FENCE}\n{"type":"options","title":"还在长",`,
      `"options":[{"label":"甲"},{"label":"乙"}]}\n\`\`\`\n`
    ],
    // 段间隔拉到 1600ms：占位窗口只有一瞬，间隔太短会采样不到（实测误判过）
    1600
  )
])
await page.fill(".sc-textarea", "测试流式占位")
await page.click(".sc-send")

/*
 * 轮询捕捉占位，而不是在固定时刻采样一次。
 * 占位只存在于「第一段已到、闭合行未到」这段窗口。
 *
 * 线上要先等 ensureConversation 建会话（1~2 秒）流式才开始，
 * 窗口随即在 1600ms 后关闭 —— 轮询 3.6 秒就退出的写法
 * 会整个错过窗口（实测线上 4 项连片失败）。这里拉长到 12 秒，
 * 覆盖「建会话 + 首段到达」的最慢情形。
 */
let pending = null
for (let i = 0; i < 80; i++) {
  await page.waitForTimeout(150)
  pending = await page.evaluate(() => {
    const bubble = document.querySelector(".sc-msg:not(.is-user) .sc-bubble")
    if (!bubble) return null
    const txt = bubble.textContent || ""
    return {
      hasPending: !!bubble.querySelector(".mc-pending"),
      leaksBraces: txt.includes('"type"') || txt.includes("options"),
      interactive: !!bubble.querySelector(".mc-submit")
    }
  })
  if (pending?.hasPending) break
}
check(!!pending?.hasPending, "未闭合围栏显示「正在生成卡片」占位")
check(!!pending && !pending.leaksBraces, "不泄露半截 JSON 源码")
check(!!pending && !pending.interactive, "半成品卡片不可交互（防误提交）")

// 第二段（含闭合行）在 1600ms 后才到，等它落定
await page.waitForTimeout(3200)
const settled = await page.evaluate(() => {
  const bubble = document.querySelector(".sc-msg:not(.is-user) .sc-bubble")
  return {
    card: !!bubble?.querySelector(".mc[data-card=options]"),
    stillPending: !!bubble?.querySelector(".mc-pending")
  }
})
check(settled.card, "流结束后占位变成真卡片")
check(!settled.stillPending, "占位已撤下")

/* 6d. 危险 url 被拒 */
await enterStudent([
  mockStream([
    `\`\`\`${FENCE}\n{"type":"guide","title":"链接安全","items":[{"label":"危险","url":"javascript:alert(1)"},{"label":"正常","url":"https://example.com/x"}]}\n\`\`\``
  ])
])
await page.fill(".sc-textarea", "测试链接安全")
await page.click(".sc-send")
await waitReply()
const linkSafety = await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll(".mc-guide"))
  return items.map((el) => ({
    tag: el.tagName.toLowerCase(),
    href: el.getAttribute("href"),
    label: el.querySelector(".mc-guide-label")?.textContent?.trim()
  }))
})
console.log(`     ${JSON.stringify(linkSafety)}`)
const dangerous = linkSafety.find((l) => l.label === "危险")
const safe = linkSafety.find((l) => l.label === "正常")
check(!!dangerous && dangerous.tag === "button", "javascript: 链接被降级为按钮（不成为 a[href]）")
check(!!dangerous && !/^javascript:/i.test(dangerous.href || ""), "DOM 上不存在 javascript: href")
check(!!safe && safe.tag === "a" && /^https:\/\//.test(safe.href || ""), "https 链接正常放行")

/* 6e. 模型编造的求助号码必须被忽略 */
await enterStudent([
  mockStream([
    `\`\`\`${FENCE}\n{"type":"crisis","title":"求助","hotline":{"label":"假热线","number":"000-0000"}}\n\`\`\``
  ])
])
await page.fill(".sc-textarea", "测试号码可信度")
await page.click(".sc-send")
await waitReply()
const crisisNums = await page.evaluate(() =>
  Array.from(document.querySelectorAll(".mc-crisis-num")).map((e) => e.textContent?.trim())
)
console.log(`     渲染出的号码：${crisisNums.join(", ")}`)
check(!crisisNums.includes("000-0000"), "模型给的假号码被忽略")
check(crisisNums.includes("12356"), "仍显示内置的 12356")

/* 6f. 切换卡里的假 id 不能导致静默失败 */
await enterStudent([
  mockStream([
    `\`\`\`${FENCE}\n{"type":"agents","title":"换助手","agents":[{"id":"not-a-real-id","name":"科研助手"}]}\n\`\`\``
  ])
])
await page.fill(".sc-textarea", "测试切换")
await page.click(".sc-send")
await waitReply()
await page.locator(".mc-switch").first().click()
await page.waitForTimeout(900)
const switched = await page.evaluate(() => ({
  warned: /不可用/.test(document.body.innerText || ""),
  agentValue: document.querySelector("select[aria-label='选择智能体']")?.value ?? null
}))
check(switched.warned, "点了不存在的智能体 id 会明确提示，而非静默失败")

// ══════════════════ 7. 协议注入与自动标题 ══════════════════
console.log("\n=== 7. 卡片协议写进了新会话，且标题取自首条消息 ===")
await enterStudent()
const PROMPT_TEXT = "帮我看看选课冲突怎么办"
await page.fill(".sc-textarea", PROMPT_TEXT)
await page.click(".sc-send")
await page.waitForTimeout(4000)

const token = await page.evaluate(() => localStorage.getItem("cagent.accessToken"))
const convs = await page.evaluate(async (t) => {
  const r = await fetch("/api/conversations?page=1&pageSize=20", {
    headers: { Authorization: `Bearer ${t}` }
  })
  return r.json()
}, token)

/*
 * 按标题找，而不是取 items[0]。
 *
 * 列表排序是 pinned desc + updatedAt desc，置顶的旧会话会一直排在最前，
 * 取 [0] 拿到的是别人的历史会话（实测因此误判「协议没注入」）。
 * 用刚发出的那句话当锚点，既定位准确，又顺带验证了标题生成。
 */
const items = convs?.data?.items || []
const mine = items.find((c) => (c.title || "").includes("选课冲突"))
const sp = mine?.systemPrompt || ""
console.log(
  `     找到会话「${mine?.title}」，systemPrompt 长度 ${sp.length}` +
    `｜列表首条是「${items[0]?.title}」（置顶，故不能取 [0]）`
)
check(!!mine, `新会话标题取自首条消息（而非停在「新对话」）`)
check(sp.length > 200, "新会话带上了卡片协议提示词")
check(sp.includes("```card"), "协议里声明了 card 围栏")
check(sp.includes("12356"), "协议给出的是已核实号码")
check(/id=/.test(sp), "协议附上了真实智能体清单（防模型编 id）")

/*
 * 协议里的技能清单不能有重名项。
 *
 * 库里同一个工具有两条记录：内置工具用下划线 key（couple_context），
 * seed 的技能用连字符 key（couple-context），显示名都是「情侣空间现状」。
 * 实测 /skills/available 返回 23 条里有 4 对这样的重复。
 * 后端组装工具定义时已按归一化名去过重，但 available 接口本身没有 ——
 * 不去重就会把重复项写进提示词，白占上下文，还可能让模型在两个等价 key
 * 之间犹豫。
 */
const skillBlock = sp.split("【当前可用技能清单】")[1] || ""
const skillNames = skillBlock
  .split("\n")
  .filter((l) => l.trim().startsWith("- "))
  .map((l) => l.split("｜")[1] || "")
  .filter(Boolean)
const dupes = skillNames.filter((n, i) => skillNames.indexOf(n) !== i)

/*
 * 与接口原始条数对比 —— 否则这个断言永远成立。
 *
 * 去重后的清单里当然没有重名，只查协议本身等于没查。
 * 真正要证明的是「协议不会比接口原始列表更长」，且重名被折叠。
 *
 * ⚠️ 不能断言「协议一定比原始少」：去重只在**库里确有重复**时才变短。
 *    断言必须表达「有重复就折掉、没重复就原样保留」。
 *
 * ⚠️ 前端现在有两层清洗，脚本必须复刻同一管线再比，否则数量对不上：
 *    1. 情侣相关**完全隐藏**（产品决策，不受 loveline_enabled 开关影响）——
 *       available() 无条件过滤情侣/loveline/couple 相关项（api/index.ts）；
 *    2. 按「名字+描述」去重（utils/skills.ts 的 dedupeSkills）。
 */
const rawSkillCount = await page.evaluate(async () => {
  const t = localStorage.getItem("cagent.accessToken")
  const r = await fetch("/api/skills/available", { headers: { Authorization: `Bearer ${t}` } })
  const list = (await r.json())?.data || []
  const LOVELINE_RE = /情侣|恋人|爱人|loveline|love[-_]?line|couple/i
  const filtered = list.filter(
    (s) => !LOVELINE_RE.test(`${s.key || ""} ${s.name || ""} ${s.description || ""}`)
  )
  const seen = new Set()
  for (const s of filtered) {
    seen.add(`${(s.name || "").trim().toLowerCase()}::${(s.description || "").trim().toLowerCase()}`)
  }
  return { total: list.length, afterFilter: filtered.length, distinct: seen.size }
})
console.log(
  `     接口原始 ${rawSkillCount.total} 条（隐藏后 ${rawSkillCount.afterFilter}，` +
    `可区分 ${rawSkillCount.distinct}）→ 协议内 ${skillNames.length} 项，重名 ${dupes.length} 项`
)
check(skillNames.length > 0, "协议附上了技能清单")
check(dupes.length === 0, `技能清单无重名（重复：${[...new Set(dupes)].join(",") || "无"}）`)
check(
  skillNames.length === rawSkillCount.distinct,
  `协议条数与「接口过滤+去重后」一致（协议 ${skillNames.length} / 可区分 ${rawSkillCount.distinct}）`
)
/*
 * 情侣相关技能不得进协议（完全隐藏，无条件）。
 * 之前协议里带着「情侣空间现状」这类项 —— 功能藏了但提示词还在
 * 广告它，等于半隐藏。这条守住「藏就藏干净」。
 */
{
  const leaked = skillNames.filter((n) => /情侣|恋人|love/i.test(n))
  check(leaked.length === 0, `协议技能清单不含情侣相关项（漏出：${leaked.join(",") || "无"}）`)
}

/*
 * 协议只影响学生端会话：不能污染服务端全局默认提示词。
 * 这条守住「我们没去改管理员配置」这个边界。
 */
const pub = await page.evaluate(async () => {
  const r = await fetch("/api/settings/public")
  return r.json()
}, [])
check(
  !(pub?.data?.default_system_prompt || "").includes("```card"),
  "服务端全局默认提示词未被改写（协议只落在会话级）"
)

// ══════════════════ 8. 视觉与移动端 ══════════════════
console.log("\n=== 8. 外观 ===")
await enterStudent()
await page.waitForTimeout(900)
await page.screenshot({ path: `${SHOTS}/cards-welcome.png`, fullPage: true })
console.log(`     截图 → ${SHOTS}/cards-welcome.png`)

/* 竖排诗：确认 writing-mode 真的生效（这是"特殊排版卡"的核心） */
await enterStudent([
  mockStream([
    `\`\`\`${FENCE}\n{"type":"poem","title":"赠毕业","body":"山水万程\\n皆要好运","author":"致 2026 届","seal":"赠"}\n\`\`\``
  ])
])
await page.fill(".sc-textarea", "写首赠言")
await page.click(".sc-send")
await waitReply()
const poem = await page.evaluate(() => {
  const line = document.querySelector(".mc-poem-line")
  const body = document.querySelector(".mc-poem-body")
  const seal = document.querySelector(".mc-poem-seal")
  return {
    writingMode: line ? getComputedStyle(line).writingMode : "",
    family: line ? getComputedStyle(line).fontFamily : "",
    lines: document.querySelectorAll(".mc-poem-line").length,
    dir: body ? getComputedStyle(body).flexDirection : "",
    seal: seal?.textContent?.trim() || ""
  }
})
console.log(`     writing-mode=${poem.writingMode} dir=${poem.dir} 行数=${poem.lines} 印=${poem.seal}`)
check(/vertical/.test(poem.writingMode), "诗句为竖排（writing-mode: vertical-rl）")
// 竖排从右往左：容器用 row-reverse，第一列落在最右边
check(poem.dir === "row-reverse", `竖排自右向左（flex-direction: ${poem.dir}）`)
check(poem.lines >= 2, `按 \\n 分成 ${poem.lines} 列`)
check(/Songti|STSong|SimSun|serif/i.test(poem.family), "诗用衬线字体")
check(poem.seal.length > 0, `落款小印「${poem.seal}」`)

await page.screenshot({ path: `${SHOTS}/cards-poem.png`, fullPage: false })

/* 文章卡：首字下沉 + 小节标记 */
await enterStudent([
  mockStream([
    `\`\`\`${FENCE}\n${JSON.stringify(CARDS.article)}\n\`\`\``
  ])
])
await page.fill(".sc-textarea", "写一篇介绍")
await page.click(".sc-send")
await waitReply()
const art = await page.evaluate(() => {
  const card = document.querySelector(".mc-article")
  if (!card) return null
  const firstPara = card.querySelector(".mc-art-sec .mc-art-para")
  return {
    kicker: card.querySelector(".mc-art-kicker")?.textContent?.trim(),
    headings: card.querySelectorAll(".mc-art-heading").length,
    paras: card.querySelectorAll(".mc-art-para").length,
    quote: !!card.querySelector(".mc-art-quote"),
    listItems: card.querySelectorAll(".mc-art-list li").length,
    firstLetterSize: firstPara ? getComputedStyle(firstPara, "::first-letter").fontSize : "",
    footer: card.querySelector(".mc-art-foot")?.textContent?.trim()
  }
})
console.log(
  `     眉标=${art?.kicker} 小节=${art?.headings} 段落=${art?.paras} 引用=${art?.quote} 列表=${art?.listItems} 首字=${art?.firstLetterSize}`
)
check(!!art, "文章卡渲染")
check((art?.headings || 0) >= 2, "多个小节")
check(!!art?.quote, "引用块")
check((art?.listItems || 0) >= 2, "要点列表")
check(art?.firstLetterSize === "34px", "首段有首字下沉")
check(!!art?.footer, "来源脚注")
await page.screenshot({ path: `${SHOTS}/cards-article.png`, fullPage: false })

/* 步骤卡：勾选与进度 */
await enterStudent([mockStream([`\`\`\`${FENCE}\n${JSON.stringify(CARDS.steps)}\n\`\`\``])])
await page.fill(".sc-textarea", "怎么办")
await page.click(".sc-send")
await waitReply()
const stepBefore = await page.evaluate(() => ({
  done: document.querySelectorAll(".mc-step.is-done").length,
  text: document.querySelector(".mc-progress-text")?.textContent?.trim()
}))
check(stepBefore.done === 1, `模型给的 done 生效（已完成 ${stepBefore.done} 步）`)
await page.locator(".mc-step-check").nth(1).click()
await page.waitForTimeout(400)
const stepAfter = await page.evaluate(() => ({
  done: document.querySelectorAll(".mc-step.is-done").length,
  text: document.querySelector(".mc-progress-text")?.textContent?.trim(),
  fill: document.querySelector(".mc-progress-fill")?.style.width
}))
check(stepAfter.done === 2, `点选后变 2 步已完成（${stepAfter.done}）`)
check(stepAfter.text === "2/3", `进度文字 ${stepAfter.text}`)
check(stepAfter.fill === "67%", `进度条 ${stepAfter.fill}`)
await page.screenshot({ path: `${SHOTS}/cards-steps.png`, fullPage: false })

/* 移动端 */
await page.setViewportSize({ width: 390, height: 844 })
await enterStudent()
await page.waitForTimeout(1200)
const mobWelcome = await page.evaluate(() => {
  const doc = document.documentElement
  return {
    overflow: doc.scrollWidth > doc.clientWidth + 1,
    starters: document.querySelectorAll(".sc-starter").length,
    starterMinH: Math.min(
      ...Array.from(document.querySelectorAll(".sc-starter")).map((r) => r.getBoundingClientRect().height)
    )
  }
})
check(!mobWelcome.overflow, "移动端欢迎页无横向溢出")
check(mobWelcome.starters > 0, "移动端开场建议仍渲染")
check(mobWelcome.starterMinH >= 40, `开场建议触控高度 ≥40px（${Math.round(mobWelcome.starterMinH)}）`)
await page.screenshot({ path: `${SHOTS}/cards-mobile.png`, fullPage: true })

/* 移动端卡片触控目标：注入一张选项卡实测行高（内置卡已不在欢迎页） */
await enterStudent([
  mockStream([`\`\`\`${FENCE}\n${JSON.stringify(OPT_CARD)}\n\`\`\``])
])
await page.fill(".sc-textarea", "移动端测试")
await page.click(".sc-send")
await waitReply()
const mob = await page.evaluate(() => {
  const doc = document.documentElement
  const card = document.querySelector(".sc-msg:not(.is-user) .mc[data-card=options]")
  return {
    overflow: doc.scrollWidth > doc.clientWidth + 1,
    rendered: !!card,
    minRowHeight: card
      ? Math.min(...Array.from(card.querySelectorAll(".mc-opt")).map((r) => r.getBoundingClientRect().height))
      : 0
  }
})
console.log(`     移动端卡片行高 ${Math.round(mob.minRowHeight)}px`)
check(!mob.overflow, "移动端消息区无横向溢出")
check(mob.rendered, "移动端模型卡片正常渲染")
check(mob.minRowHeight >= 44, `可点行高度 ≥44px（${Math.round(mob.minRowHeight)}）`)

console.log("\n=== 9. 无运行时错误 ===")
check(errors.length === 0, `控制台无未捕获错误（${errors.length} 条）`)
for (const e of errors.slice(0, 6)) console.log(`     ⚠ ${e.slice(0, 160)}`)

await browser.close()
console.log("\n" + "=".repeat(52))
console.log(failures === 0 ? `卡片校验全部通过（${checks} 项）` : `${failures}/${checks} 项未通过`)
process.exit(failures === 0 ? 0 : 1)
