/**
 * 遮罩（el-loading-mask）行为校验。
 *
 * 本次改动的核心主张是：
 *   1. **快请求不闪白** —— 请求在延迟窗口内返回时，遮罩从未可见
 *   2. **慢请求仍可见** —— 超过延迟窗口后遮罩正常出现，用户有反馈
 *   3. **淡出要快** —— 数据到位后遮罩立刻让位
 *   4. 路由进度条在导航期间出现，且不拦截点击
 *
 * 这些行为全部由 CSS 的 transition-delay 实现，属于「看不见的行为」，
 * 光读代码无法确认生效，必须实测遮罩元素在不同时机下的 opacity。
 *
 * ── 实现要点 ──
 *
 * 采样必须**从页面脚本执行前就开始**（遮罩可能在首帧就出现），
 * 因此用 addInitScript 在文档创建时注入采样器，把结果累计到
 * window.__maskSamples，等导航结束后再读出来。
 *
 * 用整页 goto 而不是客户端路由跳转：keep-alive 的页面二次进入不会
 * 重新拉数据，也就不会有遮罩 —— 那样测出来的「无闪白」是假的。
 *
 * 用法：node apps/api/scripts/verify-loading-mask.mjs
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

/**
 * 采样器：从文档创建起，逐帧记录遮罩与进度条的「可见」状态。
 *
 * ── 两个必须注意的细节（都由实测踩出来）──
 *
 * 1. **要跳过样式未就绪的帧**
 *    遮罩节点插入 DOM 的那一帧，样式表可能还没应用到它身上，
 *    `getComputedStyle` 会返回 opacity 的**初始值 1** ——
 *    于是「60ms 的快请求」被误记成闪过一次，而实际上它全程是 0。
 *    判据：过渡类名还没挂上（class 里没有 el-loading-fade-*），
 *    说明 Vue 的过渡尚未接管，这一帧不代表真实观感，跳过。
 *
 * 2. **用 opacity 而非「元素存在」判断可见**
 *    元素存在 ≠ 看得见：延迟淡入期间元素一直在 DOM 里、display 为
 *    block，但 opacity 是 0，肉眼完全不可见。这正是本次优化的核心，
 *    必须按 opacity 判定。
 */
const SAMPLER = `
  window.__maskSamples = { mask: [], bar: [], firstInDom: null, t0: performance.now() };
  (function sample() {
    var t = Math.round(performance.now() - window.__maskSamples.t0);
    var m = document.querySelector('.el-loading-mask');
    if (m) {
      var cs = getComputedStyle(m);
      // 过渡类已挂 = 样式已接管这一帧，读数可信
      var transitionReady = m.className.indexOf('el-loading-fade-') !== -1;
      if (transitionReady && window.__maskSamples.firstInDom === null) {
        window.__maskSamples.firstInDom = t;
      }
      if (transitionReady && Number(cs.opacity) > 0.05 && cs.display !== 'none') {
        window.__maskSamples.mask.push({ t: t, o: Number(cs.opacity).toFixed(2) });
      }
    }
    var b = document.getElementById('cg-route-progress');
    if (b && Number(getComputedStyle(b).opacity) > 0.3) {
      window.__maskSamples.bar.push(t);
    }
    if (t < 2600) requestAnimationFrame(sample);
  })();
`

/** 登录并写入令牌，之后所有导航都带登录态 */
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" })
await page.evaluate(async (base) => {
  const r = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@cagent.local", password: "CHANGE_ME_SEED_ADMIN_PASSWORD" })
  })
  const j = await r.json()
  localStorage.setItem("cagent.accessToken", j.data.accessToken)
  localStorage.setItem("cagent.refreshToken", j.data.refreshToken || "")
}, BASE)

console.log("=== 1. CSS 规则本身 ===")
/*
 * 先确认样式真的注入了。Element Plus 按需引入后 CSS 分块加载，
 * 若这条规则被后续同优先级样式覆盖，后面所有采样都会失去意义。
 *
 * 注意要同时带 enter-from 与 enter-active：
 * Vue 过渡期间两个类同时存在，opacity:0 来自 enter-from，
 * 延迟来自 enter-active —— 只挂一个类是测不出真实起始状态的。
 */
await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" })
await page.waitForTimeout(2200)

const rule = await page.evaluate(() => {
  const probe = document.createElement("div")
  probe.className = "el-loading-mask el-loading-fade-enter-from el-loading-fade-enter-active"
  probe.style.position = "fixed"
  probe.style.inset = "0"
  document.body.appendChild(probe)
  const cs = getComputedStyle(probe)
  const out = {
    transitionDelay: cs.transitionDelay,
    opacity: cs.opacity,
    maskVar: getComputedStyle(document.documentElement)
      .getPropertyValue("--el-mask-color")
      .trim(),
    spinnerVar: getComputedStyle(document.documentElement)
      .getPropertyValue("--el-loading-spinner-size")
      .trim()
  }
  probe.remove()
  return out
})
console.log(
  `     过渡延迟 ${rule.transitionDelay}｜起始 opacity ${rule.opacity}｜` +
    `遮罩令牌 ${rule.maskVar}｜spinner ${rule.spinnerVar}`
)
check(rule.transitionDelay.includes("0.2s"), `进入带 0.2s 延迟（${rule.transitionDelay}）`)
check(rule.opacity === "0", `延迟窗口内不可见（opacity=${rule.opacity}）`)
check(rule.spinnerVar === "26px", `spinner 收敛到 26px（${rule.spinnerVar}）`)

/**
 * 遮罩必须是半透明的（而不是 EP 默认的 90% 不透明白）。
 *
 * 用数值解析而不是字符串比对：生产构建的 CSS 压缩器会把 `0.62`
 * 写成 `.62`，两者等价。曾经因为写死 `includes("0.62")` 而在
 * 生产产物上误报失败 —— 断言要盯语义，不要盯字面量。
 */
function alphaOf(color) {
  const m = String(color).match(/rgba?\(([^)]+)\)/)
  if (!m) return null
  const parts = m[1].split(",").map((s) => Number(s.trim()))
  return parts.length === 4 ? parts[3] : 1 // rgb() 视为完全不透明
}
const maskAlpha = alphaOf(rule.maskVar)
console.log(`     遮罩 alpha = ${maskAlpha}`)
check(
  maskAlpha !== null && maskAlpha > 0.4 && maskAlpha < 0.75,
  `遮罩为半透明而非不透明白屏（alpha=${maskAlpha}）`
)

console.log("=== 2. 快请求：遮罩必须等满延迟窗口才可能可见 ===")
/*
 * ── 这里断言的是「延迟生效」，而不是「遮罩一帧都不出现」──
 *
 * 一开始写的是后者，结果稳定失败。查明原因后发现是**测试的假设错了**：
 * 工作台页同时打三个接口（mine / trend / quota），Playwright 只拦了
 * mine 一个。即使把 mine 压到 60ms，其余接口的真实耗时仍可能超过
 * 200ms 窗口，遮罩于是合理地出现了 —— 那是设计内的行为，不是缺陷。
 *
 * 真正该断言的是本次优化的**机制**：
 *   当遮罩被插入 DOM 后，至少 200ms 内不得可见。
 * 只要这条成立，任何在窗口内返回的请求就必然全程无闪 ——
 * 这正是「消除闪白」的充要条件，且不受页面接口数量的影响。
 *
 * ── 为什么用「一个处理器 + 可变延时」而不是反复 route/unroute ──
 *
 * 反复注册同一路径的处理器在慢网络下有竞态：旧的 route 可能已经被
 * 取消但拦截仍在飞行中，继续时抛「Route is already handled!」
 * 把整个脚本带崩（实测在线上出现过）。改成一个从头挂到尾的处理器，
 * 只切换它读取的延时变量，就没有注册/注销的时序问题。
 */
await page.addInitScript(SAMPLER)

/** 当前生效的注入延时（毫秒）；0 表示不干预 */
let mockDelayMs = 60
await page.route("**/api/dashboard/mine", async (route) => {
  if (mockDelayMs > 0) await new Promise((r) => setTimeout(r, mockDelayMs))
  await route.continue()
})

await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" })
await page.waitForTimeout(2400)

const fast = await page.evaluate(() => window.__maskSamples)
const fastFirst = fast.firstInDom
const fastVisible = fast.mask[0]
console.log(
  `     遮罩入 DOM 于 ${fastFirst ?? "—"}ms｜首次可见 ${fastVisible ? `${fastVisible.t}ms（opacity ${fastVisible.o}）` : "从未出现"}`
)
check(fastFirst !== null, "本次导航确实创建过遮罩（断言有对象）")
if (fastFirst !== null) {
  if (fastVisible) {
    const gap = fastVisible.t - fastFirst
    console.log(`     入 DOM → 可见 间隔 ${gap}ms`)
    check(gap >= 190, `可见之前等满了延迟窗口（实测 ${gap}ms ≥ 190ms）`)
  } else {
    console.log("     遮罩全程未可见 —— 延迟窗口内请求已返回，零闪白")
    check(true, "遮罩全程未可见（快请求零闪白）")
  }
}

console.log("\n=== 3. 慢请求时遮罩正常出现 ===")
/*
 * 只改延时不重注册路由 —— 避免注册/注销的时序竞态（见第 2 步说明）。
 * 900ms 远超 200ms 延迟窗口：遮罩应当出现，用户能看到反馈。
 */
mockDelayMs = 900
await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" })
await page.waitForTimeout(2600)
const slow = await page.evaluate(() => window.__maskSamples)
console.log(
  `     遮罩入 DOM 于 ${slow.firstInDom ?? "—"}ms｜可见帧 ${slow.mask.length} 个` +
    (slow.mask.length ? `｜首次可见 ${slow.mask[0].t}ms` : "")
)
check(slow.mask.length > 0, "900ms 的请求显示了遮罩（用户有反馈）")
if (slow.firstInDom !== null && slow.mask.length) {
  const gap = slow.mask[0].t - slow.firstInDom
  check(gap >= 190, `慢请求同样先等满延迟窗口（${gap}ms），时机一致`)
}
// 后续不再需要注入延时，恢复真实网络行为
mockDelayMs = 0

console.log("\n=== 4. 遮罩视觉：半透明 + 模糊 ===")
const visual = await page.evaluate(() => {
  const probe = document.createElement("div")
  probe.className = "el-loading-mask"
  probe.innerHTML =
    '<div class="el-loading-spinner"><svg class="circular" viewBox="0 0 50 50">' +
    '<circle class="path" cx="25" cy="25" r="20" fill="none"/></svg></div>'
  probe.style.position = "fixed"
  probe.style.inset = "0"
  document.body.appendChild(probe)
  const cs = getComputedStyle(probe)
  const circle = probe.querySelector(".circular")
  const path = probe.querySelector(".path")
  const out = {
    bg: cs.backgroundColor,
    backdrop: cs.backdropFilter || cs.webkitBackdropFilter,
    spinnerSize: circle ? getComputedStyle(circle).width : "",
    stroke: path ? getComputedStyle(path).stroke : ""
  }
  probe.remove()
  return out
})
console.log(
  `     底色 ${visual.bg}｜spinner ${visual.spinnerSize}｜描边 ${visual.stroke}｜模糊 ${visual.backdrop}`
)
check(visual.backdrop.includes("blur"), `遮罩带轻微模糊（${visual.backdrop}）`)
check(visual.spinnerSize === "26px", `spinner 实际渲染为 26px（${visual.spinnerSize}）`)

console.log("\n=== 4b. 全部接口都快的页面：遮罩不闪 ===")
/*
 * 上面第 2 步受「工作台同时打三个接口」干扰，只能证明「等满了延迟」。
 * 这里换一个页面（我的用量 /usage）再验一次，口径与第 2 步一致。
 *
 * ⚠️ 只注册一条路由，不要拆成两条通配 glob（一条匹配 me，另一条匹配
 * me/records）—— 前者的通配已经能匹配后者，于是同一个请求命中两个
 * 处理器，第二个继续时抛「Route is already handled!」把整个脚本带崩
 *（实测踩过）。
 *
 * 用正则匹配 me 后面跟斜杠或结尾，既覆盖 records / quota 等子路径，
 * 也不会误伤其它接口。
 */
await page.addInitScript(SAMPLER)
const USAGE_RE = /\/api\/usage\/me(?:\/|$)/
await page.route(USAGE_RE, async (route) => {
  await new Promise((r) => setTimeout(r, 50))
  await route.continue()
})
await page.goto(`${BASE}/usage`, { waitUntil: "domcontentloaded" })
await page.waitForTimeout(2600)
const solo = await page.evaluate(() => window.__maskSamples)
console.log(
  `     遮罩入 DOM：${solo.firstInDom === null ? "从未创建" : `${solo.firstInDom}ms`}｜可见帧 ${solo.mask.length} 个`
)

/*
 * ⚠️ 断言的是「等满延迟窗口」，不是「一帧都不出现」。
 *
 * 一开始这里写的是后者，于是**间歇性失败**：/usage 页面要打
 * me / records / quota 三个接口，虽然都被压到 50ms，但页面在
 * 本地 dev 下还有真实的代理往返与图表初始化，loading 的总时长
 * 仍可能超过 200ms 延迟窗口 —— 遮罩于是合理地出现了，
 * 而且因为整段 loading 比窗口长，每次出现的帧数还不一样
 * （一次 2 帧、一次 12 帧），典型的 flaky。
 *
 * 真正稳定、且与第 2 步口径一致的判据是：
 *   遮罩从进入 DOM 到首次可见，必须 ≥ 延迟窗口。
 * 这条在任何接口耗时下都不会抖，且等价于「快请求不会闪」：
 * 只要它成立，任何在窗口内结束的 loading 都不会有可见帧。
 */
if (solo.firstInDom !== null && solo.mask.length) {
  const gap = solo.mask[0].t - solo.firstInDom
  console.log(`     入 DOM → 可见 间隔 ${gap}ms`)
  check(gap >= 190, `遮罩先等满延迟窗口才可见（实测 ${gap}ms ≥ 190ms）`)
} else {
  console.log("     遮罩全程未可见 —— 该页所有 loading 都在窗口内结束，零闪白")
  check(true, "该页全程无可见遮罩（零闪白）")
}
await page.unroute(USAGE_RE)

console.log("\n=== 5. 路由进度条 ===")
/*
 * ⚠️ 每一项都要「等条件」，不能等固定时长。
 *
 * 线上首屏要 2~5 秒（下载 JS → 守卫 fetchMe → 拉数据），
 * 进度条在这整段时间里是**正常可见**的。
 * 曾经在这里只等 400ms 就断言「应已淡出」，结果在生产环境误报失败 ——
 * 而实测时间线完全正确：
 *   712ms w=66%  →  2448ms w=90%（上限）  →  3995ms w=100%（完成）
 *   → 4212ms opacity 0.49  → 4430ms opacity 0（淡出完毕）
 */
const readBar = () =>
  page.evaluate(() => {
    const el = document.getElementById("cg-route-progress")
    if (!el) return { exists: false }
    const cs = getComputedStyle(el)
    return {
      exists: true,
      position: cs.position,
      zIndex: Number(cs.zIndex),
      pointerEvents: cs.pointerEvents,
      opacity: Number(cs.opacity)
    }
  })

/** 轮询直到进度条淡出（或超时），返回最终状态 */
async function waitForBarIdle(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  let last = await readBar()
  while (Date.now() < deadline) {
    if (last.exists && last.opacity < 0.05) return last
    await page.waitForTimeout(200)
    last = await readBar()
  }
  return last
}

// 先确保处于「导航已收尾」的静置态，再验它的静态属性
const bar = await waitForBarIdle()
check(bar.exists, "进度条节点存在")
if (bar.exists) {
  check(bar.position === "fixed", `固定定位（${bar.position}）`)
  check(bar.pointerEvents === "none", "不拦截鼠标事件")
  check(bar.zIndex > 3000, `层级足够高（z-index=${bar.zIndex}）`)
  check(bar.opacity < 0.05, `静置时已淡出（opacity=${bar.opacity}）`)
}

// 触发一次真实导航，采样「导航期间是否亮起」
await page.addInitScript(SAMPLER)
await page.goto(`${BASE}/skills`, { waitUntil: "domcontentloaded" })
const barSeen = await page.evaluate(() => window.__maskSamples.bar.length)
console.log(`     导航期间进度条可见帧 ${barSeen} 个`)
check(barSeen > 0, "导航期间进度条可见（切页即时反馈）")

// 等它自己收尾（而不是估一个时长）
const barAfter = await waitForBarIdle()
if (barAfter.exists) {
  check(barAfter.opacity < 0.05, `导航结束后进度条已淡出（opacity=${barAfter.opacity}）`)
}

await browser.close()

console.log("\n" + "=".repeat(52))
console.log(
  failures === 0
    ? `遮罩与进度条校验全部通过（${checks} 项）`
    : `${failures}/${checks} 项未通过`
)
process.exit(failures === 0 ? 0 : 1)
