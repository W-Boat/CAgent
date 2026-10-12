/**
 * 顶部路由进度条。
 *
 * ── 为什么需要它 ──
 *
 * 路由守卫里可能要等接口（`fetchMe`、公开设置），页面组件本身也是动态
 * import，慢网络下从点击菜单到内容出现能有半秒以上的空档。
 * 这段时间里界面上**什么都不会变** —— 用户的第一反应是「没点中」，
 * 于是再点一次。
 *
 * 进度条用一条 2px 的线把这段空档标出来：点击即有反馈，内容到位即收尾。
 * 它不解决加载速度，解决的是「有没有反应」。
 *
 * ── 为什么不用 el-loading 全屏遮罩 ──
 *
 * 遮罩会盖住整个界面，属于「打断式」反馈；而切页时用户往往还想看清
 * 自己在哪、要不要改主意。顶部进度条是「旁路式」的，不挡任何操作。
 * 这正好也呼应了本次另一项改动：把遮罩从「立刻盖上来」改成「慢了才出现」。
 *
 * ── 实现要点 ──
 *
 *   - 直接操作 DOM，不经过 Vue 响应式：导航期间 Vue 可能正在忙，
 *     而这条线必须在点击的同一帧就动起来。
 *   - 进度是「渐近逼近」而非匀速：真实加载无法预知完成时间，
 *     匀速走到 90% 再卡住会像死机；指数逼近则永远在动、又不会走满。
 *   - 单例：并发导航（快速连点菜单）只维护一条线。
 */

/** 进度条容器的 DOM id */
const BAR_ID = "cg-route-progress"

/** 逼近上限：真实完成前最多走到这里，留出收尾空间 */
const CEILING = 0.9

/** 每帧逼近系数：越大越快，0.08 约 0.4 秒走完前 80% */
const APPROACH = 0.08

let el: HTMLDivElement | null = null
let value = 0
let raf = 0
let hideTimer = 0
let startedAt = 0

/** 首次使用时创建节点；之后复用 */
function ensureEl(): HTMLDivElement | null {
  if (typeof document === "undefined") return null
  if (el?.isConnected) return el

  el = document.createElement("div")
  el.id = BAR_ID

  /*
   * 样式内联而不写进 index.css。
   *
   * 这条线必须在「CSS 可能还没加载完」的阶段也能正确显示 ——
   * 它出现在首轮导航期间，而那时按需引入的样式块未必就位。
   * 内联样式没有任何加载依赖，最可靠。
   */
  const s = el.style
  s.position = "fixed"
  s.top = "0"
  s.left = "0"
  s.height = "2px"
  s.width = "0%"
  s.zIndex = "5000"
  s.pointerEvents = "none"
  s.opacity = "0"
  s.transform = "translateZ(0)"
  s.willChange = "width, opacity"
  s.borderRadius = "0 2px 2px 0"
  s.background = "var(--cg-brand, #2563eb)"
  s.boxShadow = "0 0 8px var(--cg-brand, #2563eb), 0 0 3px var(--cg-brand, #2563eb)"
  s.transition = "opacity 0.24s ease-out"

  document.body.appendChild(el)
  return el
}

/** 每帧推进一点，指数逼近 CEILING */
function tick() {
  if (!el) return
  // 距上限越远走得越快，永远在动但不会先走满
  value += (CEILING - value) * APPROACH
  el.style.width = `${(value * 100).toFixed(2)}%`

  /*
   * 慢请求保护：超过 8 秒仍未完成就停在这条线上不再推进。
   * 继续逼近 90% 会给人「马上就好」的错觉，反而更焦虑。
   */
  if (Date.now() - startedAt > 8000) {
    raf = 0
    return
  }
  raf = requestAnimationFrame(tick)
}

/** 开始：重置并淡入 */
export function startProgress() {
  const node = ensureEl()
  if (!node) return

  window.clearTimeout(hideTimer)
  startedAt = Date.now()

  /*
   * 已在推进中就不重置进度。
   *
   * 快速连点菜单会连续触发 beforeEach，每次都重置会让线反复回跳，
   * 看起来像在闪烁。保持单调递增更接近真实观感。
   */
  if (raf) return

  value = 0.08
  node.style.transition = "opacity 0.18s ease-out"
  node.style.opacity = "1"
  node.style.width = "8%"
  raf = requestAnimationFrame(tick)
}

/** 完成：冲到 100% 后淡出 */
export function doneProgress() {
  if (!el) return

  if (raf) {
    cancelAnimationFrame(raf)
    raf = 0
  }

  value = 1
  el.style.transition = "width 0.18s ease-out, opacity 0.24s ease-out 0.1s"
  el.style.width = "100%"

  window.clearTimeout(hideTimer)
  hideTimer = window.setTimeout(() => {
    if (!el) return
    el.style.opacity = "0"
    el.style.width = "0%"
    value = 0
  }, 260)
}

/**
 * 失败/中止：直接收掉，不留一条走到 90% 的线挂在顶上。
 * 错误提示由各自的请求逻辑负责，进度条只表达「导航结束了」。
 */
export function failProgress() {
  if (!el) return
  if (raf) {
    cancelAnimationFrame(raf)
    raf = 0
  }
  window.clearTimeout(hideTimer)
  el.style.transition = "opacity 0.2s ease-out"
  el.style.opacity = "0"
  window.setTimeout(() => {
    if (el) el.style.width = "0%"
  }, 220)
  value = 0
}
