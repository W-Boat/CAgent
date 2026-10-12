import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req
} from "@nestjs/common"
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger"
import type { Request } from "express"
import { AuthService } from "./auth.service"
import {
  ChangePasswordDto,
  LoginDto,
  RefreshTokenDto,
  RegisterDto,
  UpdateProfileDto
} from "./dto/auth.dto"
import { Public } from "../common/decorators/public.decorator"
import {
  CurrentUser,
  type AuthUser
} from "../common/decorators/current-user.decorator"

function clientMeta(req: Request) {
  return {
    ip:
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      undefined,
    userAgent: req.headers["user-agent"]
  }
}

@ApiTags("认证")
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("login")
  @ApiOperation({ summary: "登录" })
  login(@Body() dto: LoginDto, @Req() req: Request) {
    const { ip, userAgent } = clientMeta(req)
    return this.auth.login(dto, ip, userAgent)
  }

  @Public()
  @Post("register")
  @ApiOperation({ summary: "注册" })
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    const { ip, userAgent } = clientMeta(req)
    return this.auth.register(dto, ip, userAgent)
  }

  @Public()
  @Post("refresh")
  @ApiOperation({ summary: "刷新访问令牌" })
  refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    const { ip, userAgent } = clientMeta(req)
    return this.auth.refresh(dto.refreshToken, ip, userAgent)
  }

  @ApiBearerAuth()
  @Post("logout")
  @ApiOperation({ summary: "退出登录" })
  logout(@Body() dto: RefreshTokenDto, @CurrentUser() user: AuthUser) {
    return this.auth.logout(dto.refreshToken, user.id)
  }

  @ApiBearerAuth()
  @Post("logout-all")
  @ApiOperation({ summary: "退出所有设备" })
  logoutAll(@CurrentUser() user: AuthUser) {
    return this.auth.logoutAll(user.id)
  }

  @ApiBearerAuth()
  @Get("me")
  @ApiOperation({ summary: "当前登录用户与权限" })
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id)
  }

  @ApiBearerAuth()
  @Get("profile")
  @ApiOperation({ summary: "个人资料与配额" })
  profile(@CurrentUser() user: AuthUser) {
    return this.auth.profile(user.id)
  }

  @ApiBearerAuth()
  @Patch("profile")
  @ApiOperation({ summary: "更新个人资料" })
  updateProfile(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateProfileDto
  ) {
    return this.auth.updateProfile(user.id, dto)
  }

  @ApiBearerAuth()
  @Post("change-password")
  @ApiOperation({ summary: "修改密码" })
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto
  ) {
    return this.auth.changePassword(user.id, dto)
  }
}