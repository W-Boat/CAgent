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
import { LearningService, FEEDBACK_REASONS } from "./learning.service"
import {
  QueryLearningDto,
  ReviewLearningDto,
  SubmitFeedbackDto
} from "./dto/learning.dto"
import { RequirePermissions } from "../common/decorators/permissions.decorator"
import {
  CurrentUser,
  type AuthUser
} from "../common/decorators/current-user.decorator"

@ApiTags("自学习反馈")
@ApiBearerAuth()
@Controller("learning")
export class LearningController {
  constructor(private readonly learning: LearningService) {}

  // ---------- 用户侧 ----------

  @Get("reasons")
  @ApiOperation({ summary: "可选的点踩原因（供前端下拉）" })
  reasons() {
    return FEEDBACK_REASONS
  }

  @Post("feedback")
  @ApiOperation({ summary: "对某条助手回复点赞/点踩，可附上正确答案" })
  submit(@Body() dto: SubmitFeedbackDto, @CurrentUser() me: AuthUser) {
    return this.learning.submit(me.id, dto)
  }

  @Get("feedback/:messageId")
  @ApiOperation({ summary: "查询当前用户对某条消息的评价" })
  forMessage(@Param("messageId") messageId: string, @CurrentUser() me: AuthUser) {
    return this.learning.forMessage(me.id, messageId)
  }

  @Delete("feedback/:messageId")
  @ApiOperation({ summary: "撤销自己的评价" })
  revoke(@Param("messageId") messageId: string, @CurrentUser() me: AuthUser) {
    return this.learning.revoke(me.id, messageId)
  }

  // ---------- 管理侧 ----------

  @Get("overview")
  @RequirePermissions("learning:read")
  @ApiOperation({ summary: "学习概览：待审数量、反馈趋势、被踩最多的智能体" })
  overview(@Query("days") days?: string) {
    return this.learning.overview(Number(days) || 7)
  }

  @Get("items")
  @RequirePermissions("learning:read")
  @ApiOperation({ summary: "学习条目列表" })
  list(@Query() query: QueryLearningDto) {
    return this.learning.list(query)
  }

  @Patch("items/:id")
  @RequirePermissions("learning:review")
  @ApiOperation({ summary: "审核学习条目（通过后才会注入智能体提示词）" })
  review(
    @Param("id") id: string,
    @Body() dto: ReviewLearningDto,
    @CurrentUser() me: AuthUser
  ) {
    return this.learning.review(id, dto.status, { id: me.id, email: me.email }, {
      instruction: dto.instruction,
      kind: dto.kind
      ,pinAnswer:dto.pinAnswer,fixedAnswer:dto.fixedAnswer
    })
  }

  @Delete("items/:id")
  @RequirePermissions("learning:review")
  @ApiOperation({ summary: "删除学习条目" })
  remove(@Param("id") id: string, @CurrentUser() me: AuthUser) {
    return this.learning.remove(id, { id: me.id, email: me.email })
  }
}
