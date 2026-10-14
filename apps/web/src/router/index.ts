import { createRouter, createWebHistory } from "vue-router"
import { routes, type FeatureKey } from "./routes"
import { useAuthStore } from "@/stores/auth"
import { tokenStore } from "@/api/client"
import { installBackGuardBeforeRouter, observeElementPlusOverlays } from "@/utils/back-navigation"
import { syncOgTags } from "@/utils/og"
import { startProgress, doneProgress, failProgress } from "@/utils/route-progress"
import { initPrefetch, prefetchByPath, prefetchWhenIdle } from "@/utils/prefetch"

/*
 * 移动端后退机制：浏览器后退时优先关闭浮层（抽屉/弹窗），而不是直接回退路由。
 *
 * ⚠️ 顺序很关键：必须在 createRouter **之前**注册 popstate 监听。
 *
 * DOM 事件监听器按注册顺序执行。vue-router 在自己的 popstate 处理器里
 * 完成导航，导航又会触发组件里的 `watch(route)`（AppLayoutNext 借此收起抽屉）。
 * 如果我们的监听注册在后面，轮到我们时抽屉已经被路由变化关掉了，
 * 于是判断「没有打开的浮层」而放行 —— 用户就被带离了原页面。
 */
const bindBackGuard = installBackGuardBeforeRouter()

// 建立「路径 → 组件加载函数」索引，供菜单 hover 时预取（见 utils/prefetch.ts）
initPrefetch(routes)

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 })
})

// 绑定 router 实例，开始记录当前位置
bindBackGuard(router)

// 自动接管 Element Plus 的弹窗/抽屉/确认框（挂在 body 上，需 DOM 就绪后启动）
if (typeof window !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", observeElementPlusOverlays, { once: true })
  } else {
    observeElementPlusOverlays()
  }
}

const WHITE_LIST = ["/login", "/register", "/403"]

/*
 * 首次导航要等公开设置与用户信息两个接口，这里先亮出进度条。
 * 放在 WHITE_LIST 之后、守卫之前：无论走哪条分支，用户点下链接的
 * 那一刻就能看到反馈（详见 utils/route-progress.ts）。
 */
router.beforeEach(() => {
  startProgress()
  return true
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  const isPublic = Boolean(to.meta.public) || WHITE_LIST.includes(to.path)

  // 首次进入：并行加载公开设置与当前用户
  // Download the public page while its display policy request is in flight.
  if (isPublic) prefetchByPath(to.path)
  const needsIdentity = !isPublic || to.path === '/login' || to.path === '/register'
  const identity = needsIdentity && tokenStore.access && !auth.user
    ? auth.fetchMe().then(() => null, error => error)
    : Promise.resolve(null)
  if (!auth.settings) {
    if(to.meta.feature)await auth.loadPublicSettings()
    else void auth.loadPublicSettings()
  }

  if (isPublic) {
    // 已登录用户访问登录页时按角色进入各自的落地页
    if ((to.path === "/login" || to.path === "/register") && tokenStore.access) {
      if (!auth.user) {
        try {
          const error = await identity
          if (error) throw error
        } catch {
          return true
        }
      }
      if (auth.user) return { path: auth.homePath }
    }
    return true
  }

  if (!tokenStore.access) {
    return { path: "/login", query: { redirect: to.fullPath } }
  }

  if (!auth.user) {
    try {
      const error = await identity
      if (error) throw error
      if (!auth.user) return { path: "/login", query: { redirect: to.fullPath } }
    } catch (error) {
      if (tokenStore.access) throw error
      return { path: "/login", query: { redirect: to.fullPath } }
    }
  }

  /*
   * ══ 学生只能看到聊天前端 ══
   *
   * 判定放在 fetchMe 之后：`auth.can()` 依赖 permissions，
   * 而 permissions 是随用户信息一起到的，提前判断只会全部落空。
   *
   * 为什么在路由层强制而不是只藏菜单：
   *   菜单不渲染只是「看不见」，手输 URL、点历史记录、扫描分享链接
   *   都能绕过。学生端的定位是「打开就是聊天」，混进工作台或后台
   *   只会让人困惑（那些页面的数据对他们也多半是空的）。
   *
   * 注意重定向目标是 /student 而不是 /chat：
   *   /chat 位于 AppLayoutNext 之内，带侧边栏与顶栏，会重新把整套
   *   管理端导航暴露出来。学生端有自己的独立外壳。
   */
  if (auth.isStudent && !to.meta.studentAllowed) {
    return { path: "/student", replace: true }
  }

  /*
   * ══ 反向：教师不要进学生端，但管理员保留预览 ══
   *
   * 上面那条只把学生挡在后台外，并没有挡住「教师手输 /student」——
   * 实测教师直接访问 /student 会安安稳稳落在学生聊天端里。
   *
   * 学生端是给学生用的完整外壳（没有后台导航、侧栏只有自己的会话），
   * 教师进去会卡在一个「什么都审不了」的界面里，还以为是系统坏了。
   * 所以按需求把教师挡出去。
   *
   * ⚠️ 判据是 student:preview 这个权限码，**不是**「非学生一律挡」：
   *    管理员需要保留预览能力（学生反馈界面问题时要能自己看一眼），
   *    这是早先就刻意允许的行为，verify-student-ui 里有一条断言守着它。
   *    而教师与管理员都有 dashboard:read，光凭它分不出两者，
   *    因此立一个明确的权限码来表达「谁能预览学生端」。
   */
  if (!auth.isStudent && to.meta.studentOnly && !auth.can("student:preview")) {
    return { path: auth.homePath, replace: true }
  }

  // 访问根路径时按角色分流：普通用户直达聊天，管理员进工作台
  if (to.path === "/") {
    return { path: auth.homePath }
  }

  const required = to.meta.permission as string | undefined
  if (required && !auth.can(required)) {
    return { path: "/403" }
  }

  /*
   * 可选功能开关：未开启的功能，路由也进不去。
   *
   * 与菜单隐藏是两层，缺一不可：藏菜单只是「看不见」，
   * 手输 URL、点历史记录、旧书签都还能进来，然后页面里的请求
   * 会拿到 403，用户看到的是一个坏掉的白页。
   * 这里直接送回首页，与后端的功能开关校验形成前后两道闸。
   */
  const feature = to.meta.feature as FeatureKey | undefined
  if (feature && !auth.featureOn(feature)) {
    return { path: auth.homePath, replace: true }
  }

  prefetchByPath(to.path)
  return true
})

router.afterEach((to) => {
  // 导航完成：进度条冲到 100% 并淡出
  doneProgress()

  /*
   * 同步 head 元信息（标题 / description / OG / canonical）。
   *
   * 各页的**分享卡片**由构建期生成的静态 HTML 决定（微信不执行 JS，
   * 只看首屏 HTML）；这里负责会执行 JS 的抓取方，
   * 以及保持标签与实际页面一致。详见 utils/og.ts。
   */
  syncOgTags(to.path)

  /*
   * 首屏就绪后，空闲时预取最常去的页面。
   *
   * 放在第一次 afterEach 且只做一次：此刻首屏的 JS 已经跑完，
   * 预取不会与用户正在等的资源抢带宽（见 utils/prefetch.ts）。
   */
  if (!idlePrefetched && !to.meta.public && tokenStore.access) {
    idlePrefetched = true
    prefetchWhenIdle(to.path.startsWith('/student') ? ['/profile'] : ['/chat'])
  }
})

/** 空闲预取只做一次 */
let idlePrefetched = false

/*
 * 导航失败（守卫抛错、动态 import 失败）：收掉进度条。
 *
 * 不处理的话线会停在 90% 一直挂着 —— 那比没有进度条更糟，
 * 因为它明确地暗示「还在加载」。
 */
router.onError(() => {
  failProgress()
})

export default router
