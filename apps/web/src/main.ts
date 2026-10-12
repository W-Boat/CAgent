import {installCampusLinkTracking} from "./utils/campus-activity"
import { createApp, defineAsyncComponent, type Directive } from "vue"
import { createPinia } from "pinia"
import "element-plus/theme-chalk/dark/css-vars.css"
import "highlight.js/styles/github-dark.css"
import "./styles/index.css"
/*
 * 学生端中国风样式。
 *
 * 单独一个文件而不是并进 index.css：它整体挂在 `.student-app` 作用域下
 * （见文件头的说明），与管理端互不干扰，分开维护更清楚。
 * 这里是全局 import，Vite 会把它打进同一个 CSS 产物 —— 但未使用
 * 选择器的规则在压缩后几乎不占体积，而按路由拆 CSS 反而会让
 * 学生端首屏多一次请求。
 */
import "./styles/student.css"
/*
 * Next 界面设计系统（唯一界面：管理员端 + 学生端）。
 * 与 student.css 同理走全局产物；令牌全部挂在 .nx-root 作用域下。
 */
import "./styles/next.css"

import App from "./App.vue"
import router from "./router"
import { ICON_NAMES } from "./icon-names"
import { useAuthStore } from "./stores/auth"
import { useThemeStore } from "./stores/theme"
import { useUiStore } from "./stores/ui"
import { setUnauthorizedHandler, tokenStore } from "./api/client"
import { permissionDirective } from "./directives/permission"
import { markBootError, markBootSlow, markRouteReady } from "./utils/boot"

/*
 * Element Plus 组件与样式由 unplugin-vue-components 按需注入（见 vite.config.ts），
 * 这里不再 app.use(ElementPlus) —— 全量引入会让首屏多下载 1MB 左右。
 *
 * 图标走 src/icons.ts 的显式登记表，而不是 `import * as Icons`：
 * 后者会把全部 293 个图标打进首屏包，而项目只用到 77 个。
 * 线上出口带宽实测约 1.49 MB/s，每省下 100KB gzip 就少约 0.7 秒加载。
 *
 * 之所以需要全局注册（而不是各组件按需 import），是因为菜单/工具的图标名
 * 是运行时字符串（`<component :is="item.icon" />`），打包器无法静态分析。
 */
const app = createApp(App)
const pinia = createPinia()

// 主题要在挂载前应用，避免暗色用户首帧闪白
useThemeStore(pinia).init()

// 强调色要在挂载前落到 <html>，否则首帧用默认靛蓝、设置过其他色的用户会看到闪变
useUiStore(pinia).applyAccent()

/*
 * 清掉 index.html 用于「启动前防闪白」的 dark-boot 标记。
 *
 * 那个类只在 CSS 尚未加载时起作用（让 <body> 直接是深色）；
 * 正式样式到位后由 theme store 接管，类留着会与 .dark 叠加，
 * 造成后续主题切换时样式判断出现两个真值来源。
 */
document.documentElement.classList.remove("dark-boot")

app.use(pinia)
app.use(router)

for (const name of ICON_NAMES) {
  app.component(name, defineAsyncComponent(() => import('./icons').then(module => module.ICONS[name])))
}

// v-permission="'user:create'" 或 v-permission="['a','b']"
app.directive("permission", permissionDirective as Directive)

// 令牌彻底失效时统一跳转登录页
setUnauthorizedHandler(() => {
  const auth = useAuthStore(pinia)
  auth.reset()
  const current = router.currentRoute.value
  if (current.path !== "/login") {
    router.replace({ path: "/login", query: { redirect: current.fullPath } })
  }
})

// 启动时若已有令牌，先拉取一次用户信息，避免路由守卫重复请求
if (tokenStore.access) {
  void useAuthStore(pinia).fetchMe().catch(() => undefined)
}

app.config.errorHandler = (err) => {
  // eslint-disable-next-line no-console
  console.error("[CAgent]", err)
  // 渲染期异常也可能导致白屏，给出重试入口而不是让用户干等
  markBootError()
}

/*
 * 首轮路由就绪后才撤下启动占位。
 *
 * 只用 router.isReady()，不监听 afterEach —— 后者会在每次跳转时触发，
 * 而占位只关心「第一次能否渲染出内容」。
 */
void router
  .isReady()
  .then(() => {
    markRouteReady()
  })
  .catch((err) => {
    // 首轮导航失败（接口不通、动态 import 失败等）
    console.error("[CAgent] 首轮路由失败", err)
    markBootError()
  })

/*
 * 慢加载安抚：5 秒还没就绪就换文案，避免用户以为卡死而直接关掉。
 * 20 秒仍未就绪则给出重试入口（后端假死时 axios 超时是 60 秒，等不起）。
 */
window.setTimeout(markBootSlow, 5000)
window.setTimeout(markBootError, 20000)

app.mount("#app")

/*
 * 通知 index.html 的启动兜底脚本：Vue 已接管，停掉它的超时计时器。
 * 不通知的话，18 秒后那段脚本会去改已经不存在的占位节点（无害，但没必要）。
 */
;(window as unknown as { __cagentBooted?: boolean }).__cagentBooted = true
window.dispatchEvent(new Event("cagent:booted"))

installCampusLinkTracking()
