/**
 * 路由分包预取。
 *
 * ── 问题 ──
 *
 * 所有页面都是 `() => import(...)` 动态导入。它的好处是首屏不必为
 * 用不到的页面买单，代价是**首次进入某个页面时才开始下载它的 chunk**：
 * 点击 → 空白 → chunk 到位 → 渲染。线上实测单个 chunk TTFB 约 230ms，
 * 叠加下载时间，冷切换能明显看到停顿。
 *
 * 而这件事**本来是可以提前做的**：用户鼠标移到「技能中心」上、
 * 或者停在某个菜单项上超过一瞬，意图已经相当明确了。
 *
 * ── 两个触发时机 ──
 *
 *   1. **hover / focus 预取**：鼠标悬停或键盘聚焦菜单项时立刻拉取。
 *      从悬停到真正点击通常有 100~300ms，正好够发起请求；
 *      即使用户没点，代价也只是一个几十 KB 的 chunk（带 hash，可长期缓存）。
 *
 *   2. **空闲预取**：首屏渲染完成、浏览器空闲时，预取最常去的几个页面。
 *      用 requestIdleCallback 让路给首屏，绝不影响当前页面的加载。
 *
 * ── 为什么不用 `<link rel="prefetch">` ──
 *
 * 可以，但拿不到「加载完成」的回调，也无法复用 Rollup 生成的 import 关系
 * （手动拼 URL 容易在改 chunk 命名策略后静默失效）。直接调 loader 函数
 * 走的是同一套 import 机制，且 Vite/Rollup 会自动去重 ——
 * 预取过的模块，后续真正 `import()` 时直接命中缓存。
 */
import type { RouteRecordRaw } from "vue-router"

/** 已发起预取的组件名/路径，避免重复调用 */
const prefetched = new Set<string>()

/**
 * 取路由的懒加载函数。
 *
 * 只有函数形式的 component 才是动态 import；同步组件没有预取的意义。
 */
function loaderOf(route: RouteRecordRaw): { key: string; load: () => Promise<unknown> } | null {
  const comp = route.component as unknown
  if (typeof comp !== "function") return null
  const key = (typeof route.name === "string" && route.name) || route.path
  return { key, load: comp as () => Promise<unknown> }
}

/** 发起一次预取（幂等；失败静默，真正导航时会再报错） */
function prefetch(route: RouteRecordRaw) {
  const hit = loaderOf(route)
  if (!hit || prefetched.has(hit.key)) return
  prefetched.add(hit.key)
  /*
   * 失败不重试也不上报：预取是「锦上添花」，网络抖动时失败很正常，
   * 真正导航时该报的错会照常报。这里吞掉，避免控制台出现
   * 用户看不懂、也不影响使用的红字。
   */
  void hit.load().catch(() => prefetched.delete(hit.key))
}

/** 按 path 建索引，供 hover 时 O(1) 查找 */
const byPath = new Map<string, RouteRecordRaw>()

function index(routes: RouteRecordRaw[]) {
  for (const r of routes) {
    byPath.set(r.path.startsWith("/") ? r.path : `/${r.path}`, r)
    if (r.children?.length) index(r.children)
  }
}

let indexed = false

/**
 * 预取指定路径对应的页面组件。
 *
 * @param path 路由路径，如 "/skills"、"admin/users"、"chat"
 */
export function prefetchByPath(path: string) {
  const clean = path.split("?")[0].split("#")[0]
  const route = byPath.get(clean) ?? byPath.get(`/${clean.replace(/^\//, "")}`)
  if (route) prefetch(route)
}

/**
 * 空闲预取一批路径。
 *
 * 用 requestIdleCallback 而不是立刻执行：首屏自己的 JS 还在解析执行，
 * 此刻抢带宽会拖慢用户真正在等的首屏。浏览器空闲才动手；
 * 不支持该 API 的浏览器（Safari 较老版本）退回一个较长的 setTimeout。
 *
 * @param paths 路径列表，建议按「用户最可能去」排序
 */
export function prefetchWhenIdle(paths: string[]) {
  const connection=(navigator as Navigator & {connection?:{saveData?:boolean;effectiveType?:string}}).connection
  if(connection?.saveData || /^(slow-)?2g$/.test(connection?.effectiveType || ''))return
  const run = () => {
    // 逐个排队，避免同一帧里并发发起一堆请求
    paths.forEach((p, i) => {
      window.setTimeout(() => prefetchByPath(p), i * 120)
    })
  }

  // CPU idle can occur while first-screen requests are still downloading.
  window.setTimeout(()=>{
    if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(run,{timeout:3000})
    else run()
  },5000)
}

/**
 * 初始化预取索引。
 *
 * @param routes 路由表
 */
export function initPrefetch(routes: RouteRecordRaw[]) {
  if (indexed) return
  indexed = true
  index(routes)
}
