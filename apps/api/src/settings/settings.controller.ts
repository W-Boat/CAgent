import { Body, Controller, Get, Header, Put } from "@nestjs/common"
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger"
import {SETTING_DEFS} from "./setting-defs"
import { SettingsService } from "./settings.service"
import { RequirePermissions } from "../common/decorators/permissions.decorator"
import { Public } from "../common/decorators/public.decorator"
import {
  CurrentUser,
  type AuthUser
} from "../common/decorators/current-user.decorator"

@ApiTags("系统设置")
@ApiBearerAuth()
@Controller("settings")
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Public()
  @Get("public")
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "公开设置（无需登录，用于登录页品牌信息）" })
  async publicSettings() {
    const all = await this.settings.all()
    return {
      ...Object.fromEntries(SETTING_DEFS.filter(def=>def.group==='student').map(def=>[def.key,all[def.key]])),
      site_name: all.site_name,
      site_description: all.site_description,
      allow_registration: all.allow_registration,
      enable_stream: all.enable_stream,
      enable_tools: all.enable_tools,
      skill_enabled: all.skill_enabled,
      browser_enabled: all.browser_enabled,
      memory_enabled:all.memory_enabled,
      onboarding_enabled:all.onboarding_enabled,
      default_system_prompt: all.default_system_prompt,
      default_temperature: all.default_temperature,
      /*
       * 学生端外观与模型策略（管理端可配，公开无敏感信息）：
       *  - student_logo_url：学生端右上角学校 Logo；
       *  - default_accent_color：统一主题色，开启统一配色时覆盖个人缓存；
       *  - student_default_model_id / student_fallback_model_id：
       *    学生端默认模型与出错轮换模型（存模型 ID，前端解析可用性后使用）。
       */
      student_logo_url: all.student_logo_url,
      default_accent_color: all.default_accent_color,
      student_default_model_id: all.student_default_model_id,
      student_fallback_model_id: all.student_fallback_model_id
    }
  }

  @Get()
  @RequirePermissions("setting:read")
  @ApiOperation({ summary: "系统设置（分组）" })
  grouped(@CurrentUser() me: AuthUser) {
    // 传入权限：superAdminOnly 的项只对超管返回
    return this.settings.grouped(me.permissions ?? [])
  }

  @Get("flat")
  @RequirePermissions("setting:read")
  @ApiOperation({ summary: "系统设置（扁平键值）" })
  flat() {
    return this.settings.all()
  }

  @Put()
  @RequirePermissions("setting:write")
  @ApiOperation({ summary: "批量更新设置" })
  update(
    @Body() payload: Record<string, unknown>,
    @CurrentUser() me: AuthUser
  ) {
    return this.settings.updateMany(payload, {
      id: me.id,
      email: me.email,
      // 权限用于拦截 superAdminOnly 的开关（超管专属）
      permissions: me.permissions ?? []
    })
  }
}
