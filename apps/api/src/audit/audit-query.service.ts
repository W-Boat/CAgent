import { Injectable,NotFoundException } from "@nestjs/common"
import {visibleAuditWhere} from '../common/retired-capabilities'
import { Prisma } from "@prisma/client"
import { PrismaService } from "../prisma/prisma.service"
import { QueryAuditDto } from "./dto/audit.dto"

@Injectable()
export class AuditQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: QueryAuditDto) {
    const where: Prisma.AuditLogWhereInput = {AND:[await visibleAuditWhere(this.prisma)]}
    if (query.action) where.action = query.action
    if (query.resource) where.resource = query.resource
    if (query.resourceId) where.resourceId = query.resourceId
    if (query.userId) where.userId = query.userId
    if (query.onlyFailed === "true") where.success = false
    if (query.keyword) {
      where.OR = [
        { actor: { contains: query.keyword, mode: "insensitive" } },
        { action: { contains: query.keyword, mode: "insensitive" } },
        { resource: { contains: query.keyword, mode: "insensitive" } },
        { resourceId: { contains: query.keyword, mode: "insensitive" } }
      ]
    }

    const range: { gte?: Date; lte?: Date } = {}
    if (query.from) {
      const d = new Date(query.from)
      if (!Number.isNaN(d.getTime())) {
        d.setHours(0, 0, 0, 0)
        range.gte = d
      }
    }
    if (query.to) {
      const d = new Date(query.to)
      if (!Number.isNaN(d.getTime())) {
        d.setHours(23, 59, 59, 999)
        range.lte = d
      }
    }
    if (range.gte || range.lte) where.createdAt = range

    return this.prisma.paginate(
      this.prisma.auditLog,
      {
        where,
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { id: true, email: true, name: true, avatar: true } }
        }
      },
      Number(query.page) || 1,
      Number(query.pageSize) || 20
    )
  }

  /** 可选的动作与资源清单，用于筛选下拉 */
  async facets() {
    const where=await visibleAuditWhere(this.prisma)
    const [actions, resources] = await Promise.all([
      this.prisma.auditLog.groupBy({
        by: ["action"],
        where,
        _count: { _all: true },
        orderBy: { _count: { action: "desc" } },
        take: 100
      }),
      this.prisma.auditLog.groupBy({
        by: ["resource"],
        where,
        _count: { _all: true },
        orderBy: { _count: { resource: "desc" } },
        take: 50
      })
    ])
    return {
      actions: actions.map((a) => ({ value: a.action, count: a._count._all })),
      resources: resources.map((r) => ({
        value: r.resource,
        count: r._count._all
      }))
    }
  }

  async detail(id: string) {
    const row=await this.prisma.auditLog.findFirst({
      where: { id,AND:[await visibleAuditWhere(this.prisma)] },
      include: { user: { select: { id: true, email: true, name: true } } }
    })
    if(!row)throw new NotFoundException('记录不存在')
    return row
  }

  /** 保留策略：清理 N 天前的日志 */
  async purge(beforeDays = 180) {
    const cutoff = new Date(Date.now() - beforeDays * 86400_000)
    const result = await this.prisma.auditLog.deleteMany({
      where: { createdAt: { lt: cutoff } }
    })
    return { deleted: result.count }
  }
}
