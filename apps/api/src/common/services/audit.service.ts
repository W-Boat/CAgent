import { Injectable, Logger } from "@nestjs/common"
import { PrismaService } from "../../prisma/prisma.service"

export interface AuditEntry {
  userId?: string | null
  actor?: string | null
  action: string
  resource: string
  resourceId?: string | null
  detail?: unknown
  ip?: string | null
  userAgent?: string | null
  success?: boolean
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name)

  constructor(private readonly prisma: PrismaService) {}

  /** 写审计日志（失败不影响主流程） */
  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: entry.userId ?? null,
          actor: entry.actor ?? null,
          action: entry.action,
          resource: entry.resource,
          resourceId: entry.resourceId ?? null,
          detail: (entry.detail ?? undefined) as any,
          ip: entry.ip ?? null,
          userAgent: entry.userAgent ?? null,
          success: entry.success ?? true
        }
      })
    } catch (err) {
      this.logger.warn(`写入审计日志失败: ${(err as Error).message}`)
    }
  }
}