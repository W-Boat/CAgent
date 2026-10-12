import {
  BadRequestException,
  Injectable,
  NotFoundException
} from "@nestjs/common"
import { Prisma } from "@prisma/client"
import {visibleCapabilityWhere,isRetiredCapability,assertVisibleCapability} from '../common/retired-capabilities'
import { PrismaService } from "../prisma/prisma.service"
import { AuditService } from "../common/services/audit.service"
import {
  CreateAgentDto,
  QueryAgentDto,
  UpdateAgentDto
} from "./dto/agent.dto"

@Injectable()
export class AgentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  async list(query: QueryAgentDto = {}) {
    const where: Prisma.AgentWhereInput = {...visibleCapabilityWhere}
    if (query.keyword) {
      where.OR = [
        { key: { contains: query.keyword, mode: "insensitive" } },
        { name: { contains: query.keyword, mode: "insensitive" } },
        { description: { contains: query.keyword, mode: "insensitive" } }
      ]
    }
    if (query.enabled === "true") where.enabled = true
    if (query.enabled === "false") where.enabled = false
    if (query.visibility) where.visibility = query.visibility

    const agents = await this.prisma.agent.findMany({
      where,
      orderBy: [{ sort: "asc" }, { createdAt: "asc" }],
      include: {
        model: { select: { id: true, name: true, key: true } },
        skills: { include: { skill: { select: { id: true, key: true, name: true, type: true } } } },
        _count: { select: { conversations: true } }
      }
    })

    return agents.filter(a=>!isRetiredCapability(a)).map((a) => ({
      ...a,
      skills: a.skills.map((s) => s.skill).filter(s=>!isRetiredCapability(s)),
      conversationCount: a._count.conversations
    }))
  }

  /** 对话界面：当前用户可见且启用的智能体 */
  async available() {
    const agents = await this.prisma.agent.findMany({
      where: { ...visibleCapabilityWhere,enabled: true, visibility: { in: ["CAMPUS", "PUBLIC"] } },
      orderBy: [{ sort: "asc" }, { createdAt: "asc" }],
      include: {
        model: { select: { id: true, name: true, key: true } },
        skills: {
          include: {
            skill: {
              select: {
                id: true,
                key: true,
                name: true,
                description: true,
                type: true,
                icon: true,
                enabled: true
              }
            }
          }
        }
      }
    })

    /*
     * 「可用清单」不再做任何 key 级过滤：功能开关可见性过滤已随
     * 情侣空间（loveline）功能移除。已停用的智能体行由 enabled=false
     * 与前端 api 层的 HIDDEN_PATTERNS 兜底（见 apps/web/src/api/index.ts）。
     */
    return agents.filter(a=>!isRetiredCapability(a)).map((a) => ({
      id: a.id,
      key: a.key,
      name: a.name,
      description: a.description,
      avatar: a.avatar,
      greeting: a.greeting,
      starters: a.starters,
      visibility: a.visibility,
      modelId: a.modelId,
      modelName: a.model?.name ?? null,
      allowBrowser: a.allowBrowser,
      skills: a.skills.map((s) => s.skill).filter((s) => s.enabled&&!isRetiredCapability(s))
    }))
  }

  async detail(id: string) {
    const agent = await this.prisma.agent.findUnique({
      where: { id },
      include: {
        model: { select: { id: true, name: true, key: true } },
        skills: { include: { skill: true } },
        _count: { select: { conversations: true } }
      }
    })
    if (!agent) throw new NotFoundException("智能体不存在")
    assertVisibleCapability(agent)
    return {
      ...agent,
      skills: agent.skills.map((s) => s.skill).filter(s=>!isRetiredCapability(s)),
      conversationCount: agent._count.conversations
    }
  }

  async findByKey(key: string) {
    if(isRetiredCapability({key}))return null
    const agent=await this.prisma.agent.findUnique({
      where: { key },
      include: {
        model: true,
        skills: { include: { skill: true } }
      }
    })
    if(!agent||isRetiredCapability(agent))return null
    agent.skills=agent.skills.filter(s=>!isRetiredCapability(s.skill))
    return agent
  }

  async create(dto: CreateAgentDto, operator?: { id: string; email: string }) {
    assertVisibleCapability(dto)
    const key = dto.key.trim()
    if(dto.skillIds?.length&&await this.prisma.skill.count({where:{...visibleCapabilityWhere,id:{in:dto.skillIds}}})!==new Set(dto.skillIds).size)throw new BadRequestException('存在已下线或无效的技能')
    const exists = await this.prisma.agent.findUnique({ where: { key } })
    if (exists) throw new BadRequestException("该智能体标识已存在")

    if (dto.modelId) await this.assertModel(dto.modelId)

    const agent = await this.prisma.agent.create({
      data: {
        key,
        name: dto.name,
        description: dto.description ?? null,
        avatar: dto.avatar ?? null,
        systemPrompt: dto.systemPrompt,
        greeting: dto.greeting ?? null,
        starters: (dto.starters ?? []) as any,
        modelId: dto.modelId ?? null,
        temperature: dto.temperature ?? 0.7,
        maxContextMessages: dto.maxContextMessages ?? 20,
        visibility: dto.visibility ?? "PUBLIC",
        enabled: dto.enabled ?? true,
        allowBrowser: dto.allowBrowser ?? false,
        mode: dto.mode ?? "AGENT",
        maxToolRounds: dto.maxToolRounds ?? 5,
        note: dto.note ?? null,
        sort: dto.sort ?? 0,
        ownerId: operator?.id ?? null,
        skills: dto.skillIds?.length
          ? { create: dto.skillIds.map((skillId) => ({ skillId })) }
          : undefined
      }
    })

    await this.audit.log({
      userId: operator?.id,
      actor: operator?.email,
      action: "agent.create",
      resource: "agent",
      resourceId: agent.id,
      detail: { key }
    })
    return this.detail(agent.id)
  }

  async update(
    id: string,
    dto: UpdateAgentDto,
    operator?: { id: string; email: string }
  ) {
    const agent = await this.prisma.agent.findUnique({ where: { id } })
    if (!agent) throw new NotFoundException("智能体不存在")
    assertVisibleCapability(agent)
    assertVisibleCapability({...agent,...dto})

    if (dto.modelId) await this.assertModel(dto.modelId)

    if (dto.skillIds) {
      if(dto.skillIds.length&&await this.prisma.skill.count({where:{...visibleCapabilityWhere,id:{in:dto.skillIds}}})!==new Set(dto.skillIds).size)throw new BadRequestException('存在已下线或无效的技能')
      await this.prisma.agentSkill.deleteMany({ where: { agentId: id } })
      if (dto.skillIds.length > 0) {
        const count = await this.prisma.skill.count({
          where: { ...visibleCapabilityWhere,id: { in: dto.skillIds } }
        })
        if (count !== dto.skillIds.length) {
          throw new BadRequestException("存在无效的技能 id")
        }
        await this.prisma.agentSkill.createMany({
          data: dto.skillIds.map((skillId) => ({ agentId: id, skillId })),
          skipDuplicates: true
        })
      }
    }

    await this.prisma.agent.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        avatar: dto.avatar,
        systemPrompt: dto.systemPrompt,
        greeting: dto.greeting,
        starters: dto.starters === undefined ? undefined : (dto.starters as any),
        modelId: dto.modelId === undefined ? undefined : dto.modelId || null,
        temperature: dto.temperature,
        maxContextMessages: dto.maxContextMessages,
        visibility: dto.visibility,
        enabled: dto.enabled,
        allowBrowser: dto.allowBrowser,
        mode: dto.mode,
        maxToolRounds: dto.maxToolRounds,
        note: dto.note,
        sort: dto.sort
      }
    })

    await this.audit.log({
      userId: operator?.id,
      actor: operator?.email,
      action: "agent.update",
      resource: "agent",
      resourceId: id,
      detail: { fields: Object.keys(dto) }
    })
    return this.detail(id)
  }

  async remove(id: string, operator?: { id: string; email: string }) {
    const agent = await this.prisma.agent.findUnique({ where: { id } })
    if (!agent) throw new NotFoundException("智能体不存在")
    assertVisibleCapability(agent)
    if (agent.isSystem) throw new BadRequestException("内置智能体不可删除，可将其禁用")

    await this.prisma.agent.delete({ where: { id } })
    await this.audit.log({
      userId: operator?.id,
      actor: operator?.email,
      action: "agent.delete",
      resource: "agent",
      resourceId: id,
      detail: { key: agent.key }
    })
    return { success: true }
  }

  async toggle(
    id: string,
    enabled: boolean,
    operator?: { id: string; email: string }
  ) {
    await this.detail(id)
    const agent = await this.prisma.agent.update({
      where: { id },
      data: { enabled }
    })
    await this.audit.log({
      userId: operator?.id,
      actor: operator?.email,
      action: "agent.toggle",
      resource: "agent",
      resourceId: id,
      detail: { enabled }
    })
    return agent
  }

  private async assertModel(modelId: string) {
    const model = await this.prisma.model.findUnique({ where: { id: modelId } })
    if (!model) throw new BadRequestException("指定的模型不存在")
  }
}
