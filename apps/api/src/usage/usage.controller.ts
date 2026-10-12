import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query
} from "@nestjs/common"
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger"
import { UsageService } from "./usage.service"
import { BatchQuotaDto, QueryUsageDto, UpdateQuotaDto } from "./dto/usage.dto"
import { RequirePermissions } from "../common/decorators/permissions.decorator"
import {
  CurrentUser,
  type AuthUser
} from "../common/decorators/current-user.decorator"

@ApiTags("用量与配额")
@ApiBearerAuth()
@Controller("usage")
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  // ---------- 个人用量 ----------

  @Get("me")
  @ApiOperation({ summary: "我的用量概览" })
  async mine(@CurrentUser() me: AuthUser, @Query() query: QueryUsageDto) {
    const [overview, trend, byModel] = await Promise.all([
      this.usage.overview(query, me.id),
      this.usage.trend(query, me.id),
      this.usage.byModel(query, me.id)
    ])
    return { overview, trend, byModel }
  }

  @Get("me/records")
  @ApiOperation({ summary: "我的调用明细" })
  myRecords(@CurrentUser() me: AuthUser, @Query() query: QueryUsageDto) {
    return this.usage.listRecords(query, me.id)
  }

  @Get("me/quota")
  @ApiOperation({ summary: "我的配额" })
  myQuota(@CurrentUser() me: AuthUser) {
    return this.usage.getQuota(me.id)
  }

  // ---------- 管理端 ----------

  @Get("overview")
  @RequirePermissions("usage:read:all")
  @ApiOperation({ summary: "全局用量概览" })
  async overview(@Query() query: QueryUsageDto) {
    const [overview, trend, bySource, byModel, byUser] = await Promise.all([
      this.usage.overview(query),
      this.usage.trend(query),
      this.usage.overview(query),
      this.usage.byModel(query),
      this.usage.byUser(query)
    ])
    return { overview, trend, source: bySource.bySource, byModel, byUser }
  }

  @Get("records")
  @RequirePermissions("usage:read:all")
  @ApiOperation({ summary: "调用明细（全员）" })
  records(@Query() query: QueryUsageDto) {
    return this.usage.listRecords(query)
  }

  @Get("by-model")
  @RequirePermissions("usage:read:all")
  @ApiOperation({ summary: "按模型统计" })
  byModel(@Query() query: QueryUsageDto) {
    return this.usage.byModel(query)
  }

  @Get("by-user")
  @RequirePermissions("usage:read:all")
  @ApiOperation({ summary: "按用户统计" })
  byUser(@Query() query: QueryUsageDto) {
    return this.usage.byUser(query)
  }

  @Get("quotas")
  @RequirePermissions("quota:read")
  @ApiOperation({ summary: "配额列表" })
  quotas(
    @Query("keyword") keyword?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string
  ) {
    return this.usage.listQuotas(
      keyword,
      Number(page) || 1,
      Number(pageSize) || 20
    )
  }

  @Get("quotas/:userId")
  @RequirePermissions("quota:read")
  @ApiOperation({ summary: "查看某用户配额与消耗" })
  quota(@Param("userId") userId: string) {
    return this.usage.getQuota(userId)
  }

  @Patch("quotas/:userId")
  @RequirePermissions("quota:write")
  @ApiOperation({ summary: "设置某用户配额" })
  setQuota(
    @Param("userId") userId: string,
    @Body() dto: UpdateQuotaDto,
    @CurrentUser() me: AuthUser
  ) {
    return this.usage.setQuota(userId, dto, { id: me.id, email: me.email })
  }

  @Post("quotas/batch")
  @RequirePermissions("quota:write")
  @ApiOperation({ summary: "批量设置配额（按用户/角色/院系）" })
  batch(@Body() dto: BatchQuotaDto, @CurrentUser() me: AuthUser) {
    return this.usage.batchSetQuota(dto, { id: me.id, email: me.email })
  }
}