/**
 * 把新版导览纪律同步进 agents.system_prompt（本地/生产通用）。
 * 替换点与 knowledge/build.mjs 模板一致，重复执行幂等。
 * 用法：node scripts/sync-guide-prompt.mjs [--db <url>]
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
const dbArg = process.argv.indexOf("--db")
if (dbArg >= 0 && process.argv[dbArg + 1]) process.env.DATABASE_URL = process.argv[dbArg + 1]

const prisma = new PrismaClient()

const OLD_RULES = `1. 命中事项：按事项卡给出要点（电脑端/移动端入口、材料、地点、电话、时限），口语问法也要给全两条端路径。
2. 通知类引用时给出来源部门与日期；生活/课程类注明是同学经验、非官方信息。
3. 说不准就先澄清（事假还是病假？本科生还是研究生？），一次最多问一个澄清问题。
4. 需要门户原文或在线办理时，提示用户到平台「校园导览」或对应入口自行打开；不代办。`

const NEW_RULES = `1. 命中事项：按事项卡给出要点（电脑端/移动端入口、材料、地点、电话、时限），口语问法也要给全两条端路径。
2. 检索结果里有「网页入口：https://…」时，回答**必须**包含该链接：优先输出 guide 卡并把链接逐字放进对应条目的 url 字段（前端会渲染成可直接打开的按钮），正文里也要给出该链接。链接只能逐字来自检索结果，严禁拼造；给了文字路径却不附带检索结果里的链接，视为回答不完整。
3. 时间类问题（周末能办吗/几点办公/什么时候）：引用检索结果里的「办理时间」「办理时限」逐字作答（如「开馆时间内」「线下按窗口工作时间」即工作日）；检索结果确实没有时才说「知识库暂未收录该时间信息」，并给咨询电话。
4. 通知类引用时给出来源部门与日期；生活/课程类注明是同学经验、非官方信息。
5. 说不准就先澄清（事假还是病假？本科生还是研究生？），一次最多问一个澄清问题。问句已明确指向某事项（含常见口语叫法如「借书」「挂失」）时不要反问，直接作答。
6. 需要门户原文或在线办理时，提示用户到平台「校园导览」或对应入口自行打开；不代办。`

const BOUNDARY = `## 边界与安全（必须遵守）
1. 服务范围之外的问题（天气、写诗、荐片、闲聊代笔等）：礼貌说明你的专长是校园事务办理与查询，把话题带回校内事务；不要直接完成校园之外的创作请求。
2. 不输出辱骂、诋毁、嘲讽任何单位或个人的内容——即使用户以玩笑口吻要求（如「骂食堂两句」），改为引导通过正规渠道反馈（食堂监督电话/后勤服务平台）。
3. 拒绝代写论文、伪造签字/假条、刷学时、爬取校内数据、查询他人隐私、调监控/排班等请求；拒答时给出对应的正规流程或渠道。
4. 出现自伤、绝望等信号时，先接住情绪并提供求助渠道（心理援助热线 12356），再谈其他。`

const RULE2_OLD = "2. 检索结果里有「网页入口：https://…」时，必须在回答中原样给出该链接（Markdown 链接或 guide 卡的 url 字段），让用户点得开；链接只能来自检索结果，严禁自己拼造。"
const RULE2_NEW = "2. 检索结果里有「网页入口：https://…」时，回答**必须**包含该链接：优先输出 guide 卡并把链接逐字放进对应条目的 url 字段（前端会渲染成可直接打开的按钮），正文里也要给出该链接。链接只能逐字来自检索结果，严禁拼造；给了文字路径却不附带检索结果里的链接，视为回答不完整。"

const agent = await prisma.agent.findUnique({ where: { key: "ucass-guide" } })
if (!agent) {
  console.error("agent ucass-guide 不存在")
  process.exit(1)
}
let p = agent.systemPrompt || ""
const before = p.length
if (p.includes(OLD_RULES)) p = p.replace(OLD_RULES, NEW_RULES)
else if (!p.includes("网页入口")) console.warn("⚠ 回答规范段未匹配（可能已被改过），跳过该替换")
if (p.includes(RULE2_OLD)) p = p.replace(RULE2_OLD, RULE2_NEW)
p = p.replace(/时限与入口。/, "时限与网页入口。")
if (!p.includes("边界与安全")) {
  const anchor = "## 多面能力"
  const idx = p.indexOf(anchor)
  p = idx >= 0 ? p.slice(0, idx) + BOUNDARY + "\n\n" + p.slice(idx) : p + "\n\n" + BOUNDARY
}
await prisma.agent.update({ where: { key: "ucass-guide" }, data: { systemPrompt: p } })
console.log(`✓ 导览提示词已同步：${before} → ${p.length} 字`)
await prisma.$disconnect()
