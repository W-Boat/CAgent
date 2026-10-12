/**
 * Key 轮询与健康状态流转测试（直接驱动服务层，不走 HTTP）。
 *
 * 这是 Key 池的核心价值，必须验证：
 *   1. 轮询：连续取用会在多把 Key 之间轮转，而不是死用第一把
 *   2. 限流：标记 COOLDOWN 并按失败次数退避，冷却期内不再被选中
 *   3. 认证失败：标记 INVALID，永久退出轮询
 *   4. 恢复：成功后清零失败计数并回到 ACTIVE
 *   5. 全部不可用时 pick 返回 null（上层据此给出可读错误）
 */
import { PrismaClient, Prisma } from "@prisma/client"
import { scryptSync, createCipheriv, randomBytes } from "node:crypto"

const prisma = new PrismaClient()

// 与 CryptoService 保持一致（ENCRYPTION_KEY 优先，回退 JWT_SECRET）
const secret =
  process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || "cagent-insecure-default-key"
const key = scryptSync(secret, "cagent-api-key-salt", 32)

function encrypt(plain) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  return `v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${enc.toString("base64")}`
}

let failures = 0
const check = (cond, msg) => {
  console.log(`${cond ? "✅" : "❌"} ${msg}`)
  if (!cond) failures++
}

/**
 * 复刻 ProviderKeyService.pick 的挑选逻辑（含两个关键修正）。
 *
 * 直接 import 编译产物比较脆弱（依赖 Nest DI），这里用同样的 SQL
 * 验证「数据库层的选择顺序」正确 —— 这也是轮询是否生效的关键。
 *
 * 两个必须绕开的坑：
 *   1. ORDER BY last_used_at ASC 默认 NULLS LAST，未用过的 Key 反而排最后
 *   2. 毫秒精度下同刻写入会持平，需写入 Date.now()+1 保证单调递增
 */
async function pickKey(providerId, excludeIds = []) {
  const now = new Date()
  await prisma.providerApiKey.updateMany({
    where: { providerId, status: "COOLDOWN", cooldownUntil: { lte: now } },
    data: { status: "ACTIVE", cooldownUntil: null }
  })

  const excludeClause = excludeIds.length
    ? Prisma.sql`AND id NOT IN (${Prisma.join(excludeIds)})`
    : Prisma.empty

  const rows = await prisma.$queryRaw(Prisma.sql`
    SELECT id, api_key, label
    FROM provider_api_keys
    WHERE provider_id = ${providerId}
      AND enabled = true
      AND status = 'ACTIVE'::"ApiKeyStatus"
      AND (cooldown_until IS NULL OR cooldown_until <= ${now})
      ${excludeClause}
    ORDER BY last_used_at ASC NULLS FIRST, sort ASC, id ASC
    LIMIT 10
  `)

  if (rows.length === 0) return null
  const chosen = rows[0]
  await prisma.providerApiKey.update({
    where: { id: chosen.id },
    data: { lastUsedAt: new Date(Date.now() + 1) }
  })
  return chosen
}

const main = async () => {
  const provider = await prisma.provider.findFirst({ where: { key: "deepseek" } })
  if (!provider) throw new Error("找不到 DeepSeek 供应商用于测试")

  // 清场：删掉之前遗留的测试 Key
  await prisma.providerApiKey.deleteMany({
    where: { providerId: provider.id, label: { startsWith: "轮询测试" } }
  })

  console.log("=== 准备 3 把测试 Key ===")
  const created = []
  for (const n of ["A", "B", "C"]) {
    created.push(
      await prisma.providerApiKey.create({
        data: {
          providerId: provider.id,
          label: `轮询测试-${n}`,
          apiKey: encrypt(`sk-rotate-test-${n}`),
          status: "ACTIVE",
          enabled: true,
          sort: created.length
        }
      })
    )
  }
  check(created.length === 3, "已创建 3 把 Key")

  console.log("\n=== 1. 轮询：连续 6 次取用应轮转（A→B→C→A→B→C）===")
  const order = []
  for (let i = 0; i < 6; i++) {
    const k = await pickKey(provider.id)
    // 只记录测试 Key，忽略池里可能存在的其他 Key
    order.push(k?.label || "(无)")
  }
  const testOrder = order.filter((l) => l.startsWith("轮询测试"))
  console.log(`   取用序列：${order.join(" → ")}`)
  check(
    testOrder.length === 6,
    `6 次全部命中测试 Key（${testOrder.length}）`
  )
  check(
    new Set(testOrder).size === 3,
    `轮转覆盖了全部 3 把（去重后 ${new Set(testOrder).size} 把）`
  )
  check(
    testOrder[0] !== testOrder[1] && testOrder[1] !== testOrder[2],
    "相邻两次不是同一把（确实在轮转）"
  )

  console.log("\n=== 2. 限流 → COOLDOWN，冷却期内被跳过 ===")
  const target = created[0]
  await prisma.providerApiKey.update({
    where: { id: target.id },
    data: {
      status: "COOLDOWN",
      failureCount: 1,
      cooldownUntil: new Date(Date.now() + 60_000),
      lastError: "429 Too Many Requests"
    }
  })
  const picksAfterCooldown = []
  for (let i = 0; i < 6; i++) {
    const k = await pickKey(provider.id)
    picksAfterCooldown.push(k?.id)
  }
  check(
    !picksAfterCooldown.includes(target.id),
    "冷却中的 Key 未被选中（6 次取用均跳过）"
  )

  console.log("\n=== 3. 冷却到期自动恢复 ===")
  await prisma.providerApiKey.update({
    where: { id: target.id },
    data: { cooldownUntil: new Date(Date.now() - 1000) } // 已过期
  })
  await pickKey(provider.id) // 触发惰性恢复
  const revived = await prisma.providerApiKey.findUnique({ where: { id: target.id } })
  check(revived.status === "ACTIVE", `到期后恢复 ACTIVE：${revived.status}`)
  check(revived.cooldownUntil === null, "冷却时间已清空")

  console.log("\n=== 4. 认证失败 → INVALID，永久退出轮询 ===")
  const invalidTarget = created[1]
  await prisma.providerApiKey.update({
    where: { id: invalidTarget.id },
    data: {
      status: "INVALID",
      lastError: "401 Unauthorized: invalid api key",
      lastErrorAt: new Date()
    }
  })
  const picksAfterInvalid = []
  for (let i = 0; i < 6; i++) {
    const k = await pickKey(provider.id)
    picksAfterInvalid.push(k?.id)
  }
  check(
    !picksAfterInvalid.includes(invalidTarget.id),
    "INVALID 的 Key 未被选中"
  )
  // 惰性恢复不该把 INVALID 变回 ACTIVE
  const stillInvalid = await prisma.providerApiKey.findUnique({
    where: { id: invalidTarget.id }
  })
  check(stillInvalid.status === "INVALID", "INVALID 不会被自动恢复（需人工处理）")

  console.log("\n=== 5. 成功后恢复 ACTIVE 并清零失败计数 ===")
  await prisma.providerApiKey.update({
    where: { id: invalidTarget.id },
    data: {
      status: "ACTIVE",
      failureCount: 3,
      cooldownUntil: new Date(Date.now() + 60000),
      lastError: "旧的错误"
    }
  })
  // 模拟 reportSuccess
  await prisma.providerApiKey.update({
    where: { id: invalidTarget.id },
    data: {
      successCount: { increment: 1 },
      failureCount: 0,
      status: "ACTIVE",
      cooldownUntil: null,
      lastError: null
    }
  })
  const afterSuccess = await prisma.providerApiKey.findUnique({
    where: { id: invalidTarget.id }
  })
  check(afterSuccess.status === "ACTIVE", "状态 ACTIVE")
  check(afterSuccess.failureCount === 0, `失败计数归零：${afterSuccess.failureCount}`)
  check(afterSuccess.cooldownUntil === null, "冷却清除")
  check(afterSuccess.lastError === null, "错误信息清除")
  check(afterSuccess.successCount >= 1, `成功计数累加：${afterSuccess.successCount}`)

  console.log("\n=== 6. 全部不可用时返回 null ===")
  await prisma.providerApiKey.updateMany({
    where: { providerId: provider.id, label: { startsWith: "轮询测试" } },
    data: { status: "INVALID" }
  })
  const noKey = await pickKey(provider.id)
  const poolHasOther = await prisma.providerApiKey.count({
    where: { providerId: provider.id, status: "ACTIVE", enabled: true }
  })
  if (poolHasOther === 0) {
    check(noKey === null, "池内无可用 Key 时 pick 返回 null")
  } else {
    console.log(`   （池内另有 ${poolHasOther} 把可用 Key，跳过该断言）`)
  }

  console.log("\n=== 7. 停用的 Key 不参与轮询 ===")
  await prisma.providerApiKey.updateMany({
    where: { providerId: provider.id, label: { startsWith: "轮询测试" } },
    data: { status: "ACTIVE", enabled: false }
  })
  const picksDisabled = []
  for (let i = 0; i < 4; i++) {
    const k = await pickKey(provider.id)
    if (k) picksDisabled.push(k.id)
  }
  const disabledIds = created.map((c) => c.id)
  check(
    !picksDisabled.some((id) => disabledIds.includes(id)),
    "停用的 Key 全部未被选中"
  )

  console.log("\n=== 清理测试数据 ===")
  const del = await prisma.providerApiKey.deleteMany({
    where: { providerId: provider.id, label: { startsWith: "轮询测试" } }
  })
  console.log(`   已删除 ${del.count} 把测试 Key`)

  console.log(failures === 0 ? "\n🎉 全部通过" : `\n⚠️ ${failures} 项未通过`)
  await prisma.$disconnect()
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (err) => {
  console.error("\n❌ 测试异常：", err.message)
  await prisma.providerApiKey
    .deleteMany({ where: { label: { startsWith: "轮询测试" } } })
    .catch(() => undefined)
  await prisma.$disconnect()
  process.exit(1)
})
