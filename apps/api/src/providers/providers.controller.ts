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
import { ApiKeyStatus } from "@prisma/client"
import { ProvidersService } from "./providers.service"
import { ProviderKeyService } from "./provider-key.service"
import { CreateProviderDto, UpdateProviderDto } from "./dto/provider.dto"
import { RequirePermissions } from "../common/decorators/permissions.decorator"
import {
  CurrentUser,
  type AuthUser
} from "../common/decorators/current-user.decorator"

@ApiTags("模型供应商")
@ApiBearerAuth()
@Controller("providers")
export class ProvidersController {
  constructor(
    private readonly providers: ProvidersService,
    private readonly keys: ProviderKeyService
  ) {}

  @Get()
  @RequirePermissions("provider:read")
  @ApiOperation({ summary: "供应商列表" })
  list() {
    return this.providers.list()
  }

  // ---------- Key 池（在线配置 + 轮询） ----------
  // 注意：这些静态子路径必须声明在 :id 之前，否则会被当成供应商 ID

  @Get(":id/keys")
  @RequirePermissions("provider:read")
  @ApiOperation({
    summary: "供应商的 Key 池",
    description:
      "多把 Key 轮询使用：分摊配额、单 Key 失效时自动切换。密钥只回传掩码，明文不出服务端。"
  })
  listKeys(@Param("id") id: string) {
    return this.keys.list(id)
  }

  @Get(":id/keys/stats")
  @RequirePermissions("provider:read")
  @ApiOperation({ summary: "Key 池健康概览" })
  keyStats(@Param("id") id: string) {
    return this.keys.stats(id)
  }

  @Post(":id/keys")
  @RequirePermissions("provider:write")
  @ApiOperation({ summary: "新增一把 Key" })
  addKey(
    @Param("id") id: string,
    @Body() body: { apiKey: string; label?: string; enabled?: boolean },
    @CurrentUser() me: AuthUser
  ) {
    return this.keys.create(id, body, { id: me.id, email: me.email })
  }

  @Patch(":id/keys/:keyId")
  @RequirePermissions("provider:write")
  @ApiOperation({
    summary: "编辑 Key（换密钥 / 改备注 / 启停 / 重置状态）",
    description:
      "status 传 ACTIVE 可手动清除冷却与失败计数，用于「确认已恢复」的场景。"
  })
  updateKey(
    @Param("id") id: string,
    @Param("keyId") keyId: string,
    @Body()
    body: {
      apiKey?: string
      label?: string
      enabled?: boolean
      status?: ApiKeyStatus
      sort?: number
    },
    @CurrentUser() me: AuthUser
  ) {
    return this.keys.update(id, keyId, body, { id: me.id, email: me.email })
  }

  @Delete(":id/keys/:keyId")
  @RequirePermissions("provider:write")
  @ApiOperation({ summary: "删除一把 Key" })
  removeKey(
    @Param("id") id: string,
    @Param("keyId") keyId: string,
    @CurrentUser() me: AuthUser
  ) {
    return this.keys.remove(id, keyId, { id: me.id, email: me.email })
  }

  @Post(":id/keys/migrate-legacy")
  @RequirePermissions("provider:write")
  @ApiOperation({
    summary: "把旧的单 Key 迁移进 Key 池",
    description: "兼容历史数据：老版本只在供应商上存一把 Key，迁移后即可享受轮询与自动切换。"
  })
  migrateLegacyKey(@Param("id") id: string, @CurrentUser() me: AuthUser) {
    return this.keys.migrateLegacyKey(id, { id: me.id, email: me.email })
  }

  @Get(":id")
  @RequirePermissions("provider:read")
  @ApiOperation({ summary: "供应商详情（含模型）" })
  detail(@Param("id") id: string) {
    return this.providers.detail(id)
  }

  @Post()
  @RequirePermissions("provider:write")
  @ApiOperation({ summary: "新建供应商" })
  create(@Body() dto: CreateProviderDto, @CurrentUser() me: AuthUser) {
    return this.providers.create(dto, { id: me.id, email: me.email })
  }

  @Patch(":id")
  @RequirePermissions("provider:write")
  @ApiOperation({ summary: "编辑供应商" })
  update(
    @Param("id") id: string,
    @Body() dto: UpdateProviderDto,
    @CurrentUser() me: AuthUser
  ) {
    return this.providers.update(id, dto, { id: me.id, email: me.email })
  }

  @Patch(":id/toggle")
  @RequirePermissions("provider:write")
  @ApiOperation({ summary: "启用/禁用供应商" })
  toggle(
    @Param("id") id: string,
    @Body("enabled") enabled: boolean,
    @CurrentUser() me: AuthUser
  ) {
    return this.providers.toggle(id, enabled, { id: me.id, email: me.email })
  }

  @Delete(":id")
  @RequirePermissions("provider:delete")
  @ApiOperation({ summary: "删除供应商" })
  remove(@Param("id") id: string, @CurrentUser() me: AuthUser) {
    return this.providers.remove(id, { id: me.id, email: me.email })
  }
}