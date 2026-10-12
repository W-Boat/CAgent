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
import { UsersService } from "./users.service"
import {
  CreateUserDto,
  QueryUserDto,
  ResetPasswordDto,
  SetStatusDto,
  UpdateUserDto
} from "./dto/user.dto"
import { RequirePermissions } from "../common/decorators/permissions.decorator"
import {
  CurrentUser,
  type AuthUser
} from "../common/decorators/current-user.decorator"

@ApiTags("用户管理")
@ApiBearerAuth()
@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions("user:read")
  @ApiOperation({ summary: "用户列表" })
  list(@Query() query: QueryUserDto) {
    return this.users.list(query)
  }

  @Get("departments")
  @RequirePermissions("user:read")
  @ApiOperation({ summary: "院系/部门列表" })
  departments() {
    return this.users.departments()
  }

  @Get(":id")
  @RequirePermissions("user:read")
  @ApiOperation({ summary: "用户详情" })
  detail(@Param("id") id: string) {
    return this.users.detail(id)
  }

  @Post()
  @RequirePermissions("user:create")
  @ApiOperation({ summary: "新建用户" })
  create(@Body() dto: CreateUserDto, @CurrentUser() me: AuthUser) {
    return this.users.create(dto, { id: me.id, email: me.email })
  }

  @Patch(":id")
  @RequirePermissions("user:update")
  @ApiOperation({ summary: "编辑用户" })
  update(
    @Param("id") id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() me: AuthUser
  ) {
    return this.users.update(id, dto, { id: me.id, email: me.email })
  }

  @Delete(":id")
  @RequirePermissions("user:delete")
  @ApiOperation({ summary: "删除用户" })
  remove(@Param("id") id: string, @CurrentUser() me: AuthUser) {
    return this.users.remove(id, { id: me.id, email: me.email })
  }

  @Patch(":id/status")
  @RequirePermissions("user:status")
  @ApiOperation({ summary: "启用/禁用用户" })
  setStatus(
    @Param("id") id: string,
    @Body() dto: SetStatusDto,
    @CurrentUser() me: AuthUser
  ) {
    return this.users.setStatus(id, dto.status, {
      id: me.id,
      email: me.email
    })
  }

  @Post(":id/reset-password")
  @RequirePermissions("user:password")
  @ApiOperation({ summary: "重置用户密码" })
  resetPassword(
    @Param("id") id: string,
    @Body() dto: ResetPasswordDto,
    @CurrentUser() me: AuthUser
  ) {
    return this.users.resetPassword(id, dto.password, {
      id: me.id,
      email: me.email
    })
  }
}