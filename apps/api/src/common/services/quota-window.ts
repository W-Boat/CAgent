import type { PrismaClient } from '@prisma/client'

export const DAILY_QUOTA_RESET_KEY = 'daily_quota_reset_at'
const DAY_MS = 86_400_000, SHANGHAI_OFFSET_MS = 8 * 3_600_000

/** Campus quota days follow Asia/Shanghai, regardless of the server timezone. */
export function shanghaiDayStart(now = new Date()): Date {
  return new Date(Math.floor((now.getTime() + SHANGHAI_OFFSET_MS) / DAY_MS) * DAY_MS - SHANGHAI_OFFSET_MS)
}

/** A reset changes counting only; historical usage and feedback stay intact. */
export function dailyQuotaCutoff(resetValue: unknown, now = new Date()): Date {
  const start = shanghaiDayStart(now)
  const reset = typeof resetValue === 'string' ? Date.parse(resetValue) : NaN
  return Number.isFinite(reset) && reset <= now.getTime() && reset > start.getTime() ? new Date(reset) : start
}

export async function dailyQuotaStart(prisma: Pick<PrismaClient, 'setting'>, now = new Date()): Promise<Date> {
  const setting = await prisma.setting.findUnique({ where: { key: DAILY_QUOTA_RESET_KEY }, select: { value: true } })
  return dailyQuotaCutoff(setting?.value, now)
}
