/**
 * OG 标签校验。
 *
 * 微信分享卡片失败时**不会报错**，只是不出图或显示空白卡片 ——
 * 这类问题只有真去分享才会发现。所以在构建阶段就把能查的都查掉：
 *
 *   1. 每个登记页面都生成了独立 HTML
 *   2. 五必需的 OG 标签齐全（title/description/image/url/type）
 *   3. og:url 与 og:image 是**绝对路径**（微信不认相对路径）
 *   4. title ≤ 30 字、description ≤ 60 字（超限会被静默截断）
 *   5. og:type 恒为 website
 *   6. 封面图存在、是 478×478、< 2MB
 *   7. 各页标签内容确实不同（避免复制模板时忘了改）
 *
 * 用法：node scripts/verify-og.mjs
 */
import { readFileSync, existsSync, statSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { PAGES, ogFor, OG_IMAGE_PATH, LIMITS, SITE_ORIGIN } from "../og.config.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = join(here, "..")
const distDir = join(webRoot, "dist")
const publicDir = join(webRoot, "public")

let failures = 0
const check = (cond, msg) => {
  console.log(`${cond ? "OK " : "NG "} ${msg}`)
  if (!cond) failures++
}

/** 从 HTML 里取某个 meta 的 content */
function metaOf(html, attr, key) {
  const re = new RegExp(
    `<meta\\s+${attr}=["']${key.replace(/[:]/g, "\\:")}["']\\s+content=["']([^"']*)["']`,
    "i"
  )
  const m = html.match(re)
  if (m) return m[1]
  // 属性顺序可能被压缩器调换，再试反序
  const re2 = new RegExp(
    `<meta\\s+content=["']([^"']*)["']\\s+${attr}=["']${key.replace(/[:]/g, "\\:")}["']`,
    "i"
  )
  const m2 = html.match(re2)
  return m2 ? m2[1] : null
}

function fileFor(path) {
  return path === "/"
    ? join(distDir, "index.html")
    : join(distDir, path.replace(/^\//, ""), "index.html")
}

console.log("=== 1. 封面图 ===")
{
  const imgPath = join(publicDir, OG_IMAGE_PATH.replace(/^\//, ""))
  check(existsSync(imgPath), `文件存在：public${OG_IMAGE_PATH}`)

  if (existsSync(imgPath)) {
    const bytes = statSync(imgPath).size
    check(bytes < 2 * 1024 * 1024, `体积 ${(bytes / 1024).toFixed(1)} KB < 2MB`)

    /*
     * 读 PNG 头拿尺寸（IHDR 在固定偏移处），不引图像库：
     * 字节 16-23 是大端序的宽高。
     */
    const buf = readFileSync(imgPath)
    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
    check(isPng, "格式为 PNG（微信支持）")
    if (isPng) {
      const w = buf.readUInt32BE(16)
      const h = buf.readUInt32BE(20)
      check(w === 478 && h === 478, `尺寸 ${w}×${h}（要求 478×478）`)
    }
  }
}

console.log("\n=== 2. 各页面 HTML 与标签 ===")
const seen = new Map() // title -> path，用于查重

for (const page of PAGES) {
  const file = fileFor(page.path)
  const rel = file.replace(distDir + "\\", "").replace(distDir + "/", "")
  const og = ogFor(page)
  const label = `${page.path}`.padEnd(11)

  if (!existsSync(file)) {
    check(false, `${label} 缺少 HTML：${rel}`)
    continue
  }

  const html = readFileSync(file, "utf8")
  const problems = []

  // 五必需标签
  const got = {
    title: metaOf(html, "property", "og:title"),
    description: metaOf(html, "property", "og:description"),
    image: metaOf(html, "property", "og:image"),
    url: metaOf(html, "property", "og:url"),
    type: metaOf(html, "property", "og:type")
  }

  for (const [k, v] of Object.entries(got)) {
    if (!v) problems.push(`缺 og:${k}`)
  }

  // 绝对路径
  if (got.image && !/^https?:\/\//i.test(got.image)) problems.push("og:image 非绝对路径")
  if (got.url && !/^https?:\/\//i.test(got.url)) problems.push("og:url 非绝对路径")

  // 内容与配置一致
  if (got.title && got.title !== og.title) problems.push(`og:title 与配置不符（${got.title}）`)
  if (got.description && got.description !== og.description) {
    problems.push("og:description 与配置不符")
  }
  if (got.url && got.url !== og.url) problems.push(`og:url 应为 ${og.url}`)
  if (got.image && got.image !== og.image) problems.push(`og:image 应为 ${og.image}`)

  // og:type
  if (got.type && got.type !== "website") problems.push(`og:type 应为 website，实为 ${got.type}`)

  // 长度
  if (got.title && got.title.length > LIMITS.title) {
    problems.push(`og:title ${got.title.length} 字 > ${LIMITS.title}`)
  }
  if (got.description && got.description.length > LIMITS.description) {
    problems.push(`og:description ${got.description.length} 字 > ${LIMITS.description}`)
  }

  // <title> 与 og:title 应一致，避免标签页与分享卡片文案不同
  const docTitle = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]
  if (docTitle && docTitle !== got.title) {
    problems.push(`<title> 与 og:title 不一致`)
  }

  // canonical 应存在且为绝对路径
  const canonical = html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i)?.[1]
  if (!canonical) problems.push("缺 canonical")
  else if (!/^https?:\/\//i.test(canonical)) problems.push("canonical 非绝对路径")

  // 正文里必须保留 SPA 挂载点，否则页面白屏
  if (!/<div id="app"/i.test(html)) problems.push('缺少 <div id="app">，SPA 无法挂载')

  if (problems.length === 0) {
    check(true, `${label} ${rel.padEnd(22)} 「${got.title}」 ${got.title.length}/${got.description.length} 字`)
  } else {
    check(false, `${label} ${rel} — ${problems.join("；")}`)
  }

  // 查重：不同页面的 title 必须不同
  if (got.title) {
    if (seen.has(got.title)) {
      check(false, `${label} og:title 与 ${seen.get(got.title)} 重复：「${got.title}」`)
    } else {
      seen.set(got.title, page.path)
    }
  }
}

console.log("\n=== 3. 配置自身的约束 ===")
for (const page of PAGES) {
  if (page.title.length > LIMITS.title) {
    check(false, `${page.path} 配置标题 ${page.title.length} 字超过 ${LIMITS.title}`)
  }
  if (page.description.length > LIMITS.description) {
    check(false, `${page.path} 配置描述 ${page.description.length} 字超过 ${LIMITS.description}`)
  }
}
check(true, `已检查 ${PAGES.length} 个页面的标题与描述长度`)

console.log(`\n=== 4. 站点地址 ===`)
check(/^https?:\/\//.test(SITE_ORIGIN), `SITE_ORIGIN 为绝对地址：${SITE_ORIGIN}`)

console.log("\n" + "=".repeat(52))
if (failures === 0) {
  console.log(`OG 校验全部通过（${PAGES.length} 个页面）`)
} else {
  console.log(`${failures} 项未通过`)
}
process.exit(failures === 0 ? 0 : 1)
