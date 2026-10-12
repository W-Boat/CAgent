/**
 * 导入 ucass-campus-guide 的 guide_v4.json 到 campus_guide_items。
 *
 * 幂等：以 externalId（原始索引 id）为唯一键 upsert，可反复执行。
 *
 * 用法：
 *   cd apps/api
 *   node scripts/import-campus-guide.mjs                       # 默认读取仓库内 storage/ucass-guide/...
 *   node scripts/import-campus-guide.mjs <path/to/guide_v4.json>
 *   node scripts/import-campus-guide.mjs --prune               # 同时删除索引里已不存在的条目
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
const args = process.argv.slice(2)
const PRUNE = args.includes("--prune")
const KEEP_META = args.includes('--keep-meta')
const explicit = args.find((a) => !a.startsWith("--"))

const CANDIDATES = [
  explicit,
  resolve(here, "../../../storage/ucass-guide/pkg/ucass-campus-guide/data/guide_v4.json"),
  resolve(here, "../../../storage/ucass-guide/ucass-campus-guide/data/guide_v4.json")
].filter(Boolean)

const indexPath = CANDIDATES.find((p) => existsSync(p))
if (!indexPath) {
  console.error("找不到 guide_v4.json，请显式指定路径：")
  for (const c of CANDIDATES) console.error("  - " + c)
  process.exit(1)
}

/** 与 q4.py 的 score() 保持一致的检索文本拼接 */
function buildSearchText(e) {
  const parts = [
    e.title,
    e.name,
    e.dept,
    e.cat,
    e.type,
    e.source,
    e.summary_short,
    e.place,
    e.tel,
    e.system_title,
    ...(e.extra?.kb?.aliases || []),
    e.search_text,
    e.contact,
    typeof e.detail === "string" ? e.detail.slice(0, 1500) : "",
    ...(Array.isArray(e.key_facts) ? e.key_facts.map((f) => String(f?.value ?? "")) : []),
    ...(Array.isArray(e.steps) ? e.steps : []),
    ...(((e.detail_parts || {}).materials || []).flatMap((g) =>
      (g.items || []).map((m) => m?.name ?? "")
    ))
  ]
  return parts
    .filter((v) => typeof v === "string" && v.length > 0)
    .join(" ")
    .toLowerCase()
    .slice(0, 20000)
}

const DETAIL_STATUSES = new Set([
  "full",
  "basic",
  "rendered",
  "verified",
  "attachment_only",
  "link_only",
  "unavailable"
])

async function main() {
  console.log(`读取索引：${indexPath}`)
  const raw = JSON.parse(readFileSync(indexPath, "utf8"))
  const items = raw.items || []
  const ids = items.map(e => Number(e.id))
  if (!items.length || ids.some(id => !Number.isSafeInteger(id)) || new Set(ids).size !== ids.length) throw new Error('索引不能为空，条目 ID 必须是唯一整数')
  if (PRUNE && raw.meta?.schema !== 'kb/v2') throw new Error('--prune 仅允许清理 kb/v2 命名空间；旧索引导入不能删除其他库')
  const meta = raw.meta || {}
  console.log(`索引 schema=${meta.schema} verified_at=${meta.verified_at} 共 ${items.length} 条`)

  const extraKeys = ["applies", "modified", "created", "alt_entry", "http_status", "tech", "portal_id", "menu_api", "redirect_to", "login_url", "system_title", "verified"]
  let created = 0
  let updated = 0

  const BATCH = 200
  await prisma.$transaction(async tx => {
  for (let i = 0; i < items.length; i += BATCH) {
    const slice = items.slice(i, i + BATCH)
    await Promise.all(
      slice.map(async (e) => {
        const extra = {...(e.extra || {})}
        for (const k of extraKeys) if (e[k] !== undefined) extra[k] = e[k]

        const detailStatus = DETAIL_STATUSES.has(e.detail_status) ? e.detail_status : "link_only"
        const data = {
          externalId: Number(e.id),
          title: String(e.title ?? "").slice(0, 500),
          url: String(e.url ?? "").slice(0, 1000),
          cat: String(e.cat ?? "未分类").slice(0, 120),
          type: String(e.type ?? "事项").slice(0, 60),
          source: String(e.source ?? "").slice(0, 120),
          name: e.name ? String(e.name).slice(0, 500) : null,
          dept: e.dept ? String(e.dept).slice(0, 200) : null,
          place: e.place ? String(e.place).slice(0, 300) : null,
          tel: e.tel ? String(e.tel).slice(0, 120) : null,
          campus: e.campus ? String(e.campus).slice(0, 60) : null,
          form: e.form ? String(e.form).slice(0, 60) : null,
          officeTime: e.office_time ? String(e.office_time).slice(0, 200) : null,
          contact: e.contact ? String(e.contact).slice(0, 300) : null,
          login: e.login ? String(e.login).slice(0, 200) : null,
          access: e.access ? String(e.access).slice(0, 60) : null,
          detailStatus,
          subtype: e.subtype ? String(e.subtype).slice(0, 60) : null,
          summaryShort: String(e.summary_short ?? "").slice(0, 2000),
          detail: e.detail ? String(e.detail) : null,
          steps: Array.isArray(e.steps) ? e.steps : null,
          keyFacts: Array.isArray(e.key_facts) ? e.key_facts : null,
          detailParts: e.detail_parts ?? null,
          extra: Object.keys(extra).length ? extra : null,
          verifiedAt: e.verified_at ? String(e.verified_at) : null,
          note: e.note ? String(e.note).slice(0, 500) : null,
          views: Number.isFinite(Number(e.views)) ? Number(e.views) : 0,
          searchText: buildSearchText(e)
        }

        const existing = await tx.campusGuideItem.findUnique({
          where: { externalId: data.externalId },
          select: { id: true }
        })
        const {views, ...updateData} = data
        await tx.campusGuideItem.upsert({
          where: { externalId: data.externalId },
          create: data,
          update: updateData
        })
        if (existing) updated++
        else created++
      })
    )
    process.stdout.write(`\r  已处理 ${Math.min(i + BATCH, items.length)}/${items.length}`)
  }
  await tx.setting.upsert({where:{key:'knowledge_revision'},create:{key:'knowledge_revision',group:'campus',value:String(Date.now())},update:{value:String(Date.now())}})
  },{timeout:120000})
  process.stdout.write("\n")
  console.log(`✓ 新增 ${created} 条，更新 ${updated} 条`)

  if (PRUNE) {
    const ids = items.map((e) => Number(e.id))
    const res = await prisma.campusGuideItem.deleteMany({
      where: { externalId: {gte:500000000,lt:900000000,notIn:ids},extra:{path:["kb","schema"],equals:"kb/v2"} }
    })
    console.log(`✓ 清理索引外条目 ${res.count} 条`)
  }

  // 分类 / 完整度 / 可达性 概览
  const [byCat, byStatus, byAccess] = await Promise.all([
    prisma.campusGuideItem.groupBy({ by: ["cat"], _count: { _all: true } }),
    prisma.campusGuideItem.groupBy({ by: ["detailStatus"], _count: { _all: true } }),
    prisma.campusGuideItem.groupBy({ by: ["access"], _count: { _all: true } })
  ])
  console.log("\n分类 Top：")
  byCat
    .sort((a, b) => b._count._all - a._count._all)
    .slice(0, 8)
    .forEach((r) => console.log(`  ${r.cat}  ${r._count._all}`))
  console.log("完整度：", byStatus.map((r) => `${r.detailStatus}=${r._count._all}`).join(" "))
  console.log("可达性：", byAccess.map((r) => `${r.access ?? "未标注"}=${r._count._all}`).join(" "))

  // 把 meta 快照写入系统设置，前端展示「数据核实时间」
  if(!KEEP_META)await prisma.setting.upsert({
    where: { key: "campus_guide_meta" },
    create: {
      key: "campus_guide_meta",
      group: "campus",
      description: "UCASS 校园导览索引元信息",
      value: {
        schema: meta.schema ?? "guide/v4",
        verifiedAt: meta.verified_at ?? null,
        builtAt: meta.built_at ?? null,
        total: items.length,
        cats: meta.cats ?? {},
        types: meta.types ?? {},
        detailStatus: meta.detail_status ?? {},
        sources: meta.sources ?? {},
        knownErrors: meta.known_errors ?? []
      }
    },
    update: {
      value: {
        schema: meta.schema ?? "guide/v4",
        verifiedAt: meta.verified_at ?? null,
        builtAt: meta.built_at ?? null,
        total: items.length,
        cats: meta.cats ?? {},
        types: meta.types ?? {},
        detailStatus: meta.detail_status ?? {},
        sources: meta.sources ?? {},
        knownErrors: meta.known_errors ?? []
      }
    }
  })
  await prisma.setting.upsert({where:{key:'knowledge_revision'},create:{key:'knowledge_revision',group:'campus',value:String(Date.now())},update:{value:String(Date.now())}})
  console.log(KEEP_META?'\n✓ 保留整体索引元信息，增量资料已导入':"\n✓ 索引元信息已写入系统设置 campus_guide_meta")
}

main()
  .catch((err) => {
    console.error("\n导入失败：", err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
