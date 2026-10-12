/**
 * 移动端后退机制。
 *
 * 问题：手机用户按返回键（或侧滑返回）时的直觉是「关掉眼前这层浮层」，
 * 但 SPA 默认会直接回退路由 —— 抽屉还开着人就跳到上一页了。
 *
 * ══ 最终方案 ══
 *
 * 在 **popstate 事件上抢在 vue-router 之前**判断：若此刻有打开的浮层，
 * 就关掉它并把路由改回原页；否则放行，让浏览器正常后退。
 *
 * ── 两个决定成败的关键点（都由实测得出）──
 *
 *   1. **监听必须在 vue-router 之前注册**
 *      DOM 事件监听器按注册顺序执行。vue-router 会在自己的 popstate
 *      处理器里完成导航，导航又触发组件里的 `watch(route)`（比如
 *      AppLayoutNext 收起抽屉）。如果我们的监听注册在后面，等它执行时
 *      抽屉已被路由变化关掉了，`hasOpenLayer()` 自然是 false
 *      —— 实测日志：`popstate 触发 {layers: Array(3), loc: /dashboard}`
 *      紧接 `无打开的浮层，放行`。
 *      因此本模块必须在 createRouter 之前安装监听。
 *
 *   2. **改回路由要延后一个宏任务**
 *      同步调用 router.replace(原页) 时，vue-router 尚未处理这次
 *      popstate，会把它当成「重复导航」静默忽略，随后自己跳到目标页。
 *      放到 setTimeout(0) 后，vue-router 已就位，replace 才真正生效。
 *
 * ── 另外两条走过的弯路（同样记录以免重蹈覆辙）──
 *
 *   - 自己 pushState 塞哨兵记录：打乱 vue-router 对 history.state 的记账
 *     （position/back/forward），它 popstate 时会 replaceState 自我修复，
 *     结果每开关一次浮层历史就多一条（实测 5→6→7→8）。
 *
 *   - 路由守卫 `return false`：对 popstate 导航无效，vue-router 照常完成切换。
 *
 * ── 浮层的登记方式 ──
 *
 * 登记时传 `isOpen()` 而非「打开时注册 / 关闭时注销」：后者需要在多个
 * 状态变更点维护，极易漏掉（实测按返回键那一刻栈恰好为空）。
 * 实时求值则不存在时序竞争。
 */
import type { Router } from "vue-router"

/** 一个可被返回键关闭的浮层 */
export interface ClosableLayer {
  /** 此刻是否处于打开状态（popstate 时实时求值） */
  isOpen: () => boolean
  /** 关闭它；需幂等 */
  close: () => void
  /** 便于排查问题的名字 */
  name?: string
}

const layers: ClosableLayer[] = []

function safeIsOpen(layer: ClosableLayer): boolean {
  try {
    return layer.isOpen()
  } catch {
    // 组件已卸载时求值可能抛错，视为未打开
    return false
  }
}

/**
 * 登记一个可关闭浮层。
 *
 * 只需在组件挂载时登记一次，打开状态由 `isOpen` 每次现场求值。
 *
 * @returns 注销函数；组件卸载时调用
 */
export function registerClosable(layer: ClosableLayer): () => void {
  layers.push(layer)

  return () => {
    const index = layers.lastIndexOf(layer)
    if (index >= 0) layers.splice(index, 1)
  }
}

/** 当前是否有「已打开」的浮层 */
export function hasOpenLayer(): boolean {
  return layers.some((l) => safeIsOpen(l))
}

/** popstate 时调用：关闭最上层打开的浮层（后进先出） */
export function closeTopLayer(): boolean {
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i]
    if (!safeIsOpen(layer)) continue
    try {
      layer.close()
    } catch {
      /* 关闭失败不该阻断后续流程 */
    }
    return true
  }
  return false
}

/** 仅用于调试 / 测试 */
export function layerSnapshot() {
  return layers.map((l) => ({ name: l.name, open: safeIsOpen(l) }))
}

/** 仅用于调试 / 测试 */
export function resetLayers() {
  layers.length = 0
}

/** 需要「改回原路由」时用；由 installBackGuard 注入 */
let routerRef: Router | null = null

/** 最近一次成功导航的地址，作为「应该停留的位置」 */
let lastFullPath = ""

/**
 * 安装 popstate 拦截。
 *
 * ⚠️ 必须在 createRouter **之前**调用，否则监听注册晚于 vue-router，
 * 等我们执行时浮层已被路由变化关掉（详见文件头注释第 1 点）。
 *
 * @returns 绑定 router 实例的函数，在 router 创建后立即调用
 */
export function installBackGuardBeforeRouter() {
  if (typeof window === "undefined") return () => undefined

  window.addEventListener("popstate", () => {
    if (!routerRef) return
    // 没有打开的浮层：正常的浏览器后退，放行
    if (!hasOpenLayer()) return

    closeTopLayer()

    const target = lastFullPath || routerRef.currentRoute.value.fullPath
    if (!target) return

    /*
     * 延后一个宏任务再改路由：此刻 vue-router 还没处理这次 popstate，
     * 同步 replace 会被它当成重复导航忽略（详见文件头注释第 2 点）。
     */
    const r = routerRef
    setTimeout(() => {
      void r.replace(target).catch(() => undefined)
    }, 0)
  })

  /** 在 router 创建后调用，完成绑定并开始记录当前位置 */
  return (router: Router) => {
    routerRef = router
    lastFullPath = router.currentRoute.value.fullPath
    router.afterEach((to) => {
      lastFullPath = to.fullPath
    })
  }
}

/**
 * 自动接管 Element Plus 的弹窗 / 抽屉 / 确认框。
 *
 * 用 MutationObserver 跟踪 `.el-overlay`，为每个浮层登记「是否可见」；
 * 元素被移除后 isConnected 为 false，登记自动失效。
 */
export function observeElementPlusOverlays() {
  if (typeof window === "undefined" || typeof MutationObserver === "undefined") return

  const tracked = new WeakMap<Element, () => void>()

  const isVisible = (el: Element) => {
    const html = el as HTMLElement
    if (!html.isConnected) return false
    if (html.style.display === "none") return false
    if (html.classList.contains("is-hidden")) return false
    return html.getClientRects().length > 0
  }

  const scan = () => {
    // 只接管模态浮层；下拉菜单 / 气泡（el-popper）不算，避免误伤
    const overlays = Array.from(
      document.querySelectorAll<HTMLElement>(".el-overlay, .el-overlay-message-box")
    )

    for (const el of overlays) {
      if (tracked.has(el)) continue

      tracked.set(
        el,
        registerClosable({
          name: "el-overlay",
          isOpen: () => isVisible(el),
          close: () => {
            // Esc 是 Element Plus 约定的关闭键，dialog / drawer / message-box 都响应
            const target = (document.activeElement as HTMLElement) || document.body
            target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
          }
        })
      )
    }
  }

  const observer = new MutationObserver(() => scan())
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style", "class"]
  })

  scan()
}
