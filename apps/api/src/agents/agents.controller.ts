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
import { AgentsService } from "./agents.service"
import {
  CreateAgentDto,
  QueryAgentDto,
  UpdateAgentDto
} from "./dto/agent.dto"
import { RequirePermissions } from "../common/decorators/permissions.decorator"
import {
  CurrentUser,
  type AuthUser
} from "../common/decorators/current-user.decorator"

@ApiTags("智能体")
@ApiBearerAuth()
@Controller("agents")
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Get("available")
  @ApiOperation({ summary: "可用智能体列表（对话界面）" })
  available() {
    return this.agents.available()
  }

  @Get()
  @RequirePermissions("agent:read")
  @ApiOperation({ summary: "智能体列表（后台）" })
  list(@Query() query: QueryAgentDto) {
    return this.agents.list(query)
  }

  @Get(":id")
  @RequirePermissions("agent:read")
  @ApiOperation({ summary: "智能体详情" })
  detail(@Param("id") id: string) {
    return this.agents.detail(id)
  }

  @Post()
  @RequirePermissions("agent:create")
  @ApiOperation({ summary: "新建智能体" })
  create(@Body() dto: CreateAgentDto, @CurrentUser() me: AuthUser) {
    return this.agents.create(dto, { id: me.id, email: me.email })
  }

  @Patch(":id")
  @RequirePermissions("agent:update")
  @ApiOperation({ summary: "编辑智能体" })
  update(
    @Param("id") id: string,
    @Body() dto: UpdateAgentDto,
    @CurrentUser() me: AuthUser
  ) {
    return this.agents.update(id, dto, { id: me.id, email: me.email })
  }

  @Patch(":id/toggle")
  @RequirePermissions("agent:update")
  @ApiOperation({ summary: "启用/禁用智能体" })
  toggle(
    @Param("id") id: string,
    @Body("enabled") enabled: boolean,
    @CurrentUser() me: AuthUser
  ) {
    return this.agents.toggle(id, enabled, { id: me.id, email: me.email })
  }

  @Delete(":id")
  @RequirePermissions("agent:delete")
  @ApiOperation({ summary: "删除智能体" })
  remove(@Param("id") id: string, @CurrentUser() me: AuthUser) {
    return this.agents.remove(id, { id: me.id, email: me.email })
  }
}