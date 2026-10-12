import {versions} from '../chat/answer-versions'
import { Injectable, NotFoundException, BadRequestException, ConflictException } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import {visibleCapabilityWhere,visibleConversationWhere,assertVisibleCapability} from '../common/retired-capabilities'
import { PrismaService } from "../prisma/prisma.service"
import { AuditService } from "../common/services/audit.service"
import {stripToolMarkup} from '../presentation/output-boundary'
const visibleMessage=<T extends {role:string;content:string;reasoning:string|null}>(message:T):T=>message.role==='assistant'?{...message,content:stripToolMarkup(message.content),reasoning:message.reasoning?stripToolMarkup(message.reasoning):message.reasoning}:message
import {
  CreateConversationDto,
  QueryConversationDto,
  QueryMessageDto,
  UpdateConversationDto
} from "./dto/conversation.dto"

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  /** 用户自己的会话列表 */
  async listMine(userId: string, query: QueryConversationDto) {
    const where: Prisma.ConversationWhereInput = {
      AND:[visibleConversationWhere],
      userId,
      evaluationJobId:null,
      status: query.status ?? { not: "DELETED" }
    }
    if (query.keyword) {
      where.title = { contains: query.keyword, mode: "insensitive" }
    }

    const result = await this.prisma.paginate(
      this.prisma.conversation,
      {
        where,
        orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
        include: {
          model: { select: { id: true, name: true, key: true } },
          agent: { select: { id: true, name: true, avatar: true } }
        }
      },
      Number(query.page) || 1,
      Number(query.pageSize) || 50
    )
    return result
  }

  /** 后台：全量会话审计列表 */
  async listAll(query: QueryConversationDto) {
    const where: Prisma.ConversationWhereInput = {AND:[visibleConversationWhere]}
    if (query.userId) where.userId = query.userId
    if (query.status) where.status = query.status
    if (query.keyword) {
      where.OR = [
        { title: { contains: query.keyword, mode: "insensitive" } },
        {
          user: {
            OR: [
              { email: { contains: query.keyword, mode: "insensitive" } },
              { name: { contains: query.keyword, mode: "insensitive" } }
            ]
          }
        }
      ]
    }

    return this.prisma.paginate(
      this.prisma.conversation,
      {
        where,
        orderBy: { updatedAt: "desc" },
        include: {
          user: {
            select: { id: true, email: true, name: true, department: true }
          },
          model: { select: { id: true, name: true, key: true } },
          agent: { select: { id: true, name: true } },
          _count: { select: { messages: true } }
        }
      },
      Number(query.page) || 1,
      Number(query.pageSize) || 20
    )
  }

  async detail(id: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id,AND:[visibleConversationWhere] },
      include: {
        user: { select: { id: true, email: true, name: true } },
        model: true,
        agent: { select: { id: true, name: true } },
        messages: { orderBy: { seq: "asc" } }
      }
    })
    if (!conversation) throw new NotFoundException("会话不存在")
    if(conversation.agent)assertVisibleCapability(conversation.agent)
    return {...conversation,messages:conversation.messages.map(visibleMessage)}
  }

  /** 校验归属：非本人则需具备审计权限 */
  async assertAccess(id: string, userId: string, canAudit = false) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id,AND:[visibleConversationWhere] },
      select: { id: true, userId: true, status: true,agent:{select:{key:true,name:true}} }
    })
    if (!conversation || conversation.status === "DELETED") {
      throw new NotFoundException("会话不存在")
    }
    if (conversation.userId !== userId && !canAudit) {
      throw new NotFoundException("会话不存在")
    }
    if(conversation.agent)assertVisibleCapability(conversation.agent)
    return conversation
  }

  async create(userId: string, dto: CreateConversationDto) {
    if(dto.agentId&&!await this.prisma.agent.findFirst({where:{...visibleCapabilityWhere,id:dto.agentId},select:{id:true}}))throw new NotFoundException('智能体不存在')
    const modelId =
      dto.modelId || (await this.defaultModelId()) || undefined

    return this.prisma.conversation.create({
      data: {
        userId,
        title: dto.title || "新对话",
        modelId: modelId ?? null,
        agentId: dto.agentId ?? null,
        systemPrompt: dto.systemPrompt ?? null
      },
      include: {
        model: { select: { id: true, name: true, key: true } },
        agent: { select: { id: true, name: true, avatar: true } }
      }
    })
  }

  async update(id: string, dto: UpdateConversationDto) {
    return this.prisma.conversation.update({
      where: { id },
      data: {
        title: dto.title,
        modelId: dto.modelId,
        systemPrompt: dto.systemPrompt,
        temperature: dto.temperature,
        pinned: dto.pinned,
        status: dto.status
      }
    })
  }

  /** 软删除，保留审计数据 */
  async remove(id: string, operator?: { id: string; email: string }) {
    await this.prisma.conversation.update({
      where: { id },
      data: { status: "DELETED" }
    })
    await this.audit.log({
      userId: operator?.id,
      actor: operator?.email,
      action: "conversation.delete",
      resource: "conversation",
      resourceId: id
    })
    return { success: true }
  }

  async removeMany(ids: string[], operator?: { id: string; email: string }) {
    await this.prisma.conversation.updateMany({
      where: { id: { in: ids } },
      data: { status: "DELETED" }
    })
    await this.audit.log({
      userId: operator?.id,
      actor: operator?.email,
      action: "conversation.delete_many",
      resource: "conversation",
      detail: { count: ids.length }
    })
    return { success: true, count: ids.length }
  }

  /** 后台全局消息检索 */
  async searchMessages(query: QueryMessageDto) {
    const where: Prisma.MessageWhereInput = {conversation:{is:visibleConversationWhere}}
    if (query.keyword) {
      where.content = { contains: query.keyword, mode: "insensitive" }
    }
    if (query.conversationId) where.conversationId = query.conversationId
    if (query.userId) where.userId = query.userId
    if (query.flagged === "true") where.flagged = true
    if (query.flagged === "false") where.flagged = false
    if (query.role) where.role = query.role as any

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
      this.prisma.message,
      {
        where,
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { id: true, email: true, name: true } },
          conversation: { select: { id: true, title: true } }
        }
      },
      Number(query.page) || 1,
      Number(query.pageSize) || 20
    )
  }

  async answerVersions(conversationId:string,messageId:string,userId:string){
   const message=await this.prisma.message.findFirst({where:{id:messageId,conversationId,userId,role:'assistant',conversation:{status:{not:'DELETED'}}}})
   if(!message)throw new NotFoundException('回答不存在')
   const {list,selected}=versions(message);return {selected,items:list.map((v:any,index:number)=>({index,createdAt:v.createdAt,status:v.data.status}))}
  }
  async selectAnswerVersion(conversationId:string,messageId:string,userId:string,index:number){
   if(!Number.isInteger(index)||index<0)throw new BadRequestException('版本无效')
   return this.prisma.$transaction(async tx=>{
    const lock=await tx.$queryRaw`SELECT id FROM conversations WHERE id=${conversationId} AND user_id=${userId} AND status <> 'DELETED' FOR UPDATE`
    if(!(lock as any[]).length)throw new NotFoundException('会话不存在')
    if(await tx.message.findFirst({where:{conversationId,role:'assistant',status:'STREAMING'}}))throw new ConflictException('请等待当前回答生成完成')
    const message=await tx.message.findFirst({where:{id:messageId,conversationId,userId,role:'assistant'}});if(!message)throw new NotFoundException('回答不存在')
    const {list}=versions(message);if(index>=list.length)throw new BadRequestException('版本不存在')
    const data=list[index].data;return visibleMessage(await tx.message.update({where:{id:messageId},data:{...data,toolCalls:data.toolCalls??Prisma.DbNull,attachments:{...data.attachments,answerVersions:list,selectedAnswerVersion:index}}}))
   })
  }

  async listMessages(conversationId: string, query: QueryMessageDto) {
    const where: Prisma.MessageWhereInput = { conversationId }
    if (query.keyword) {
      where.content = { contains: query.keyword, mode: "insensitive" }
    }
    if (query.flagged === "true") where.flagged = true

    if (query.latest === "true" || query.beforeSeq !== undefined || query.beforeId) {
      if (query.beforeId) {
        const cursor = await this.prisma.message.findUnique({ where: { id: query.beforeId }, select: { seq: true, createdAt: true, conversationId: true } })
        if (!cursor || cursor.conversationId !== conversationId) throw new NotFoundException('消息游标已失效，请重新加载对话')
        where.OR = [
          { seq: { lt: cursor.seq } },
          { seq: cursor.seq, createdAt: { lt: cursor.createdAt } },
          { seq: cursor.seq, createdAt: cursor.createdAt, id: { lt: query.beforeId } }
        ]
      } else if (query.beforeSeq !== undefined) where.seq = { lt: query.beforeSeq }
      const pageSize = Math.max(1, Math.min(100, Math.floor(Number(query.pageSize) || 100)))
      const [rows, total] = await Promise.all([
        this.prisma.message.findMany({ where, orderBy: [{ seq: "desc" }, { createdAt: "desc" }, { id: "desc" }], take: pageSize + 1 }),
        this.prisma.message.count({ where })
      ])
      const hasMore = rows.length > pageSize
      const items = rows.slice(0, pageSize).reverse().map(visibleMessage)
      return { items, total, page: 1, pageSize, hasMore, nextBeforeSeq: items[0]?.seq ?? null, nextBeforeId: items[0]?.id ?? null }
    }

    const result=await this.prisma.paginate(
      this.prisma.message,
      { where, orderBy: { seq: "asc" } },
      Number(query.page) || 1,
      Number(query.pageSize) || 100
    )
    return {...result,items:result.items.map(visibleMessage)}
  }

  async flagMessage(
    messageId: string,
    flagged: boolean,
    note?: string,
    operator?: { id: string; email: string }
  ) {
    const message = await this.prisma.message.update({
      where: { id: messageId },
      data: { flagged, flagNote: note ?? null }
    })
    await this.audit.log({
      userId: operator?.id,
      actor: operator?.email,
      action: flagged ? "message.flag" : "message.unflag",
      resource: "message",
      resourceId: messageId,
      detail: { note }
    })
    return message
  }

  /** 导出会话（JSON），用于审计留档 */
  async exportConversation(id: string) {
    const conversation = await this.detail(id)
    return {
      exportedAt: new Date().toISOString(),
      conversation: {
        id: conversation.id,
        title: conversation.title,
        user: conversation.user,
        model: conversation.model?.key ?? null,
        agent: conversation.agent?.name ?? null,
        createdAt: conversation.createdAt,
        messageCount: conversation.messages.length
      },
      messages: conversation.messages.map((m) => ({
        seq: m.seq,
        role: m.role,
        content: m.content,
        reasoning: m.reasoning,
        status: m.status,
        tokens: m.totalTokens,
        model: m.modelKey,
        flagged: m.flagged,
        createdAt: m.createdAt
      }))
    }
  }

  async defaultModelId(): Promise<string | null> {
    const model =
      (await this.prisma.model.findFirst({
        where: { isDefault: true, enabled: true, provider: { enabled: true } },
        select: { id: true }
      })) ||
      (await this.prisma.model.findFirst({
        where: { enabled: true, provider: { enabled: true } },
        orderBy: { sort: "asc" },
        select: { id: true }
      }))
    return model?.id ?? null
  }
}
