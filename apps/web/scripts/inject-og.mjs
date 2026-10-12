/**
 * 构建后为每个路由生成带 OG 标签的独立 HTML。
 *
 * ── 为什么必须这么做 ──
 *
 * 这是纯 SPA：所有路由经 nginx 的 `try_files ... /index.html` 落到同一个
 * index.html。而**微信爬虫不执行 JS** —— 实测 `curl /login` 只拿到根
 * index.html 的 <title>，Vue 运行时注入的标签它永远看不到。
 *
 * 所以「在模板里动态注入」对微信无效。唯一可行的做法是构建时把每个路由
 * 预渲染成一份独立 HTML，内含该页的 OG 标签，并保留 SPA 挂载点。
 *
 * 生成结果形如：
 *   dist/index.html          ← 首页
 *   dist/login/index.html    ← /login
 *   dist/chat/index.html     ← /chat
 * nginx 的 `try_files $uri $uri/ /index.html` 会优先命中目录里的 index.html，
 * 未生成的路径（如后台页）继续回落到根 index.html，行为不受影响。
 *
 * ── 实现取舍 ──
 *
 * 正则替换而非引入 HTML 解析库：目标片段是构建产物里的固定结构，
 * 用正则精确、无依赖、且改错会立刻被校验脚本发现（verify-og.mjs）。
 *
 * 用法：node scripts/inject-og.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { PAGES, ogFor, LIMITS } from "../og.config.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = join(here, "..")
const distDir = join(webRoot, "dist")
const templatePath = join(distDir, "index.html")

if (!existsSync(templatePath)) {
  console.error(`找不到构建产物 ${templatePath}，请先执行 vite build。`)
  process.exit(1)
}

const template = readFileSync(templatePath, "utf8")

/**
 * 替换 HTML 里的 head 元信息。
 *
 * 每项都用「先找旧标签、找不到就插入」的策略：
 * 构建产物里的标签可能被压缩器改写属性顺序，硬编码整段替换很脆。
 */
function setMeta(html, { attr, key, content }) {
  const esc = (s) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")

  // property="og:title" 或 name="twitter:title"
  const re = new RegExp(
    `<meta\\s+${attr}=["']${key.replace(/[:]/g, "\\:")}["'][^>]*>`,
    "i"
  )
  const tag = `<meta ${attr}="${key}" content="${esc(content)}" />`

  if (re.test(html)) return html.replace(re, tag)
  // 兜底：插到 </head> 前
  return html.replace(/<\/head>/i, `  ${tag}\n  </head>`)
}

function setTitle(html, title) {
  const esc = title
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
  if (/<title>[\s\S]*?<\/title>/i.test(html)) {
    return html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc}</title>`)
  }
  return html.replace(/<\/head>/i, `  <title>${esc}</title>\n  </head>`)
}

/**
 * 生成 canonical 链接。
 * 同一份内容有多个路径时（如 /login 与 /login/），canonical 能避免
 * 搜索引擎与微信把它们当成两个页面。
 */
function setCanonical(html, url) {
  const tag = `<link rel="canonical" href="${url}" />`
  if (/<link\s+rel=["']canonical["'][^>]*>/i.test(html)) {
    return html.replace(/<link\s+rel=["']canonical["'][^>]*>/i, tag)
  }
  return html.replace(/<\/head>/i, `  ${tag}\n  </head>`)
}

/**
 * 把 OG 数据写进一份 HTML。
 *
 * 同时输出 og:* 与 twitter:*：
 * 微信优先读 og:*，但部分分享场景（以及 QQ、微博）会读 twitter:*，
 * 两套都写成本极低，兼容性最好。
 */
function applyOg(html, og) {
  let out = html
  out = setTitle(out, og.title)
  out = setMeta(out, { attr: "name", key: "description", content: og.description })

  out = setMeta(out, { attr: "property", key: "og:type", content: og.type })
  out = setMeta(out, { attr: "property", key: "og:site_name", content: og.siteName })
  out = setMeta(out, { attr: "property", key: "og:title", content: og.title })
  out = setMeta(out, { attr: "property", key: "og:description", content: og.description })
  out = setMeta(out, { attr: "property", key: "og:url", content: og.url })
  out = setMeta(out, { attr: "property", key: "og:image", content: og.image })
  out = setMeta(out, { attr: "property", key: "og:image:width", content: "478" })
  out = setMeta(out, { attr: "property", key: "og:image:height", content: "478" })
  out = setMeta(out, { attr: "property", key: "og:image:type", content: "image/png" })

  out = setMeta(out, { attr: "name", key: "twitter:card", content: "summary_large_image" })
  out = setMeta(out, { attr: "name", key: "twitter:title", content: og.title })
  out = setMeta(out, { attr: "name", key: "twitter:description", content: og.description })
  out = setMeta(out, { attr: "name", key: "twitter:image", content: og.image })

  out = setCanonical(out, og.url)
  return out
}

console.log(`模板: ${templatePath}`)
console.log(`站点: ${PAGES.length} 个页面待生成\n`)

let written = 0
const report = []

for (const page of PAGES) {
  const og = ogFor(page)

  // 标题与描述超长会静默截断，这里主动告警，便于回头精简文案
  if (page.title.length > LIMITS.title) {
    console.warn(`  ⚠ ${page.path} 标题 ${page.title.length} 字，超过 ${LIMITS.title}，已截断`)
  }
  if (page.description.length > LIMITS.description) {
    console.warn(
      `  ⚠ ${page.path} 描述 ${page.description.length} 字，超过 ${LIMITS.description}，已截断`
    )
  }

  const html = applyOg(template, og)

  // 首页直接覆盖模板自身；其余路由写进各自目录
  const outPath =
    page.path === "/"
      ? templatePath
      : join(distDir, page.path.replace(/^\//, ""), "index.html")

  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, html, "utf8")
  written++

  report.push({
    path: page.path,
    file: outPath.replace(distDir + "\\", "").replace(distDir + "/", ""),
    title: og.title,
    desc: og.description
  })
}

console.log("生成的页面：")
for (const r of report) {
  console.log(`  ${r.path.padEnd(11)} → ${r.file.padEnd(24)} 「${r.title}」`)
}
console.log(`\n共生成 ${written} 份 HTML。`)

/*
 * 带参数的深层路由（如 /chat/:id → /chat/abc123）不会命中 `$uri/index.html`
 * （因为 chat/abc123 不是目录），会回落到根 index.html —— 分享这类链接
 * 拿到的是站点级兜底卡片，不是聊天页卡片。
 *
 * 这里额外为「列表页 + 一层子路径」也生成一份：
 * dist/chat/abc/index.html 无法穷举，但可以让 nginx 用
 * `$uri/../index.html` 的思路处理。当前选择不生成 —— 因为聊天页
 * 本来就需要登录才能看到内容，分享出去对方也打不开，
 * 用站点级兜底卡片反而更合适。
 */
console.log("带参数的深层路由（如 /chat/abc）回落站点级卡片：内容需登录，分享后对方看不到。")

/*
 * 后台管理页（/admin/*）不生成 —— 它们需要权限，分享出去对方打不开。
 * 这些路径继续由 nginx 回落到根 index.html，行为不变。
 */
console.log("后台页 (/admin/*) 不生成分享卡片：需登录授权，分享后对方打不开。")
