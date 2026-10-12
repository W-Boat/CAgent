import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query
} from "@nestjs/common"
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger"
import { ConversationsService } from "./conversations.service"
import {
  CreateConversationDto,
  FlagMessageDto,
  QueryConversationDto,
  QueryMessageDto,
  UpdateConversationDto
} from "./dto/conversation.dto"
import { RequirePermissions } from "../common/decorators/permissions.decorator"
import {
  CurrentUser,
  type AuthUser
} from "../common/decorators/current-user.decorator"

@ApiTags("会话")
@ApiBearerAuth()
@Controller("conversations")
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  // ---------- 后台审计（必须声明在 :id 路由之前，否则 /admin/messages 会被 :id/messages 截获） ----------

  @Get("admin/all")
  @RequirePermissions("conversation:read")
  @ApiOperation({ summary: "全部会话（后台审计）" })
  listAll(@Query() query: QueryConversationDto) {
    return this.conversations.listAll(query)
  }

  @Get("admin/messages")
  @RequirePermissions("message:read")
  @ApiOperation({ summary: "全局消息检索" })
  searchMessages(@Query() query: QueryMessageDto) {
    return this.conversations.searchMessages(query)
  }

  @Post("admin/messages/:id/flag")
  @RequirePermissions("message:flag")
  @ApiOperation({ summary: "标记/取消标记消息" })
  flagMessage(
    @Param("id") id: string,
    @Body() dto: FlagMessageDto,
    @CurrentUser() me: AuthUser
  ) {
    return this.conversations.flagMessage(id, dto.flagged, dto.note, {
      id: me.id,
      email: me.email
    })
  }

  @Get("admin/:id/export")
  @RequirePermissions("conversation:export")
  @ApiOperation({ summary: "导出会话 JSON" })
  exportConversation(@Param("id") id: string) {
    return this.conversations.exportConversation(id)
  }

  // ---------- 用户侧 ----------

  @Get()
  @ApiOperation({ summary: "我的会话列表" })
  listMine(
    @CurrentUser() me: AuthUser,
    @Query() query: QueryConversationDto
  ) {
    return this.conversations.listMine(me.id, query)
  }

  @Post()
  @ApiOperation({ summary: "新建会话" })
  create(@CurrentUser() me: AuthUser, @Body() dto: CreateConversationDto) {
    return this.conversations.create(me.id, dto)
  }

  @Get(":id")
  @ApiOperation({ summary: "会话详情（含消息）" })
  async detail(@Param("id") id: string, @CurrentUser() me: AuthUser) {
    const canAudit = me.permissions.includes("*") ||
      me.permissions.includes("message:read")
    await this.conversations.assertAccess(id, me.id, canAudit)
    return this.conversations.detail(id)
  }

  @Get(':id/messages/:messageId/versions')
  answerVersions(@Param('id') id:string,@Param('messageId') messageId:string,@CurrentUser() me:AuthUser){return this.conversations.answerVersions(id,messageId,me.id)}
  @Post(':id/messages/:messageId/versions/:index')
  selectAnswerVersion(@Param('id') id:string,@Param('messageId') messageId:string,@Param('index') index:string,@CurrentUser() me:AuthUser){return this.conversations.selectAnswerVersion(id,messageId,me.id,Number(index))}

  @Get(":id/messages")
  @ApiOperation({ summary: "会话消息列表" })
  async messages(
    @Param("id") id: string,
    @CurrentUser() me: AuthUser,
    @Query() query: QueryMessageDto
  ) {
    const canAudit = me.permissions.includes("*") ||
      me.permissions.includes("message:read")
    await this.conversations.assertAccess(id, me.id, canAudit)
    return this.conversations.listMessages(id, query)
  }

  @Patch(":id")
  @ApiOperation({ summary: "更新会话（标题/模型/置顶）" })
  async update(
    @Param("id") id: string,
    @Body() dto: UpdateConversationDto,
    @CurrentUser() me: AuthUser
  ) {
    await this.conversations.assertAccess(id, me.id)
    return this.conversations.update(id, dto)
  }

  @Delete(":id")
  @ApiOperation({ summary: "删除会话" })
  async remove(@Param("id") id: string, @CurrentUser() me: AuthUser) {
    await this.conversations.assertAccess(id, me.id)
    return this.conversations.remove(id, { id: me.id, email: me.email })
  }
}