import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post
} from "@nestjs/common"
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger"
import { RolesService } from "./roles.service"
import { CreateRoleDto, UpdateRoleDto } from "./dto/role.dto"
import { RequirePermissions } from "../common/decorators/permissions.decorator"
import {
  CurrentUser,
  type AuthUser
} from "../common/decorators/current-user.decorator"

@ApiTags("角色权限")
@ApiBearerAuth()
@Controller("roles")
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermissions("role:read")
  @ApiOperation({ summary: "角色列表" })
  list() {
    return this.roles.list()
  }

  @Get("permissions")
  @RequirePermissions("permission:read")
  @ApiOperation({ summary: "权限目录（分组）" })
  permissionCatalog() {
    return this.roles.permissionCatalog()
  }

  @Get(":id")
  @RequirePermissions("role:read")
  @ApiOperation({ summary: "角色详情" })
  detail(@Param("id") id: string) {
    return this.roles.detail(id)
  }

  @Post()
  @RequirePermissions("role:create")
  @ApiOperation({ summary: "新建角色" })
  create(@Body() dto: CreateRoleDto, @CurrentUser() me: AuthUser) {
    return this.roles.create(dto, { id: me.id, email: me.email })
  }

  @Patch(":id")
  @RequirePermissions("role:update")
  @ApiOperation({ summary: "编辑角色与授权" })
  update(
    @Param("id") id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() me: AuthUser
  ) {
    return this.roles.update(id, dto, { id: me.id, email: me.email })
  }

  @Delete(":id")
  @RequirePermissions("role:delete")
  @ApiOperation({ summary: "删除角色" })
  remove(@Param("id") id: string, @CurrentUser() me: AuthUser) {
    return this.roles.remove(id, { id: me.id, email: me.email })
  }
}