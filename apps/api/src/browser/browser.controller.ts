import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards
} from "@nestjs/common"
import { TimetableOnlyGuard } from './timetable-only.guard'
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger"
import { BrowserEngineService } from "./browser-engine.service"
import { BrowserCommandService } from "./browser-command.service"
import {
  BrowserActionDto,
  ClaimCommandDto,
  CreateBrowserSessionDto,
  QueryBrowserSessionDto,
  ReportCommandDto
} from "./dto/browser.dto"
import { RequirePermissions } from "../common/decorators/permissions.decorator"
import {
  CurrentUser,
  type AuthUser
} from "../common/decorators/current-user.decorator"

@ApiTags("浏览器操控")
@ApiBearerAuth()
@Controller("browser")
@UseGuards(TimetableOnlyGuard)
export class BrowserController {
  constructor(
    private readonly engine: BrowserEngineService,
    private readonly commands: BrowserCommandService
  ) {}

  @Get("sessions")
  @RequirePermissions("browser:read")
  @ApiOperation({ summary: "浏览器会话列表" })
  async list(
    @Query() query: QueryBrowserSessionDto,
    @CurrentUser() me: AuthUser
  ) {
    const canSeeAll =
      me.permissions.includes("*") ||
      me.permissions.includes("browser:control:all")
    return this.engine.listSessions({
      ...query,
      userId: canSeeAll ? query.userId : me.id
    })
  }

  @Post("sessions")
  @RequirePermissions("browser:use")
  @ApiOperation({
    summary: "创建浏览器会话",
    description:
      "默认 LOCAL：网页渲染与操控在用户本地浏览器执行，服务端只负责下发指令与留痕（服务器不安装 Chromium）。"
  })
  create(@CurrentUser() me: AuthUser, @Body() dto: CreateBrowserSessionDto) {
    // 本地执行走指令队列；服务端执行仍由 Chromium 引擎处理
    if ((dto.executor ?? "LOCAL") === "SERVER") {
      return this.engine.createSession({
        userId: me.id,
        name: dto.name,
        startUrl: dto.startUrl,
        headless: dto.headless
      })
    }
    return this.commands.createSession({
      userId: me.id,
      name: dto.name,
      startUrl: dto.startUrl,
      clientKind: dto.clientKind
    })
  }

  @Get("sessions/:id")
  @RequirePermissions("browser:read")
  @ApiOperation({ summary: "会话详情（含操作轨迹与指令队列）" })
  detail(@Param("id") id: string) {
    return this.commands.detail(id)
  }

  @Get("sessions/:id/steps")
  @RequirePermissions("browser:read")
  @ApiOperation({ summary: "增量拉取操作步骤" })
  steps(@Param("id") id: string, @Query("sinceSeq") sinceSeq?: string) {
    return this.engine.steps(id, Number(sinceSeq) || 0)
  }

  // ---------- 本地浏览器执行通道 ----------

  @Post("sessions/:id/heartbeat")
  @RequirePermissions("browser:use")
  @ApiOperation({
    summary: "本地客户端心跳",
    description: "本地浏览器定期上报存活，后台据此显示「本地浏览器在线/离线」。"
  })
  heartbeat(@Param("id") id: string, @Body() dto: ClaimCommandDto) {
    return this.commands.heartbeat(id, dto?.clientKind)
  }

  @Post("sessions/:id/commands")
  @RequirePermissions("browser:use")
  @ApiOperation({
    summary: "下发一条指令给本地浏览器",
    description:
      "服务端只入队，不做任何渲染。本地客户端用 claim 领取后执行，再用 report 回填。"
  })
  enqueue(@Param("id") id: string, @Body() dto: BrowserActionDto) {
    return this.commands.enqueue({
      sessionId: id,
      action: dto.action,
      selector: dto.selector,
      value: dto.value,
      timeout: dto.timeout
    })
  }

  @Post("sessions/:id/commands/claim")
  @RequirePermissions("browser:use")
  @ApiOperation({
    summary: "本地客户端领取待执行指令",
    description:
      "同一会话串行执行：有指令在跑时返回空，避免点击与输入并发导致页面错乱。"
  })
  claim(@Param("id") id: string, @Body() dto: ClaimCommandDto) {
    return this.commands.claim(id, dto?.clientKind)
  }

  @Post("commands/:commandId/report")
  @RequirePermissions("browser:use")
  @ApiOperation({
    summary: "本地客户端回填执行结果",
    description: "结果与截图落库留痕，截图写入 storage/browser 供后台回放。"
  })
  report(@Param("commandId") commandId: string, @Body() dto: ReportCommandDto) {
    return this.commands.report({ commandId, ...dto })
  }

  @Get("sessions/:id/commands")
  @RequirePermissions("browser:read")
  @ApiOperation({ summary: "增量拉取指令队列（前端展示进度）" })
  commandList(@Param("id") id: string, @Query("sinceSeq") sinceSeq?: string) {
    return this.commands.commands(id, Number(sinceSeq) || 0)
  }

  @Post("sessions/:id/actions")
  @RequirePermissions("browser:use")
  @ApiOperation({
    summary: "执行一个浏览器动作（服务端执行时使用）",
    description:
      "仅 SERVER 执行器可用。LOCAL 会话请走 /commands 下发指令，由本地浏览器执行。"
  })
  action(@Param("id") id: string, @Body() dto: BrowserActionDto) {
    return this.engine.execute(id, dto)
  }

  @Get("sessions/:id/frame")
  @RequirePermissions("browser:read")
  @ApiOperation({
    summary: "抓取当前实时画面（服务端执行时使用）",
    description:
      "仅 SERVER 执行器可用。前端用 /static/... 加上时间戳即可刷新画面，用于内嵌展示网页。"
  })
  frame(@Param("id") id: string, @Query("fullPage") fullPage?: string) {
    return this.engine.liveFrame(id, fullPage === "true")
  }

  @Post("sessions/:id/resize")
  @RequirePermissions("browser:use")
  @ApiOperation({ summary: "调整视口尺寸（服务端执行时使用）" })
  resize(
    @Param("id") id: string,
    @Body() body: { width: number; height: number }
  ) {
    return this.engine.resize(id, Number(body?.width) || 1440, Number(body?.height) || 900)
  }

  @Post("sessions/:id/highlight")
  @RequirePermissions("browser:use")
  @ApiOperation({
    summary: "在页面上做视觉标注（不点击、不填表）",
    description:
      "给目标元素套高亮框与气泡说明，仅修改 DOM 样式。导览场景下用于「指哪里」，绝不代替用户操作。"
  })
  highlight(
    @Param("id") id: string,
    @Body() body: { selector?: string; label?: string; clear?: boolean }
  ) {
    return this.engine.highlight(id, body?.selector, body?.label, body?.clear === true)
  }

  @Delete("sessions/:id")
  @RequirePermissions("browser:use")
  @ApiOperation({ summary: "关闭浏览器会话" })
  async close(@Param("id") id: string) {
    // 两种执行器都清理：本地会话没有进程，但需要作废未完成指令
    await this.commands.closeSession(id).catch(() => undefined)
    await this.engine.closeSession(id).catch(() => undefined)
    return { success: true }
  }
}
