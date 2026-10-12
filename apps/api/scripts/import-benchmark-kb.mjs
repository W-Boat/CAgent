/**
 * 把「榜题1-行知校园」赛题本地知识库（knowledge/benchmark-kb/*.json）对齐导入
 * 统一知识库 campus_guide_items。
 *
 * ── 为什么导入 ──
 *
 * 赛题 KB 的 157 项事项带有我们门户抓取数据普遍缺失的字段：
 * 办理时限/时间窗口（officeTime）、办公地点、审批链路、分步步骤、口语别名。
 * 没有它们，"XX 这个周末能办吗"这类时间问句只能答「暂未收录」。
 *
 * ── 对齐与安全纪律 ──
 *
 *  - 优先按标题匹配既有条目（精确 → 规范化 → 包含），命中后**只填空字段**，
 *    不覆盖已核实的门户数据；
 *  - 匹配不到的事项整条新建，externalId 用 990000001+ 段位，绝不与门户 id 冲突；
 *  - 步骤（02 表）与口语别名（06 表）分别落到 steps / searchText，
 *    searchText 采用**追加**而不是重建，保留原检索信号。
 *
 * 幂等：可反复执行。
 *
 * 用法：
 *   cd apps/api && node scripts/import-benchmark-kb.mjs
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
const kbDir = resolve(here, "../../../knowledge/benchmark-kb")

const SOURCE_TAG = "榜题1本地知识库"
const NEW_ID_BASE = 990000001

/**
 * 域名修正：出题材料里「校园门户」被误写成 portal.ucass.edu.cn，
 * 实际门户是 info.ucass.edu.cn —— 落库前统一纠正（跑题1判分发现的假链接）。
 */
function fixDomain(s) {
  return String(s || "").replace(/portal\.ucass\.edu\.cn/g, "info.ucass.edu.cn")
}

/** 标题规范化：去空白与全半角括号差异 */
function normTitle(t) {
  return String(t || "").replace(/[\s（）()·]/g, "").toLowerCase()
}

function pick(row, keys) {
  for (const k of keys) {
    const v = row[k]
    if (typeof v === "string" && v.trim()) return v.trim()
  }
  return ""
}

async function main() {
  const matters = JSON.parse(readFileSync(resolve(kbDir, "matters.json"), "utf8"))
  const steps = JSON.parse(readFileSync(resolve(kbDir, "steps.json"), "utf8"))
  const aliases = JSON.parse(readFileSync(resolve(kbDir, "alias.json"), "utf8"))

  // 事项ID → 步骤 / 别名 的索引
  const stepsByMatter = new Map()
  for (const s of steps) {
    if (!s["事项ID"]) continue
    const list = stepsByMatter.get(s["事项ID"]) || []
    const title = pick(s, ["步骤标题"])
    const desc = pick(s, ["步骤说明"])
    const text = desc && !title.includes(desc) ? `${title}：${desc}` : title
    if (text) list.push(text)
    stepsByMatter.set(s["事项ID"], list)
  }
  const aliasByMatter = new Map()
  for (const a of aliases) {
    if (!a["事项ID"]) continue
    const v = pick(a, ["口语表达/别名"])
    if (v.length >= 2 && v.length <= 30) {
      const list = aliasByMatter.get(a["事项ID"]) || []
      if (!list.includes(v)) list.push(v)
      aliasByMatter.set(a["事项ID"], list)
    }
  }

  const items = await prisma.campusGuideItem.findMany({
    select: {
      id: true, title: true, url: true, dept: true, place: true, tel: true,
      officeTime: true, campus: true, form: true, summaryShort: true,
      steps: true, keyFacts: true, searchText: true, note: true, extra: true
    }
  })
  const byExact = new Map(items.map((it) => [it.title, it]))
  const byNorm = new Map()
  for (const it of items) byNorm.set(normTitle(it.title), it)

  let matched = 0
  let created = 0
  let filled = 0
  const unmatched = []

  for (let i = 0; i < matters.length; i++) {
    const m = matters[i]
    const title = pick(m, ["正式名称"])
    if (!title) continue
    const mid = pick(m, ["事项ID"])
    const officeTime = pick(m, ["办理时限/时间窗口", "办理时限/时间窗口 ", "时限"])
    const dept = pick(m, ["主管部门"])
    const place = pick(m, ["办公地点"])
    const tel = pick(m, ["咨询电话"])
    const campus = pick(m, ["校区"])
    const form = pick(m, ["办理模式"])
    const audience = pick(m, ["适用对象"])
    const fee = pick(m, ["是否收费"])
    const approval = pick(m, ["审批链路"])
    const faq = pick(m, ["常见问题提示"])
    const entry = pick(m, ["办理入口(PC端)", "办理入口(PC端)"])
    const pcEntry = /^https?:\/\//.test(entry) ? fixDomain(entry) : ""
    /*
     * 赛题事项的 PC 入口都是文字路径（非 URL），可直接点的链接在
     * 「来源链接」字段（部门官网主页）。挂到 no-link 事项上，
     * answerBlock 才有「网页入口」可给 —— 判分发现模型对无链接事项
     * 完全不给去处，直达链接是导览体验的关键一环。
     */
    const srcLink = fixDomain(pick(m, ["来源链接"]))
    const link = pcEntry || (/^https?:\/\//.test(srcLink) ? srcLink : "")

    const matterSteps = stepsByMatter.get(mid) || []
    const matterAliases = aliasByMatter.get(mid) || []

    const hit =
      byExact.get(title) ||
      byNorm.get(normTitle(title)) ||
      items.find((it) => it.title && (it.title.includes(title) || title.includes(it.title)) && Math.abs(it.title.length - title.length) <= 4)

    if (hit) {
      matched++
      const data = {}
      const additions = []
      const fill = (field, value, label) => {
        if (value && !(hit[field] ?? "").toString().trim()) {
          data[field] = value.slice(0, 300)
          additions.push(value)
          filled++
        }
      }
      fill("officeTime", officeTime, "时间")
      fill("dept", dept, "部门")
      fill("place", place, "地点")
      fill("tel", tel, "电话")
      fill("campus", campus, "校区")
      fill("form", form, "模式")
      /*
       * 链接不在此脚本回填：赛题数据没有入口字段，把「来源链接」（部门主页）
       * 当直达入口会误导学生 —— 精确入口统一由 scripts/import-link-entries.mjs
       * 从门户/一站式平台权威目录挂接（办理页 / 搜索直达 / 部门官网逐层标注）。
       */
      if (faq && !hit.summaryShort) { data.summaryShort = faq.slice(0, 2000); additions.push(faq); filled++ }
      if (matterSteps.length && !(Array.isArray(hit.steps) && hit.steps.length)) {
        data.steps = matterSteps.slice(0, 12)
        additions.push(...matterSteps)
        filled++
      }
      const kf = Array.isArray(hit.keyFacts) ? [...hit.keyFacts] : []
      const addKf = (kind, value) => {
        if (value && !kf.some((f) => f?.kind === kind)) {
          kf.push({ kind, value })
          additions.push(value)
        }
      }
      addKf("适用对象", audience)
      addKf("是否收费", fee)
      addKf("审批链路", approval)
      if (kf.length && JSON.stringify(kf) !== JSON.stringify(hit.keyFacts)) data.keyFacts = kf

      // 口语别名并入 searchText：以 extra.benchmark_aliases 做幂等标记，
      // 只要没打过标记就整批追加（"借书"这类 2 字词无法用子串检查判断是否已存在）
      const alreadyAliased = Array.isArray((hit.extra || {})?.benchmark_aliases)
      if (matterAliases.length && !alreadyAliased) {
        additions.push(...matterAliases, `benchalias:${mid.toLowerCase()}`)
        data.extra = { ...(hit.extra || {}), benchmark_aliases: matterAliases }
      }
      if (additions.length) {
        data.searchText = `${hit.searchText || ""} ${additions.join(" ")}`.toLowerCase().slice(0, 20000)
        const tag = `；${SOURCE_TAG}补充`
        data.note = hit.note ? (hit.note.includes(SOURCE_TAG) ? hit.note : hit.note + tag) : tag.replace(/^；/, "")
        await prisma.campusGuideItem.update({ where: { id: hit.id }, data })
      }
    } else {
      created++
      unmatched.push(`${mid} ${title}`)
      const searchText = [
        title, dept, place, tel, officeTime, form, campus, audience, faq, approval, pcEntry,
        ...matterSteps, ...matterAliases
      ].filter(Boolean).join(" ").toLowerCase().slice(0, 20000)
      await prisma.campusGuideItem.upsert({
        where: { externalId: NEW_ID_BASE + i },
        create: {
          externalId: NEW_ID_BASE + i,
          title: title.slice(0, 500),
          url: pcEntry.slice(0, 1000),
          cat: pick(m, ["一级分类"]) || "未分类",
          type: "事项",
          source: SOURCE_TAG,
          dept: dept.slice(0, 200) || null,
          place: place.slice(0, 300) || null,
          tel: tel.slice(0, 120) || null,
          campus: campus.slice(0, 60) || null,
          form: form.slice(0, 60) || null,
          officeTime: officeTime.slice(0, 200) || null,
          summaryShort: faq.slice(0, 2000),
          steps: matterSteps.length ? matterSteps.slice(0, 12) : null,
          keyFacts: [
            audience && { kind: "适用对象", value: audience },
            fee && { kind: "是否收费", value: fee },
            approval && { kind: "审批链路", value: approval }
          ].filter(Boolean),
          detailStatus: "basic",
          note: SOURCE_TAG,
          searchText
        },
        update: {}
      })
    }
  }

  console.log(`✓ 赛题事项 ${matters.length}：命中既有 ${matched}，新建 ${created}，字段补充 ${filled} 处`)
  if (unmatched.length) console.log("  新建清单：\n   " + unmatched.join("\n   "))
}

main().finally(() => prisma.$disconnect())
