import { Body, Controller, Post, Res } from "@nestjs/common"
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger"
import type { Response } from "express"
import { ChatService } from "./chat.service"
import { RegenerateDto, SendMessageDto, TestModelDto } from "./dto/chat.dto"
import { RequirePermissions } from "../common/decorators/permissions.decorator"
import {
  CurrentUser,
  type AuthUser
} from "../common/decorators/current-user.decorator"

@ApiTags("对话")
@ApiBearerAuth()
@Controller("chat")
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post("completions")
  @ApiOperation({
    summary: "流式对话（SSE）",
    description:
      "事件序列：meta → text/reasoning/tool_call/tool_start/tool_result → usage → done"
  })
  completions(
    @Body() dto: SendMessageDto,
    @CurrentUser() me: AuthUser,
    @Res() res: Response
  ) {
    return this.chat.streamChat(me, dto, res)
  }

  @Post("regenerate")
  @ApiOperation({ summary: "重新生成回复（SSE）" })
  regenerate(
    @Body() dto: RegenerateDto,
    @CurrentUser() me: AuthUser,
    @Res() res: Response
  ) {
    return this.chat.regenerate(me, dto, res)
  }

  @Post("complete")
  @ApiOperation({ summary: "非流式补全（内部调用/调试）" })
  complete(
    @Body() dto: SendMessageDto,
    @CurrentUser() me: AuthUser
  ) {
    return this.chat.complete({
      userId:me.id,
      modelId: dto.modelId,
      temperature: dto.temperature,
      messages: [{ role: "user", content: dto.content }]
    })
  }

  @Post("suggest-agent")
  @ApiOperation({
    summary: "语义路由：结合上下文建议更适合的智能体",
    description:
      "学生端不给选智能体，答不上来或不对口时由它给出「建议交给谁 + 理由」，" +
      "前端展示为一条可供学生确认的意见。判不出来时 suggestion 为 null。"
  })
  suggestAgent(
    @Body() dto: { conversationId?: string; content: string },
    @CurrentUser() me: AuthUser
  ) {
    /*
     * 不需要额外权限码：这是学生端对话流程的一部分，
     * 所有能对话的登录用户都该能用。
     */
    return this.chat.suggestAgent(me, dto)
  }

  @Post("test-model")
  @RequirePermissions("model:test")
  @ApiOperation({ summary: "测试模型连通性" })
  testModel(@Body() dto: TestModelDto) {
    return this.chat.testModel(dto)
  }
}
