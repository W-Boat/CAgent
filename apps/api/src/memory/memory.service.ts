import { ForbiddenException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common"
import {SettingsService} from '../settings/settings.service'
import { PrismaService } from "../prisma/prisma.service"
import { MemorySource, MemoryStatus, UserMemory } from "@prisma/client"

@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name)

  constructor(private prisma: PrismaService, @Optional() private settings?:SettingsService) {}

  async enabled(){return !this.settings || await this.settings.get('memory_enabled')!==false}
  private async assertEnabled(){if(!await this.enabled())throw new ForbiddenException('全站记忆功能已关闭')}

  /**
   * 为用户创建或更新记忆
   */
  async upsertMemory(params: {
    userId: string
    agentId?: string
    content: string
    category?: string
    importance?: number
    source?: MemorySource
    sourceConversationId?: string
    sourceMessageId?: string
    expiresAt?: Date
  }): Promise<UserMemory> {
    await this.assertEnabled()
    const {
      userId,
      agentId,
      content,
      category = "general",
      importance = 3,
      source = MemorySource.USER_EXPLICIT,
      sourceConversationId,
      sourceMessageId,
      expiresAt
    } = params

    // 查找是否已存在相同内容的记忆
    const existing = await this.prisma.userMemory.findFirst({
      where: {
        userId,
        agentId: agentId || null,
        content,
        status: MemoryStatus.ACTIVE
      }
    })

    if (existing) {
      // 更新现有记忆的使用次数和时间
      return this.prisma.userMemory.update({
        where: { id: existing.id },
        data: {
          usedCount: { increment: 1 },
          updatedAt: new Date()
        }
      })
    }

    // 创建新记忆
    return this.prisma.userMemory.create({
      data: {
        userId,
        agentId: agentId || null,
        content,
        category,
        importance,
        source,
        status: MemoryStatus.ACTIVE,
        sourceConversationId,
        sourceMessageId,
        expiresAt
      }
    })
  }

  /**
   * 获取用户的活跃记忆列表
   */
  async getUserMemories(
    userId: string,
    agentId?: string,
    limit: number = 50,
    includeAllAgents=false
  ): Promise<UserMemory[]> {
    if(!await this.enabled())return []
    const where: any = {
      userId,
      status: MemoryStatus.ACTIVE
    }

    where.AND=[{OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]},...(agentId?[{OR:[{agentId:null},{agentId}]}]:includeAllAgents?[]:[{agentId:null}])]

    return this.prisma.userMemory.findMany({
      where,
      orderBy: [
        { importance: "desc" },
        { usedCount: "desc" },
        { updatedAt: "desc" }
      ],
      take: limit
    })
  }

  /**
   * 构建记忆提示词（注入到系统提示词）
   */
  async buildMemoryPrompt(userId: string, agentId?: string): Promise<string> {
    const memories = await this.getUserMemories(userId, agentId, 20)

    if (memories.length === 0) {
      return ""
    }

    // 按类别分组（同句去重：自动提取与手动录入可能撞句）
    const grouped = memories.reduce(
      (acc, mem) => {
        const content = (mem.content || "").trim()
        if (!content) return acc
        acc[mem.category] = acc[mem.category] || { list: [] as string[], seen: new Set<string>() }
        const key = content.toLowerCase()
        if (acc[mem.category].seen.has(key)) return acc
        acc[mem.category].seen.add(key)
        acc[mem.category].list.push(content)
        return acc
      },
      {} as Record<string, { list: string[]; seen: Set<string> }>
    )

    // 构建提示词
    const sections: string[] = ["【用户记忆】", "以下是关于当前用户的重要信息，请在回答时参考："]

    const categoryNames: Record<string, string> = {
      general: "基本信息",
      name: "姓名",
      preference: "偏好",
      fact: "事实",
      context: "背景",
      other: "其他"
    }

    for (const [category, bucket] of Object.entries(grouped)) {
      const categoryName = categoryNames[category] || category
      sections.push(`\n${categoryName}：`)
      bucket.list.forEach((content, idx) => {
        sections.push(`${idx + 1}. ${content}`)
      })
    }

    // 更新使用次数（异步，不阻塞）
    this.prisma.userMemory
      .updateMany({
        where: {
          id: { in: memories.map((m) => m.id) }
        },
        data: {
          usedCount: { increment: 1 }
        }
      })
      .catch((err) => {
        this.logger.warn(`更新记忆使用次数失败: ${(err as Error).message}`)
      })

    /*
     * 限长：记忆是长期累积的，注入不加限制会缓慢吃掉每次对话的上下文预算。
     * 超出时截断（记忆按重要性/使用次数/时间排序，截断保留的正是最重要的部分）。
     */
    const prompt = sections.join("\n")
    const MAX_CHARS = 1400
    return prompt.length > MAX_CHARS ? `${prompt.slice(0, MAX_CHARS)}\n（其余记忆已省略）` : prompt
  }

  /**
   * 删除记忆
   */
  async deleteMemory(memoryId: string, userId: string): Promise<void> {
    const memory = await this.prisma.userMemory.findFirst({
      where: {
        id: memoryId,
        userId
      }
    })

    if (!memory) {
      throw new NotFoundException("记忆不存在或无权删除")
    }

    await this.prisma.userMemory.update({
      where: { id: memoryId },
      data: {
        status: MemoryStatus.ARCHIVED
      }
    })
  }

  /**
   * 批量删除记忆
   */
  async batchDeleteMemories(memoryIds: string[], userId: string): Promise<void> {
    await this.prisma.userMemory.updateMany({
      where: {
        id: { in: memoryIds },
        userId
      },
      data: {
        status: MemoryStatus.ARCHIVED
      }
    })
  }

  /**
   * 更新记忆
   */
  async updateMemory(
    memoryId: string,
    userId: string,
    data: {
      content?: string
      category?: string
      importance?: number
      expiresAt?: Date | null
    }
  ): Promise<UserMemory> {
    await this.assertEnabled()
    const memory = await this.prisma.userMemory.findFirst({
      where: {
        id: memoryId,
        userId
      }
    })

    if (!memory) {
      throw new NotFoundException("记忆不存在或无权修改")
    }

    return this.prisma.userMemory.update({
      where: { id: memoryId },
      data
    })
  }

  /**
   * 获取记忆统计
   */
  async getMemoryStats(userId: string) {
    if(!await this.enabled())return {enabled:false,total:0,active:0,archived:0,byCategory:[]}
    const [total, active, archived, byCategory] = await Promise.all([
      this.prisma.userMemory.count({
        where: { userId }
      }),
      this.prisma.userMemory.count({
        where: { userId, status: MemoryStatus.ACTIVE }
      }),
      this.prisma.userMemory.count({
        where: { userId, status: MemoryStatus.ARCHIVED }
      }),
      this.prisma.userMemory.groupBy({
        by: ["category"],
        where: { userId, status: MemoryStatus.ACTIVE },
        _count: {
          _all: true
        }
      })
    ])

    return {
      enabled:true,
      total,
      active,
      archived,
      byCategory: byCategory.map((item) => ({
        category: item.category,
        count: item._count._all
      }))
    }
  }
}
