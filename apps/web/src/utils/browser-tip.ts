/**
 * 「浏览器功能提示」的显示判定。
 *
 * 单独放一个模块，是因为 <script setup> 不允许具名导出，
 * 而多个页面（浏览器操控台、校园导览）都要复用同一套判断。
 */

const DISMISS_KEY = "cagent.browser-tip-dismissed"

/** 用户是否点过「不再提示」 */
export function isBrowserTipDismissed(): boolean {
  if (typeof window === "undefined") return false
  return window.localStorage.getItem(DISMISS_KEY) === "1"
}

export function dismissBrowserTip() {
  if (typeof window === "undefined") return
  window.localStorage.setItem(DISMISS_KEY, "1")
}

/** 用户手动恢复提示（设置页可用） */
export function resetBrowserTip() {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(DISMISS_KEY)
}

/**
 * 是否是「移动设备」。
 *
 * 用「触摸优先指针 + 窄屏」双重判断，而不是只看宽度：
 * 桌面浏览器把窗口拉窄时宽度也很小，但那些用户完全可以安装扩展，
 * 误判成移动端会把他们挡在功能之外。
 */
export function isMobileDevice(): boolean {
  if (typeof window === "undefined") return false
  const coarse = window.matchMedia("(hover: none) and (pointer: coarse)").matches
  const narrow = window.matchMedia("(max-width: 900px)").matches
  return coarse && narrow
}
