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
import { ModelsService } from "./models.service"
import {
  CreateModelDto,
  QueryModelDto,
  UpdateModelDto
} from "./dto/model.dto"
import { RequirePermissions } from "../common/decorators/permissions.decorator"
import {
  CurrentUser,
  type AuthUser
} from "../common/decorators/current-user.decorator"

@ApiTags("模型管理")
@ApiBearerAuth()
@Controller("models")
export class ModelsController {
  constructor(private readonly models: ModelsService) {}

  @Get()
  @RequirePermissions("model:read")
  @ApiOperation({ summary: "模型列表（后台）" })
  list(@Query() query: QueryModelDto) {
    return this.models.list(query)
  }

  @Get("available")
  @ApiOperation({ summary: "可用模型列表（对话界面使用）" })
  available() {
    return this.models.available()
  }

  @Get(":id")
  @RequirePermissions("model:read")
  @ApiOperation({ summary: "模型详情" })
  detail(@Param("id") id: string) {
    return this.models.detail(id)
  }

  @Post()
  @RequirePermissions("model:write")
  @ApiOperation({ summary: "新建模型" })
  create(@Body() dto: CreateModelDto, @CurrentUser() me: AuthUser) {
    return this.models.create(dto, { id: me.id, email: me.email })
  }

  @Patch(":id")
  @RequirePermissions("model:write")
  @ApiOperation({ summary: "编辑模型" })
  update(
    @Param("id") id: string,
    @Body() dto: UpdateModelDto,
    @CurrentUser() me: AuthUser
  ) {
    return this.models.update(id, dto, { id: me.id, email: me.email })
  }

  @Patch(":id/toggle")
  @RequirePermissions("model:write")
  @ApiOperation({ summary: "启用/禁用模型" })
  toggle(
    @Param("id") id: string,
    @Body("enabled") enabled: boolean,
    @CurrentUser() me: AuthUser
  ) {
    return this.models.toggle(id, enabled, { id: me.id, email: me.email })
  }

  @Patch(":id/default")
  @RequirePermissions("model:write")
  @ApiOperation({ summary: "设为默认模型" })
  setDefault(@Param("id") id: string, @CurrentUser() me: AuthUser) {
    return this.models.setDefault(id, { id: me.id, email: me.email })
  }

  @Delete(":id")
  @RequirePermissions("model:delete")
  @ApiOperation({ summary: "删除模型" })
  remove(@Param("id") id: string, @CurrentUser() me: AuthUser) {
    return this.models.remove(id, { id: me.id, email: me.email })
  }
}