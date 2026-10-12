import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors
} from "@nestjs/common"
import { FileInterceptor } from "@nestjs/platform-express"
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from "@nestjs/swagger"
import { SkillsEngineService } from "./skills-engine.service"
import { SkillImportService } from "./skill-import.service"
import { ToolRegistry } from "../tools/tool-registry"
import {assertVisibleCapability} from '../common/retired-capabilities'
import { PrismaService } from "../prisma/prisma.service"
import {
  CreateSkillDto,
  ImportSkillDto,
  QuerySkillDto,
  QuerySkillRunDto,
  RunSkillDto,
  UpdateSkillDto
} from "./dto/skill.dto"
import { RequirePermissions } from "../common/decorators/permissions.decorator"
import {
  CurrentUser,
  type AuthUser
} from "../common/decorators/current-user.decorator"

@ApiTags("技能系统")
@ApiBearerAuth()
@Controller("skills")
export class SkillsController {
  constructor(
    private readonly skills: SkillsEngineService,
    private readonly skillImport: SkillImportService,
    private readonly prisma: PrismaService
  ) {}

  /** 冲突改名：key、key-2、key-3 … 直到空位 */
  private async uniqueKey(base: string): Promise<string> {
    for (let i = 2; i < 100; i++) {
      const candidate = `${base}-${i}`.slice(0, 64)
      const hit = await this.prisma.skill.findUnique({ where: { key: candidate } })
      if (!hit) return candidate
    }
    return `${base}-${Date.now().toString(36)}`.slice(0, 64)
  }

  // ---------- 用户侧 ----------

  @Get("available")
  @ApiOperation({ summary: "当前用户可用的技能" })
  available(@CurrentUser() me: AuthUser) {
    return this.skills.available(me.permissions)
  }

  @Post(":id/run")
  @RequirePermissions("skill:run")
  @ApiOperation({ summary: "执行技能" })
  run(
    @Param("id") id: string,
    @Body() dto: RunSkillDto,
    @CurrentUser() me: AuthUser
  ) {
    return this.skills.run(id, {
      userPermissions: me.permissions,
      userId: me.id,
      conversationId: dto.conversationId ?? null,
      input: dto.input
    })
  }

  @Get("runs/mine")
  @ApiOperation({ summary: "我的技能运行记录" })
  myRuns(@CurrentUser() me: AuthUser, @Query() query: QuerySkillRunDto) {
    return this.skills.listRuns({ ...query, userId: me.id })
  }

  // ---------- 后台管理 ----------

  @Get()
  @RequirePermissions("skill:read")
  @ApiOperation({ summary: "技能列表（后台）" })
  list(@Query() query: QuerySkillDto) {
    return this.skills.list(query)
  }

  @Get("runs")
  @RequirePermissions("skill:read")
  @ApiOperation({ summary: "技能运行记录（后台）" })
  runs(@Query() query: QuerySkillRunDto) {
    return this.skills.listRuns(query)
  }

  @Get("stats")
  @RequirePermissions("skill:read")
  @ApiOperation({ summary: "技能运行统计" })
  stats(@Query("days") days?: string) {
    return this.skills.runStats(Number(days) || 7)
  }

  @Get("tools")
  @RequirePermissions("skill:update")
  @ApiOperation({ summary: "内置工具目录（配置 TOOL 型技能时选工具用）" })
  tools() {
    return ToolRegistry.catalog()
  }

  @Get(":id")
  @RequirePermissions("skill:read")
  @ApiOperation({ summary: "技能详情" })
  detail(@Param("id") id: string) {
    return this.skills.detail(id)
  }

  @Post()
  @RequirePermissions("skill:create")
  @ApiOperation({ summary: "新建技能" })
  create(@Body() dto: CreateSkillDto, @CurrentUser() me: AuthUser) {
    return this.skills.create(dto, { id: me.id, email: me.email })
  }

  @Patch(":id")
  @RequirePermissions("skill:update")
  @ApiOperation({ summary: "编辑技能" })
  update(
    @Param("id") id: string,
    @Body() dto: UpdateSkillDto,
    @CurrentUser() me: AuthUser
  ) {
    return this.skills.update(id, dto, { id: me.id, email: me.email })
  }

  @Patch(":id/toggle")
  @RequirePermissions("skill:update")
  @ApiOperation({ summary: "启用/禁用技能" })
  toggle(
    @Param("id") id: string,
    @Body("enabled") enabled: boolean,
    @CurrentUser() me: AuthUser
  ) {
    return this.skills.toggle(id, enabled, { id: me.id, email: me.email })
  }

  @Patch(":id/agents")
  @RequirePermissions("skill:update")
  @ApiOperation({ summary: "设置技能关联的智能体" })
  bindAgents(
    @Param("id") id: string,
    @Body("agentIds") agentIds: string[],
    @CurrentUser() me: AuthUser
  ) {
    return this.skills.bindAgents(id, agentIds ?? [], {
      id: me.id,
      email: me.email
    })
  }

  @Post("import")
  @RequirePermissions("skill:create")
  @ApiOperation({ summary: "从 JSON / Markdown / 文本导入技能" })
  async importSkill(@Body() dto: ImportSkillDto, @CurrentUser() me: AuthUser) {
    const parsed = this.skillImport.parse(dto.content, dto.fallbackName)
    assertVisibleCapability(parsed)

    // 预览模式：把解析结果交回去让管理员确认，不写库
    if (dto.dryRun) {
      const clash = await this.prisma.skill.findUnique({ where: { key: parsed.key } })
      return {
        ...parsed,
        dryRun: true,
        exists: Boolean(clash),
        existingId: clash?.id ?? null
      }
    }

    const onConflict = dto.onConflict ?? "rename"
    const existing = await this.prisma.skill.findUnique({ where: { key: parsed.key } })

    if (existing) {
      if (onConflict === "skip") {
        return { ...parsed, skipped: true, reason: "同标识技能已存在" }
      }
      if (onConflict === "overwrite") {
        const updated = await this.skills.update(
          existing.id,
          {
            name: parsed.name,
            description: parsed.description,
            type: parsed.type,
            category: parsed.category,
            icon: parsed.icon ?? undefined,
            systemPrompt: parsed.systemPrompt ?? undefined,
            inputSchema: parsed.inputSchema ?? undefined,
            config: parsed.config ?? undefined
          },
          { id: me.id, email: me.email }
        )
        return { overwritten: true, ...parsed, skill: updated }
      }
      // rename：追加数字后缀，直到不冲突
      parsed.key = await this.uniqueKey(parsed.key)
      parsed.warnings.push(`标识冲突，已自动改名为 ${parsed.key}`)
    }

    const skill = await this.skills.create(
      {
        key: parsed.key,
        name: parsed.name,
        description: parsed.description,
        type: parsed.type,
        category: parsed.category,
        icon: parsed.icon ?? undefined,
        systemPrompt: parsed.systemPrompt ?? undefined,
        inputSchema: parsed.inputSchema ?? undefined,
        config: parsed.config ?? undefined,
        agentIds: dto.agentIds
      },
      { id: me.id, email: me.email }
    )

    return { created: true, ...parsed, skill }
  }

  @Post("import-zip")
  @RequirePermissions("skill:create")
  @UseInterceptors(
    FileInterceptor("file", {
      // 内存存储：技能包不大（上限 10MB），解析完即可丢弃，不落盘
      limits: { fileSize: 10 * 1024 * 1024 }
    })
  )
  @ApiConsumes("multipart/form-data")
  @ApiOperation({
    summary: "从 zip 技能包导入",
    description:
      "支持常见技能包结构：SKILL.md 主文档 + skill.json 结构化定义 + 其他 Markdown 附件。" +
      "包内的脚本/模板等非文本文件出于安全不会落盘，仅在提示词中列出文件名。"
  })
  async importZip(
    @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined,
    @Body("dryRun") dryRun: string | undefined,
    @Body("onConflict") onConflict: string | undefined,
    @CurrentUser() me: AuthUser
  ) {
    if (!file) throw new BadRequestException("未收到压缩包")
    if (!/\.zip$/i.test(file.originalname || "")) {
      throw new BadRequestException("只接受 .zip 压缩包")
    }

    // 用文件名兜底作为技能名（包内没有可用标题时）
    const fallbackName = (file.originalname || "").replace(/\.zip$/i, "")
    const parsed = this.skillImport.parseZip(file.buffer, fallbackName)
    assertVisibleCapability(parsed)

    // 预览模式：只解析不落库，让管理员先确认
    if (dryRun === "true" || dryRun === "1") {
      const clash = await this.prisma.skill.findUnique({ where: { key: parsed.key } })
      return {
        ...parsed,
        dryRun: true,
        exists: Boolean(clash),
        existingId: clash?.id ?? null
      }
    }

    const conflict = (onConflict as "rename" | "skip" | "overwrite") || "rename"
    const existing = await this.prisma.skill.findUnique({ where: { key: parsed.key } })

    if (existing) {
      if (conflict === "skip") {
        return { ...parsed, skipped: true, reason: "同标识技能已存在" }
      }
      if (conflict === "overwrite") {
        const updated = await this.skills.update(
          existing.id,
          {
            name: parsed.name,
            description: parsed.description,
            type: parsed.type,
            category: parsed.category,
            icon: parsed.icon ?? undefined,
            systemPrompt: parsed.systemPrompt ?? undefined,
            inputSchema: parsed.inputSchema ?? undefined,
            config: parsed.config ?? undefined
          },
          { id: me.id, email: me.email }
        )
        return { overwritten: true, ...parsed, skill: updated }
      }
      parsed.key = await this.uniqueKey(parsed.key)
      parsed.warnings.push(`标识冲突，已自动改名为 ${parsed.key}`)
    }

    const skill = await this.skills.create(
      {
        key: parsed.key,
        name: parsed.name,
        description: parsed.description,
        type: parsed.type,
        category: parsed.category,
        icon: parsed.icon ?? undefined,
        systemPrompt: parsed.systemPrompt ?? undefined,
        inputSchema: parsed.inputSchema ?? undefined,
        config: parsed.config ?? undefined
      },
      { id: me.id, email: me.email }
    )

    return { created: true, ...parsed, skill }
  }

  @Delete(":id")
  @RequirePermissions("skill:delete")
  @ApiOperation({ summary: "删除技能" })
  remove(@Param("id") id: string, @CurrentUser() me: AuthUser) {
    return this.skills.remove(id, { id: me.id, email: me.email })
  }
}
