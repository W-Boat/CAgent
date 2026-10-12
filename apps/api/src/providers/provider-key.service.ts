import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common"
import { ApiKeyStatus, Prisma } from "@prisma/client"
import { PrismaService } from "../prisma/prisma.service"
import { CryptoService } from "../common/services/crypto.service"
import { AuditService } from "../common/services/audit.service"

/** 挑选 Key 时的返回结构 */
export interface ResolvedKey {
  keyId: string
  apiKey: string
  label: string | null
}

/** 限流类错误的冷却时长：逐步退避，避免刚解冻就又被限 */
const COOLDOWN_STEPS_MS = [
  60_000, // 1 分钟
  5 * 60_000, // 5 分钟
  15 * 60_000, // 15 分钟
  60 * 60_000 // 1 小时
]

/**
 * 供应商 Key 池。
 *
 * 一个供应商可配多把 Key，按「健康 + 最久未使用」轮询挑选，用于：
 *   1. 分摊配额，降低单 Key 被限流的概率
 *   2. 某把 Key 失效时限流时自动切换，对话不中断
 *
 * 健康判定：
 *   - 命中 401/403 → INVALID（认证失败，需人工换 Key，不再自动使用）
 *   - 命中 429/限流 → COOLDOWN（按失败次数退避，到期自动恢复 ACTIVE）
 *   - 成功一次 → 清零失败计数并恢复 ACTIVE
 */
@Injectable()
export class ProviderKeyService {
  private readonly logger = new Logger(ProviderKeyService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService
  ) {}

  // ---------- 管理侧 ----------

  /** 列出某供应商的 Key（永不回传明文，只给掩码） */
  async list(providerId: string) {
    const keys = await this.prisma.providerApiKey.findMany({
      where: { providerId },
      orderBy: [{ sort: "asc" }, { createdAt: "asc" }]
    })

    return keys.map((k) => this.toPublic(k))
  }

  /** 新增一把 Key */
  async create(
    providerId: string,
    payload: { apiKey: string; label?: string; enabled?: boolean },
    actor?: { id: string; email: string }
  ) {
    const plain = (payload.apiKey || "").trim()
    if (!plain) throw new BadRequestException("API Key 不能为空")
    if (plain.length > 400) throw new BadRequestException("API Key 过长")

    await this.assertProviderExists(providerId)

    const dup = await this.findDuplicate(providerId, plain)
    if (dup) throw new BadRequestException("该 Key 已存在于这个供应商下")

    const count = await this.prisma.providerApiKey.count({ where: { providerId } })

    const created = await this.prisma.providerApiKey.create({
      data: {
        providerId,
        label: payload.label?.trim() || null,
        apiKey: this.crypto.encrypt(plain),
        enabled: payload.enabled ?? true,
        status: ApiKeyStatus.ACTIVE,
        sort: count
      }
    })

    await this.auditLog(actor, "provider.key.create", providerId, {
      keyId: created.id,
      label: created.label
    })

    return this.toPublic(created)
  }

  /** 编辑：换 Key / 改备注 / 启停 / 重置状态 */
  async update(
    providerId: string,
    keyId: string,
    payload: {
      apiKey?: string
      label?: string
      enabled?: boolean
      status?: ApiKeyStatus
      sort?: number
    },
    actor?: { id: string; email: string }
  ) {
    await this.assertKeyOwnership(providerId, keyId)

    const data: Record<string, unknown> = {}

    if (payload.label !== undefined) data.label = payload.label?.trim() || null
    if (payload.sort !== undefined) data.sort = payload.sort
    if (payload.enabled !== undefined) data.enabled = payload.enabled

    // 手动改状态：清掉冷却与失败计数，便于「我知道已经恢复了」的场景
    if (payload.status !== undefined) {
      data.status = payload.status
      if (payload.status === ApiKeyStatus.ACTIVE) {
        data.cooldownUntil = null
        data.failureCount = 0
        data.lastError = null
      }
    }

    if (payload.apiKey !== undefined) {
      const plain = payload.apiKey.trim()
      if (!plain) throw new BadRequestException("API Key 不能为空")
      const dup = await this.findDuplicate(providerId, plain, keyId)
      if (dup) throw new BadRequestException("该 Key 已存在于这个供应商下")
      data.apiKey = this.crypto.encrypt(plain)
      // 换 Key 后重置健康状态，让新 Key 立刻参与轮询
      data.status = ApiKeyStatus.ACTIVE
      data.cooldownUntil = null
      data.failureCount = 0
      data.lastError = null
    }

    const updated = await this.prisma.providerApiKey.update({
      where: { id: keyId },
      data
    })

    await this.auditLog(actor, "provider.key.update", providerId, { keyId })

    return this.toPublic(updated)
  }

  async remove(
    providerId: string,
    keyId: string,
    actor?: { id: string; email: string }
  ) {
    await this.assertKeyOwnership(providerId, keyId)
    await this.prisma.providerApiKey.delete({ where: { id: keyId } })
    await this.auditLog(actor, "provider.key.delete", providerId, { keyId })
    return { success: true }
  }

  /** 把旧的单 Key（Provider.apiKey）迁移进 Key 池 */
  async migrateLegacyKey(
    providerId: string,
    actor?: { id: string; email: string }
  ) {
    const provider = await this.prisma.provider.findUnique({ where: { id: providerId } })
    if (!provider) throw new NotFoundException("供应商不存在")
    if (!provider.apiKey) throw new BadRequestException("该供应商没有旧格式的 Key 可迁移")

    const plain = this.crypto.decrypt(provider.apiKey)
    if (!plain) {
      throw new BadRequestException(
        "旧 Key 无法解密（可能更换过 ENCRYPTION_KEY），请直接在 Key 池里重新添加"
      )
    }

    const dup = await this.findDuplicate(providerId, plain)
    if (dup) throw new BadRequestException("该 Key 已在 Key 池中")

    const count = await this.prisma.providerApiKey.count({ where: { providerId } })
    const created = await this.prisma.providerApiKey.create({
      data: {
        providerId,
        label: "迁移自主配置",
        apiKey: this.crypto.encrypt(plain),
        enabled: true,
        status: ApiKeyStatus.ACTIVE,
        sort: count
      }
    })

    await this.auditLog(actor, "provider.key.migrate", providerId, { keyId: created.id })

    return this.toPublic(created)
  }

  // ---------- 运行时：轮询挑选 ----------

  /**
   * 挑一把可用的 Key。
   *
   * 策略：在「启用 + ACTIVE + 未冷却」的 Key 里选 lastUsedAt 最早的那把。
   *
   * 这里有两个必须绕开的坑，否则「轮询」会退化成「每次都选同一把」：
   *
   *   1. **NULL 排序**：PostgreSQL 的 `ORDER BY x ASC` 默认 NULLS LAST，
   *      于是从未使用过的 Key（null）反而排在已用过的后面，
   *      新加的 Key 永远轮不到。必须显式 `NULLS FIRST`。
   *      Prisma 的 orderBy 无法表达，只能用原生 SQL。
   *
   *   2. **时间戳精度**：lastUsedAt 是毫秒精度，同一毫秒内的连续挑选
   *      会写入相同时间，排序持平后退化到 sort（固定值），又变成只选一把。
   *      写回时用 Date.now() + 1 保证严格单调递增。
   */
  async pick(
    providerId: string,
    excludeKeyIds: string[] = []
  ): Promise<ResolvedKey | null> {
    // 先做一次惰性恢复：冷却到期的 COOLDOWN 回到 ACTIVE
    await this.reviveCooledDown(providerId)

    const now = new Date()
    // 参数全部走占位符，避免拼接注入
    const excludeClause = excludeKeyIds.length
      ? Prisma.sql`AND id NOT IN (${Prisma.join(excludeKeyIds)})`
      : Prisma.empty

    const rows = await this.prisma.$queryRaw<
      { id: string; api_key: string; label: string | null }[]
    >(Prisma.sql`
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

    for (const row of rows) {
      const plain = this.crypto.decrypt(row.api_key)
      if (!plain) {
        // 解不开说明 ENCRYPTION_KEY 变过，标记为失效避免反复尝试
        await this.prisma.providerApiKey.update({
          where: { id: row.id },
          data: {
            status: ApiKeyStatus.INVALID,
            lastError: "无法解密（ENCRYPTION_KEY 可能已变更）",
            lastErrorAt: new Date()
          }
        })
        this.logger.warn(`Key ${row.id} 解密失败，已标记为 INVALID`)
        continue
      }

      // 写回一个严格大于当前时刻的时间戳，保证下次必然轮到别的 Key
      await this.prisma.providerApiKey.update({
        where: { id: row.id },
        data: { lastUsedAt: new Date(Date.now() + 1) }
      })

      return { keyId: row.id, apiKey: plain, label: row.label }
    }

    return null
  }

  /** 池子里是否已经有 Key（决定是否回退到旧字段） */
  async hasPool(providerId: string): Promise<boolean> {
    const count = await this.prisma.providerApiKey.count({ where: { providerId } })
    return count > 0
  }

  /** 上报使用成功 */
  async reportSuccess(keyId: string) {
    await this.prisma.providerApiKey.updateMany({
      where: { id: keyId },
      data: {
        successCount: { increment: 1 },
        failureCount: 0,
        status: ApiKeyStatus.ACTIVE,
        cooldownUntil: null,
        lastError: null
      }
    })
  }

  /**
   * 上报使用失败。
   *
   * 按错误类型分级处理：
   *   - 401/403 认证失败 → INVALID，不再自动使用（避免一直撞墙）
   *   - 429/限流 → COOLDOWN，按失败次数退避
   *   - 其他（网络抖动、5xx）→ 只记数，不做状态变更，让它继续参与轮询
   */
  async reportFailure(keyId: string, error: string) {
    const key = await this.prisma.providerApiKey.findUnique({ where: { id: keyId } })
    if (!key) return

    const nextFailure = key.failureCount + 1
    const message = (error || "").slice(0, 500)

    const isAuthError =
      /\b(401|403)\b/.test(message) ||
      /invalid.*api.?key|unauthorized|authentication|incorrect api key/i.test(message)
    const isRateLimit =
      /\b429\b/.test(message) ||
      /rate.?limit|too many requests|quota|exceeded|insufficient/i.test(message)

    if (isAuthError) {
      await this.prisma.providerApiKey.update({
        where: { id: keyId },
        data: {
          status: ApiKeyStatus.INVALID,
          failureCount: nextFailure,
          lastError: message,
          lastErrorAt: new Date()
        }
      })
      this.logger.warn(`Key ${keyId} 认证失败，已停用：${message}`)
      return
    }

    if (isRateLimit) {
      const step = COOLDOWN_STEPS_MS[Math.min(nextFailure - 1, COOLDOWN_STEPS_MS.length - 1)]
      await this.prisma.providerApiKey.update({
        where: { id: keyId },
        data: {
          status: ApiKeyStatus.COOLDOWN,
          failureCount: nextFailure,
          lastError: message,
          lastErrorAt: new Date(),
          cooldownUntil: new Date(Date.now() + step)
        }
      })
      this.logger.warn(`Key ${keyId} 触发限流，冷却 ${Math.round(step / 1000)}s`)
      return
    }

    // 其他错误：只记录，保持 ACTIVE（多数是网络抖动，不该因此下线一把好 Key）
    await this.prisma.providerApiKey.update({
      where: { id: keyId },
      data: {
        failureCount: nextFailure,
        lastError: message,
        lastErrorAt: new Date()
      }
    })
  }

  /** 冷却到期的 Key 恢复为 ACTIVE */
  async reviveCooledDown(providerId?: string) {
    const res = await this.prisma.providerApiKey.updateMany({
      where: {
        ...(providerId ? { providerId } : {}),
        status: ApiKeyStatus.COOLDOWN,
        cooldownUntil: { lte: new Date() }
      },
      data: { status: ApiKeyStatus.ACTIVE, cooldownUntil: null }
    })
    if (res.count > 0) {
      this.logger.log(`恢复 ${res.count} 把冷却到期的 Key`)
    }
    return res.count
  }

  /** 池子健康概览，供管理页展示 */
  async stats(providerId: string) {
    const keys = await this.prisma.providerApiKey.findMany({
      where: { providerId },
      select: { status: true, enabled: true, failureCount: true, successCount: true }
    })

    const byStatus: Record<string, number> = {}
    for (const k of keys) {
      const label = !k.enabled ? "DISABLED" : k.status
      byStatus[label] = (byStatus[label] || 0) + 1
    }

    return {
      total: keys.length,
      available: keys.filter((k) => k.enabled && k.status === "ACTIVE").length,
      byStatus,
      totalSuccess: keys.reduce((s, k) => s + k.successCount, 0),
      totalFailure: keys.reduce((s, k) => s + k.failureCount, 0)
    }
  }

  // ---------- 内部 ----------

  private toPublic(k: {
    id: string
    providerId: string
    label: string | null
    apiKey: string
    enabled: boolean
    status: ApiKeyStatus
    sort: number
    failureCount: number
    successCount: number
    lastUsedAt: Date | null
    lastErrorAt: Date | null
    lastError: string | null
    cooldownUntil: Date | null
    createdAt: Date
    updatedAt: Date
  }) {
    return {
      id: k.id,
      providerId: k.providerId,
      label: k.label,
      enabled: k.enabled,
      status: k.enabled ? k.status : "DISABLED",
      sort: k.sort,
      failureCount: k.failureCount,
      successCount: k.successCount,
      lastUsedAt: k.lastUsedAt,
      lastErrorAt: k.lastErrorAt,
      lastError: k.lastError,
      cooldownUntil: k.cooldownUntil,
      createdAt: k.createdAt,
      updatedAt: k.updatedAt,
      /** 只给掩码，明文永不回传 */
      masked: this.crypto.mask(k.apiKey)
    }
  }

  private async assertProviderExists(providerId: string) {
    const p = await this.prisma.provider.findUnique({
      where: { id: providerId },
      select: { id: true }
    })
    if (!p) throw new NotFoundException("供应商不存在")
  }

  private async assertKeyOwnership(providerId: string, keyId: string) {
    const key = await this.prisma.providerApiKey.findUnique({
      where: { id: keyId },
      select: { id: true, providerId: true }
    })
    if (!key || key.providerId !== providerId) {
      throw new NotFoundException("该 Key 不属于此供应商")
    }
  }

  /** 去重：解密已有 Key 比对明文（Key 数量有限，成本可接受） */
  private async findDuplicate(providerId: string, plain: string, excludeId?: string) {
    const existing = await this.prisma.providerApiKey.findMany({
      where: { providerId, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true, apiKey: true }
    })
    return existing.find((k) => this.crypto.decrypt(k.apiKey) === plain) || null
  }

  private async auditLog(
    actor: { id: string; email: string } | undefined,
    action: string,
    providerId: string,
    detail: Record<string, unknown>
  ) {
    if (!actor) return
    // 审计失败不该影响主流程（AuditService 内部已吞异常）
    await this.audit.log({
      userId: actor.id,
      actor: actor.email,
      action,
      resource: "provider",
      resourceId: providerId,
      detail,
      success: true
    })
  }
}
