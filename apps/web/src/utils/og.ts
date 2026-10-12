/**
 * 运行时同步 Open Graph 标签。
 *
 * ⚠️ 先说清楚它**不能**解决什么：
 *   微信、QQ 等分享爬虫不执行 JS，只在服务端返回的首屏 HTML 里读 OG 标签。
 *   因此各页的分享卡片靠的是构建期生成的静态 HTML（scripts/inject-og.mjs），
 *   这个模块对微信没有任何作用。
 *
 * 那它做什么：
 *   1. 给**会执行 JS 的**抓取方（Googlebot、Bingbot、部分社交平台）正确的标签
 *   2. 统一维护 document.title 与 meta description，避免两处逻辑各写一份
 *   3. 用户复制地址栏链接时，标签与实际页面一致（部分浏览器/插件会读取）
 *
 * 数据源与构建脚本共用 og.config.mjs，避免两边文案漂移。
 */
import { PAGES, ogFor, absoluteUrl } from "../../og.config.mjs"

/** 路径 → OG 数据，构建期与运行期共享同一份配置 */
const OG_BY_PATH = new Map(PAGES.map((p) => [p.path, ogFor(p)]))

/** 设置或更新一个 meta 标签 */
function upsertMeta(attr: "name" | "property", key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement("meta")
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute("content", content)
}

/** 设置 canonical 链接 */
function upsertCanonical(url: string) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!el) {
    el = document.createElement("link")
    el.setAttribute("rel", "canonical")
    document.head.appendChild(el)
  }
  el.setAttribute("href", url)
}

/**
 * 按当前路由同步 head 元信息。
 *
 * @param path 路由路径（不含 query），如 "/chat"
 */
export function syncOgTags(path: string) {
  /*
   * 聊天页有可选参数（/chat/:id），注册表里只登记了 /chat，
   * 因此找不到精确匹配时回退到「去掉末段」的父路径。
   */
  const og =
    OG_BY_PATH.get(path) ??
    OG_BY_PATH.get(path.replace(/\/[^/]+$/, "")) ??
    null

  if (!og) {
    /*
     * 未登记的路由（后台页等）：
     * 只更新 canonical，不动 OG —— 保留根 index.html 的站点级兜底标签，
     * 总比留下一张写着上一个页面的错误卡片要好。
     */
    upsertCanonical(absoluteUrl(path))
    return
  }

  document.title = og.title
  upsertMeta("name", "description", og.description)

  upsertMeta("property", "og:type", og.type)
  upsertMeta("property", "og:site_name", og.siteName)
  upsertMeta("property", "og:title", og.title)
  upsertMeta("property", "og:description", og.description)
  upsertMeta("property", "og:url", og.url)
  upsertMeta("property", "og:image", og.image)

  upsertMeta("name", "twitter:card", "summary_large_image")
  upsertMeta("name", "twitter:title", og.title)
  upsertMeta("name", "twitter:description", og.description)
  upsertMeta("name", "twitter:image", og.image)

  upsertCanonical(og.url)
}
