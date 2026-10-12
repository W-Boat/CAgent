import { Controller, Get, Param, Query } from "@nestjs/common"
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger"
import { AuditQueryService } from "./audit-query.service"
import { QueryAuditDto } from "./dto/audit.dto"
import { RequirePermissions } from "../common/decorators/permissions.decorator"

@ApiTags("审计日志")
@ApiBearerAuth()
@Controller("audit-logs")
export class AuditController {
  constructor(private readonly audit: AuditQueryService) {}

  @Get()
  @RequirePermissions("audit:read")
  @ApiOperation({ summary: "审计日志列表" })
  list(@Query() query: QueryAuditDto) {
    return this.audit.list(query)
  }

  @Get("facets")
  @RequirePermissions("audit:read")
  @ApiOperation({ summary: "动作/资源筛选项" })
  facets() {
    return this.audit.facets()
  }

  @Get(":id")
  @RequirePermissions("audit:read")
  @ApiOperation({ summary: "审计日志详情" })
  detail(@Param("id") id: string) {
    return this.audit.detail(id)
  }
}