/**
 * 演示数据填充脚本（幂等，可反复执行）。
 *
 * 目的：让后台各页面（用量统计、配额管理、会话审计、消息审计、技能运行记录、
 * 数据看板）都有一批可信的、跨 30 天的真实结构数据，便于验收与演示。
 *
 * 用法：
 *   cd apps/api && node scripts/seed-demo.mjs
 *   node scripts/seed-demo.mjs --reset   # 先清空演示数据再重建
 */
import { PrismaClient } from "@prisma/client"
import { readFileSync, existsSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))

// 手动加载仓库根目录的 .env（脚本独立运行，不经 Nest ConfigModule）
const envPath = resolve(here, "../../../.env")
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}

const prisma = new PrismaClient()
const RESET = process.argv.includes("--reset")
const DEMO_MARK = "[demo]"

const daysAgo = (n, hour = 10, minute = 0) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(hour, minute, 0, 0)
  return d
}

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min
const pick = (arr) => arr[rand(0, arr.length - 1)]

async function main() {
  console.log("开始填充演示数据…\n")

  const users = await prisma.user.findMany({
    where: { email: { in: ["admin@cagent.local", "student@cagent.local", "teacher@cagent.local"] } }
  })
  const admin = users.find((u) => u.email === "admin@cagent.local")
  const student = users.find((u) => u.email === "student@cagent.local")
  const teacher = users.find((u) => u.email === "teacher@cagent.local")
  if (!admin) throw new Error("找不到超级管理员，请先执行 pnpm db:seed")

  const models = await prisma.model.findMany({ include: { provider: true } })
  const modelByKey = new Map(models.map((m) => [m.key, m]))
  const chatModels = ["deepseek-chat", "qwen-plus", "moonshot-v1-8k", "gpt-4o-mini"]
    .map((k) => modelByKey.get(k))
    .filter(Boolean)

  const skillList = await prisma.skill.findMany()
  const skillByKey = new Map(skillList.map((s) => [s.key, s]))

  if (RESET) {
    const oldConvs = await prisma.conversation.findMany({
      where: { title: { startsWith: DEMO_MARK } },
      select: { id: true }
    })
    const ids = oldConvs.map((c) => c.id)
    await prisma.usageRecord.deleteMany({ where: { conversationId: { in: ids } } })
    await prisma.message.deleteMany({ where: { conversationId: { in: ids } } })
    await prisma.conversation.deleteMany({ where: { id: { in: ids } } })
    await prisma.skillRun.deleteMany({ where: { input: { path: ["demo"], equals: true } } })
    await prisma.usageRecord.deleteMany({ where: { errorCode: "demo" } })
    await prisma.auditLog.deleteMany({ where: { action: { startsWith: "demo." } } })
    console.log(`已清理旧演示数据：会话 ${ids.length} 个`)
  }

  // 若已有演示会话则跳过，保证幂等
  const existing = await prisma.conversation.count({
    where: { title: { startsWith: DEMO_MARK } }
  })
  if (existing > 0) {
    console.log(`检测到 ${existing} 个演示会话，跳过填充。如需重建请加 --reset`)
    return
  }

  // ---------- 1. 会话与消息 ----------
  const owners = [admin, student, teacher].filter(Boolean)
  const topics = [
    "高数期末复习计划怎么安排？",
    "帮我梳理一下毕业论文的提纲",
    "校园卡丢失后如何补办",
    "解释一下梯度下降的直观含义",
    "如何申请国家奖学金",
    "帮我看看这篇英文摘要的语法问题",
    "选课系统什么时候开放",
    "推荐几本入门的机器学习教材",
    "实验室报销流程是什么",
    "数据库索引为什么会失效",
    "帮我把这段代码改写成 Python",
    "宿舍报修多久能上门"
  ]

  const agents = await prisma.agent.findMany()
  let conversationCount = 0
  let messageCount = 0

  for (let i = 0; i < 10; i++) {
    const owner = owners[i % owners.length]
    const model = pick(chatModels)
    const agent = i % 3 === 0 ? pick(agents) : null
    const created = daysAgo(rand(0, 25), rand(8, 21), rand(0, 59))
    const question = topics[i % topics.length]

    const conv = await prisma.conversation.create({
      data: {
        title: `${DEMO_MARK} ${question}`,
        userId: owner.id,
        modelId: model?.id ?? null,
        agentId: agent?.id ?? null,
        temperature: 0.7,
        status: i === 9 ? "ARCHIVED" : "ACTIVE",
        pinned: i < 2,
        messageCount: 2,
        lastMessageAt: created,
        createdAt: created,
        updatedAt: created
      }
    })
    conversationCount++

    const promptTokens = rand(120, 900)
    const completionTokens = rand(180, 1400)
    const answer = `这是针对「${question}」的示例回答：可以先明确目标与约束，再拆分出可执行步骤，最后留出复盘时间。以上内容由 ${model?.name ?? "默认模型"} 生成，用于演示后台统计效果。`

    await prisma.message.create({
      data: {
        conversationId: conv.id,
        userId: owner.id,
        role: "user",
        content: question,
        status: "SUCCESS",
        seq: 1,
        modelId: model?.id ?? null,
        providerKey: model?.provider.key ?? null,
        modelKey: model?.key ?? null,
        promptTokens,
        totalTokens: promptTokens,
        ip: "127.0.0.1",
        createdAt: created,
        flagged: i === 3 || i === 7,
        flagNote: i === 3 || i === 7 ? `${DEMO_MARK} 命中敏感词规则，待人工复核` : null
      }
    })
    const assistant = await prisma.message.create({
      data: {
        conversationId: conv.id,
        userId: owner.id,
        role: "assistant",
        content: answer,
        status: i === 8 ? "ABORTED" : "SUCCESS",
        seq: 2,
        modelId: model?.id ?? null,
        providerKey: model?.provider.key ?? null,
        modelKey: model?.key ?? null,
        completionTokens,
        totalTokens: completionTokens,
        latencyMs: rand(600, 3200),
        finishReason: "stop",
        createdAt: new Date(created.getTime() + 4000)
      }
    })
    messageCount += 2

    await prisma.conversation.update({
      where: { id: conv.id },
      data: {
        totalTokens: promptTokens + completionTokens,
        messageCount: 2
      }
    })

    // 每条助手消息对应一条用量记录
    await prisma.usageRecord.create({
      data: {
        userId: owner.id,
        conversationId: conv.id,
        messageId: assistant.id,
        modelId: model?.id ?? null,
        providerKey: model?.provider.key ?? "deepseek",
        modelKey: model?.key ?? "deepseek-chat",
        source: "CHAT",
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        costUsd:
          (promptTokens / 1_000_000) * (model?.inputPricePerM ?? 0.27) +
          (completionTokens / 1_000_000) * (model?.outputPricePerM ?? 1.1),
        latencyMs: rand(600, 3200),
        success: i !== 8,
        errorCode: i === 8 ? "client_abort" : null,
        createdAt: created
      }
    })
  }
  console.log(`✓ 会话 ${conversationCount} 个、消息 ${messageCount} 条`)

  // ---------- 2. 历史用量（覆盖近 30 天，供趋势图与用量统计） ----------
  let usageCount = 0
  for (let day = 0; day < 30; day++) {
    const perDay = rand(2, 7)
    for (let k = 0; k < perDay; k++) {
      const owner = pick(owners)
      const model = pick(chatModels)
      const promptTokens = rand(80, 1500)
      const completionTokens = rand(100, 2200)
      const createdAt = daysAgo(day, rand(8, 22), rand(0, 59))
      const failed = Math.random() < 0.08
      await prisma.usageRecord.create({
        data: {
          userId: owner.id,
          modelId: model?.id ?? null,
          providerKey: model?.provider.key ?? "deepseek",
          modelKey: model?.key ?? "deepseek-chat",
          source: pick(["CHAT", "CHAT", "CHAT", "SKILL", "BROWSER", "EMBEDDING"]),
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          costUsd:
            (promptTokens / 1_000_000) * (model?.inputPricePerM ?? 0.27) +
            (completionTokens / 1_000_000) * (model?.outputPricePerM ?? 1.1),
          latencyMs: rand(500, 4200),
          success: !failed,
          errorCode: failed ? "upstream_timeout" : null,
          createdAt
        }
      })
      usageCount++
    }
  }
  console.log(`✓ 历史用量记录 ${usageCount} 条（近 30 天）`)

  // ---------- 3. 技能运行记录 ----------
  const runSkills = ["paper-outline", "course-planner", "web-summary", "web-qa", "weather-query"]
    .map((k) => skillByKey.get(k))
    .filter(Boolean)

  let runCount = 0
  for (let day = 0; day < 14; day++) {
    for (let k = 0; k < rand(1, 4); k++) {
      const skill = pick(runSkills)
      const owner = pick(owners)
      const failed = Math.random() < 0.18
      const startedAt = daysAgo(day, rand(9, 21), rand(0, 59))
      const durationMs = failed ? rand(120, 900) : rand(800, 12000)
      await prisma.skillRun.create({
        data: {
          skillId: skill.id,
          userId: owner.id,
          status: failed ? "FAILED" : "SUCCESS",
          input: { demo: true, topic: pick(topics), url: "https://www.example.edu.cn/notice" },
          output: failed
            ? null
            : { summary: `技能「${skill.name}」演示输出，用于填充运行记录页面。` },
          error: failed ? "目标站点响应超时（演示数据）" : null,
          steps: [
            { step: 1, action: "prepare", detail: "校验入参", durationMs: 12 },
            { step: 2, action: "execute", detail: skill.type, durationMs: durationMs - 20 },
            { step: 3, action: "finalize", detail: "写入运行记录", durationMs: 8 }
          ],
          startedAt,
          finishedAt: new Date(startedAt.getTime() + durationMs),
          durationMs
        }
      })
      runCount++

      await prisma.usageRecord.create({
        data: {
          userId: owner.id,
          providerKey: "skill",
          modelKey: skill.key,
          source: "SKILL",
          totalTokens: 0,
          latencyMs: durationMs,
          success: !failed,
          errorCode: failed ? "skill_failed" : null,
          createdAt: startedAt
        }
      })
    }
  }
  console.log(`✓ 技能运行记录 ${runCount} 条（近 14 天）`)

  // ---------- 4. 管理操作审计 ----------
  const auditActions = [
    ["user.update", "user", "修改用户资料"],
    ["user.status", "user", "禁用违规账号"],
    ["model.update", "model", "调整模型单价"],
    ["provider.update", "provider", "更新供应商密钥"],
    ["skill.create", "skill", "新建技能"],
    ["quota.update", "user_quota", "调整用户配额"],
    ["message.flag", "message", "标记违规消息"],
    ["setting.update", "setting", "修改站点设置"]
  ]
  let auditCount = 0
  for (let i = 0; i < auditActions.length; i++) {
    const [action, resource, note] = auditActions[i]
    const owner = pick(owners)
    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        actor: admin.email,
        action: `demo.${action}`,
        resource,
        resourceId: owner.id,
        detail: { demo: true, note, target: owner.email },
        ip: "127.0.0.1",
        success: i !== 5,
        createdAt: daysAgo(rand(0, 20), rand(9, 20), rand(0, 59))
      }
    })
    auditCount++
  }
  console.log(`✓ 审计日志 ${auditCount} 条`)

  // ---------- 5. 补齐配额行 ----------
  for (const u of owners) {
    await prisma.userQuota.upsert({
      where: { userId: u.id },
      update: {},
      create: {
        userId: u.id,
        enabled: u.email !== "admin@cagent.local",
        dailyTokenLimit: 100000,
        monthlyTokenLimit: 2000000,
        dailyRequestLimit: 200,
        rpmLimit: 20,
        note: u.email === "admin@cagent.local" ? "管理员不限" : "演示账号配额"
      }
    })
  }
  console.log(`✓ 配额行 ${owners.length} 条`)

  console.log("\n演示数据填充完成 ✅")
}

main()
  .catch((err) => {
    console.error("填充失败：", err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })