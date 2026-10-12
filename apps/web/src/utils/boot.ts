/**
 * 启动状态。
 *
 * 单独抽一个模块，是因为三个地方都要读同一份状态：
 *   - main.ts：等首轮路由就绪后再挂载、驱动超时计时
 *   - App.vue：未就绪时盖启动占位
 *   - BootSplash.vue：根据状态切换文案
 *
 * ── 为什么需要它 ──
 *
 * Vue 的 `app.mount("#app")` 会**清空**容器，把 index.html 里的启动占位
 * 一并销毁。如果此时路由守卫还卡在接口上（后端假死、网络中断），
 * `<router-view>` 渲染不出任何东西 —— 用户面对的就是纯空白（俗称黑屏）。
 *
 * 所以占位必须由 Vue 自己再盖一层，直到首轮路由真正就绪才撤下。
 */
import { ref } from "vue"

/** 启动阶段：正常加载 / 偏慢 / 失败 */
export type BootState = "loading" | "slow" | "error"

/** 首轮路由是否已就绪（就绪后撤下启动占位） */
export const routeReady = ref(false)

/** 当前启动阶段，用于切换占位文案 */
export const bootState = ref<BootState>("loading")

/** 启动开始的时间戳，用于展示已等待秒数 */
export const bootStartedAt = Date.now()

/** 首轮路由就绪：撤下占位 */
export function markRouteReady() {
  if (routeReady.value) return
  routeReady.value = true
  bootState.value = "loading"
}

/** 加载偏慢：给用户一句安抚，避免以为卡死 */
export function markBootSlow() {
  if (routeReady.value) return
  bootState.value = "slow"
}

/** 加载失败：给出可操作的重试入口 */
export function markBootError() {
  if (routeReady.value) return
  bootState.value = "error"
}

/** 重试：整页重载是最可靠的方式（内存里的半初始化状态一并清掉） */
export function reloadApp() {
  window.location.reload()
}

/** 已经等待的秒数（用于失败文案） */
export function waitedSeconds(): number {
  return Math.round((Date.now() - bootStartedAt) / 1000)
}
