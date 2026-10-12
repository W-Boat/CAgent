/**
 * 把「校园门户条目 + 一站式服务平台事项」两份 JSON 的精确入口对齐进统一知识库。
 *
 * 用法：
 *   cd apps/api && node scripts/import-link-entries.mjs <ucass_guide.json> <easy_platform.json>
 *
 * 对齐纪律：
 *  - 只给事项/服务类条目挂链接，公告类文本不挂错链接；
 *  - 优先 easy 平台的办理页（matter/detail、m_detail、reserve），其次门户微应用/直通车；
 *  - url 已有值的事项不覆盖（抓取核实的链接优先），空着才补；
 *  - 校内 IP 链接标 access=校园网/VPN，answerBlock 会带出提醒；
 *  - extra.link_entry_source 标记来源，幂等可重跑。
 */
import { PrismaClient } from "@prisma/client"
import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(here, "../../../.env")
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}

const prisma = new PrismaClient()
const [guidePath, easyPath] = process.argv.slice(2)
if (!guidePath || !easyPath) {
  console.error("用法: node scripts/import-link-entries.mjs <ucass_guide.json> <easy_platform.json>")
  process.exit(1)
}
for (const p of [guidePath, easyPath]) {
  if (!existsSync(resolve(p))) {
    console.error("文件不存在: " + p)
    process.exit(1)
  }
}

const norm = (s) =>
  String(s || "")
    .replace(/[\s（）()【】\[\]·、，,。.：:；;-]/g, "")
    .toLowerCase()

/** 从入口文字路径里抽「一站式服务大厅 → 搜索"X"」的引号词 */
function hallKeyword(...paths) {
  for (const p of paths) {
    const s = String(p || "")
    if (!s.includes("一站式")) continue
    const qs = s.match(/[“"]([^”"]{2,30})[”"]/g) || []
    for (const q of qs) {
      const term = q.slice(1, -1).replace(/申请表|审批表|办理指南|办事指南/g, (m) => m).trim()
      if (term.length >= 3) return term
    }
  }
  return ""
}

const EASY_SEARCH = "https://easy.ucass.edu.cn/v2/site/search?keyword="
const INTERNAL = /^https?:\/\/(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.)/i

/** 出题材料把门户误写成 portal.ucass，统一纠正为真实门户域名 */
function fixDomain(s) {
  return String(s || "").replace(/portal\.ucass\.edu\.cn/g, "info.ucass.edu.cn")
}
const ACTIONABLE = new Set(["事项", "表单", "预约", "微应用", "在线办事/微应用", "业务系统入口", "正版软件下载"])

/** 收集候选链接：title → {url, mobileUrl, type, access}，按优先级去重 */
function collectEntries() {
  const map = new Map()
  const put = (title, entry, prio) => {
    const key = norm(title)
    if (!key || key.length < 4 || !entry.url || !/^https?:\/\//.test(entry.url)) return
    const prev = map.get(key)
    if (prev && prev.prio <= prio) return
    map.set(key, { ...entry, title: String(title).trim(), prio })
  }

  // 1) 一站式服务平台（最高优先：精确办理页）
  const easy = JSON.parse(readFileSync(resolve(easyPath), "utf8"))
  for (const it of easy.items || []) {
    if (!ACTIONABLE.has(it.content_type)) continue
    put(it.title, {
      url: it.mobile_url || it.url,
      type: it.content_type,
      access: INTERNAL.test(it.url) ? "校园网/VPN" : "公网",
      src: "一站式服务平台"
    }, 1)
  }

  // 2) 门户：微应用/系统直通车/正版软件/服务驿站
  const guide = JSON.parse(readFileSync(resolve(guidePath), "utf8"))
  for (const it of guide.items || []) {
    const ct = it.content_type || ""
    if (ct === "通知公告") continue // 公告文本不是办理入口
    const prio = ct.includes("微应用") ? 2 : ct.includes("业务系统") ? 2 : ct.includes("正版") ? 3 : 3
    put(it.title, {
      url: it.url,
      type: ct || it.category || "入口",
      access: INTERNAL.test(it.url) ? "校园网/VPN" : "公网",
      src: "校园门户"
    }, prio)
  }
  return map
}

async function main() {
  const entries = collectEntries()
  console.log(`候选入口 ${entries.size} 个（归一化标题）`)

  const matters = JSON.parse(
    readFileSync(resolve(here, "../../../knowledge/benchmark-kb/matters.json"), "utf8")
  )

  const items = await prisma.campusGuideItem.findMany({
    where: { type: { in: ["事项", "表单", "微应用", "服务指南"] } },
    select: { id: true, title: true, url: true, access: true, searchText: true, extra: true }
  })
  const byNorm = new Map()
  for (const it of items) byNorm.set(norm(it.title), it)
  const pickLink = (name) => {
    const nk = norm(name)
    if (!nk) return null
    if (entries.has(nk)) return entries.get(nk)
    for (const [key, e] of entries) {
      if (key.length >= 6 && (nk.includes(key) || key.includes(nk))) return e
    }
    return null
  }

  let linked = 0
  let skipped = 0
  const noLink = []
  const byTier = {}
  for (const m of matters) {
    const title = String(m["正式名称"] || "").trim()
    if (!title) continue
    const row = byNorm.get(norm(title))
    if (!row) continue
    if (row.url) {
      skipped++
      continue
    }
    const e = pickLink(title)
    let link = e
      ? { url: e.url, access: e.access, src: e.src }
      : null
    if (!link) {
      /*
       * 第三层「搜索直达」：赛题入口原文里就是"一站式服务大厅 → 搜索X"，
       * 把 X 拼成 easy 的搜索页 URL —— 学生点开后就是那条文字路径的终点。
       * 实测：未登录时先到统一身份认证，登录后自动回跳搜索结果。
       */
      const term = hallKeyword(m["办理入口(PC端)"], m["办理入口(移动端)"])
      if (term) {
        link = { url: EASY_SEARCH + encodeURIComponent(term), access: "公网·需登录", src: "一站式大厅搜索直达" }
      }
    }
    if (!link) {
      /*
       * 第四层「来源部门网站」：窗口办理/自助打印类事项没有线上表单，
       * 给经核实的部门官网主页作兜底去处（明确标注，不当作办理入口）。
       */
      const src = String(m["来源链接"] || "").trim()
      if (/^https?:\/\//.test(src)) {
        link = { url: fixDomain(src), access: "公网", src: "部门官网·来源" }
      }
    }
    if (!link) {
      noLink.push(`${m["事项ID"]} ${title}`)
      continue
    }
    const extra = (row.extra && typeof row.extra === "object") ? row.extra : {}
    await prisma.campusGuideItem.update({
      where: { id: row.id },
      data: {
        url: String(link.url).slice(0, 1000),
        access: row.access || link.access,
        extra: { ...extra, link_entry_source: link.src },
        searchText: `${row.searchText || ""} ${String(link.url).toLowerCase()}`.slice(0, 20000)
      }
    })
    linked++
    byTier[link.src] = (byTier[link.src] || 0) + 1
  }

  console.log(`✓ 赛题事项挂链接：新增 ${linked}，已有 ${skipped}，无入口可挂 ${noLink.length}`)
  console.log("  分层统计：", JSON.stringify(byTier, null, 0))
  if (noLink.length) console.log("  无精确入口的事项（保持无链接，不再乱兜底）：\n   " + noLink.join("\n   "))
}

main().finally(() => prisma.$disconnect())
