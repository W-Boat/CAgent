import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from "@nestjs/common"
import { PrismaService } from "../prisma/prisma.service"
import { AuditService } from "../common/services/audit.service"
import { CreateModelDto, QueryModelDto, UpdateModelDto } from "./dto/model.dto"

@Injectable()
export class ModelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  async list(query: QueryModelDto = {}) {
    const where: any = {}
    if (query.providerId) where.providerId = query.providerId
    if (query.keyword) {
      where.OR = [
        { key: { contains: query.keyword, mode: "insensitive" } },
        { name: { contains: query.keyword, mode: "insensitive" } }
      ]
    }
    if (query.enabled === "true") where.enabled = true
    if (query.enabled === "false") where.enabled = false

    const models = await this.prisma.model.findMany({
      where,
      orderBy: [{ sort: "asc" }, { createdAt: "asc" }],
      include: {
        provider: { select: { id: true, key: true, name: true, type: true, enabled: true } }
      }
    })
    return models.map((m) => ({ ...m, available: m.enabled && m.provider.enabled }))
  }

  /** 提供给对话界面：只返回可用模型 */
  async available() {
    const models = await this.prisma.model.findMany({
      where: { enabled: true, provider: { enabled: true } },
      orderBy: [{ isDefault: "desc" }, { sort: "asc" }],
      include: {
        provider: { select: { id: true, key: true, name: true, type: true } }
      }
    })
    return models.map((m) => ({
      id: m.id,
      key: m.key,
      name: m.name,
      providerKey: m.provider.key,
      providerName: m.provider.name,
      providerType: m.provider.type,
      isDefault: m.isDefault,
      contextWindow: m.contextWindow,
      maxOutputTokens: m.maxOutputTokens,
      supportsVision: m.supportsVision,
      supportsTools: m.supportsTools,
      description: m.description
    }))
  }

  async detail(id: string) {
    const model = await this.prisma.model.findUnique({
      where: { id },
      include: { provider: true }
    })
    if (!model) throw new NotFoundException("模型不存在")
    return model
  }

  async create(dto: CreateModelDto, operator?: { id: string; email: string }) {
    const provider = await this.prisma.provider.findUnique({
      where: { id: dto.providerId }
    })
    if (!provider) throw new BadRequestException("供应商不存在")

    const dup = await this.prisma.model.findFirst({
      where: { providerId: dto.providerId, key: dto.key }
    })
    if (dup) throw new ConflictException("该供应商下已存在同名模型")

    if (dto.isDefault) await this.clearDefault()

    const model = await this.prisma.model.create({
      data: {
        key: dto.key,
        name: dto.name,
        providerId: dto.providerId,
        enabled: dto.enabled ?? true,
        isDefault: dto.isDefault ?? false,
        sort: dto.sort ?? 0,
        contextWindow: dto.contextWindow ?? 8192,
        maxOutputTokens: dto.maxOutputTokens ?? 4096,
        supportsVision: dto.supportsVision ?? false,
        supportsTools: dto.supportsTools ?? false,
        supportsStream: dto.supportsStream ?? true,
        inputPricePerM: dto.inputPricePerM ?? 0,
        outputPricePerM: dto.outputPricePerM ?? 0,
        description: dto.description ?? null,
        extra: (dto.extra ?? undefined) as any
      }
    })

    await this.audit.log({
      userId: operator?.id,
      actor: operator?.email,
      action: "model.create",
      resource: "model",
      resourceId: model.id,
      detail: { key: dto.key, provider: provider.key }
    })
    return model
  }

  async update(
    id: string,
    dto: UpdateModelDto,
    operator?: { id: string; email: string }
  ) {
    const existing = await this.prisma.model.findUnique({ where: { id } })
    if (!existing) throw new NotFoundException("模型不存在")

    if (dto.key && dto.key !== existing.key) {
      const dup = await this.prisma.model.findFirst({
        where: { providerId: existing.providerId, key: dto.key, id: { not: id } }
      })
      if (dup) throw new ConflictException("该供应商下已存在同名模型")
    }

    if (dto.isDefault) await this.clearDefault(id)

    const model = await this.prisma.model.update({
      where: { id },
      data: {
        key: dto.key,
        name: dto.name,
        enabled: dto.enabled,
        isDefault: dto.isDefault,
        sort: dto.sort,
        contextWindow: dto.contextWindow,
        maxOutputTokens: dto.maxOutputTokens,
        supportsVision: dto.supportsVision,
        supportsTools: dto.supportsTools,
        supportsStream: dto.supportsStream,
        inputPricePerM: dto.inputPricePerM,
        outputPricePerM: dto.outputPricePerM,
        description: dto.description,
        extra: dto.extra === undefined ? undefined : (dto.extra as any)
      }
    })

    await this.audit.log({
      userId: operator?.id,
      actor: operator?.email,
      action: "model.update",
      resource: "model",
      resourceId: id,
      detail: { fields: Object.keys(dto) }
    })
    return model
  }

  async remove(id: string, operator?: { id: string; email: string }) {
    const model = await this.prisma.model.findUnique({ where: { id } })
    if (!model) throw new NotFoundException("模型不存在")

    await this.prisma.model.delete({ where: { id } })
    await this.audit.log({
      userId: operator?.id,
      actor: operator?.email,
      action: "model.delete",
      resource: "model",
      resourceId: id,
      detail: { key: model.key }
    })
    return { success: true }
  }

  async toggle(
    id: string,
    enabled: boolean,
    operator?: { id: string; email: string }
  ) {
    const model = await this.prisma.model.update({
      where: { id },
      data: { enabled }
    })
    await this.audit.log({
      userId: operator?.id,
      actor: operator?.email,
      action: "model.toggle",
      resource: "model",
      resourceId: id,
      detail: { enabled }
    })
    return model
  }

  /** 设为默认模型 */
  async setDefault(id: string, operator?: { id: string; email: string }) {
    await this.clearDefault(id)
    const model = await this.prisma.model.update({
      where: { id },
      data: { isDefault: true, enabled: true }
    })
    await this.audit.log({
      userId: operator?.id,
      actor: operator?.email,
      action: "model.set_default",
      resource: "model",
      resourceId: id
    })
    return model
  }

  private async clearDefault(exceptId?: string) {
    await this.prisma.model.updateMany({
      where: { isDefault: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
      data: { isDefault: false }
    })
  }
}