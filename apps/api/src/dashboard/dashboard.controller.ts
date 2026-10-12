import { Controller, Get, Query } from "@nestjs/common"
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger"
import { DashboardService } from "./dashboard.service"
import { RequirePermissions } from "../common/decorators/permissions.decorator"
import {
  CurrentUser,
  type AuthUser
} from "../common/decorators/current-user.decorator"

@ApiTags("数据看板")
@ApiBearerAuth()
@Controller("dashboard")
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get("mine")
  @ApiOperation({ summary: "我的工作台概览" })
  mine(@CurrentUser() me: AuthUser) {
    return this.dashboard.mine(me.id)
  }

  @Get("summary")
  @RequirePermissions("dashboard:read")
  @ApiOperation({ summary: "核心指标" })
  summary() {
    return this.dashboard.summary()
  }

  @Get("trends")
  @RequirePermissions("dashboard:read")
  @ApiOperation({ summary: "趋势数据" })
  trends(@Query("days") days?: string) {
    return this.dashboard.trends(Number(days) || 14)
  }

  @Get("rankings")
  @RequirePermissions("dashboard:read")
  @ApiOperation({ summary: "排行榜" })
  rankings() {
    return this.dashboard.rankings()
  }

  @Get("activity")
  @RequirePermissions("dashboard:read")
  @ApiOperation({ summary: "最近操作流水" })
  activity(@Query("limit") limit?: string) {
    return this.dashboard.recentActivity(Number(limit) || 15)
  }
}