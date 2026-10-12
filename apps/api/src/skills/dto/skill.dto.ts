import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger"
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength
} from "class-validator"
import { SkillType } from "@prisma/client"

export class CreateSkillDto {
  @ApiPropertyOptional({ description: "唯一标识，模型通过它调用技能" })
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  key!: string

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(64)
  name!: string

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(512)
  description!: string

  @ApiPropertyOptional({ enum: SkillType })
  @IsOptional()
  @IsEnum(SkillType)
  type?: SkillType

  @ApiPropertyOptional({ description: "分类：学习/科研/校园服务/通用" })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  category?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  icon?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean

  @ApiPropertyOptional()
  @IsOptional()
  sort?: number

  @ApiPropertyOptional({ description: "PROMPT 型技能的系统提示词" })
  @IsOptional()
  @IsString()
  systemPrompt?: string

  @ApiPropertyOptional({ description: "工具入参 JSON Schema" })
  @IsOptional()
  @IsObject()
  inputSchema?: Record<string, unknown>

  @ApiPropertyOptional({ description: "运行配置（HTTP 地址 / 浏览器域白名单等）" })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  permissionCode?: string

  @ApiPropertyOptional({ description: "关联到智能体 id 列表" })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  agentIds?: string[]

  @ApiPropertyOptional({ description: "管理备注（仅后台可见，不进入模型上下文）" })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string
}

export class UpdateSkillDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  name?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  description?: string

  @ApiPropertyOptional({ enum: SkillType })
  @IsOptional()
  @IsEnum(SkillType)
  type?: SkillType

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  icon?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean

  @ApiPropertyOptional()
  @IsOptional()
  sort?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  systemPrompt?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  inputSchema?: Record<string, unknown>

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  permissionCode?: string

  @ApiPropertyOptional({ description: "管理备注（仅后台可见）" })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string
}

export class QuerySkillDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  keyword?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string

  @ApiPropertyOptional({ enum: SkillType })
  @IsOptional()
  @IsEnum(SkillType)
  type?: SkillType

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  enabled?: string
}

export class RunSkillDto {
  @ApiProperty({ description: "技能入参，需匹配该技能的 inputSchema" })
  @IsObject()
  input!: Record<string, unknown>

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  conversationId?: string
}

export class QuerySkillRunDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  skillId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  userId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string

  @ApiPropertyOptional()
  @IsOptional()
  page?: number

  @ApiPropertyOptional()
  @IsOptional()
  pageSize?: number
}

/**
 * 导入技能。
 *
 * 设计成「先预览后落库」两步：dryRun 时只解析并把结果（含 warnings）返回给界面，
 * 管理员确认无误再真正创建——避免把一份格式不对的文档直接写进技能库。
 */
export class ImportSkillDto {
  @ApiProperty({ description: "技能文件内容：JSON / Markdown(SKILL.md) / 纯文本" })
  @IsString()
  @MinLength(1)
  content!: string

  @ApiPropertyOptional({ description: "仅解析不落库，用于导入前预览" })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean

  @ApiPropertyOptional({
    description: "key 冲突处理：rename 自动改名 / skip 跳过 / overwrite 覆盖"
  })
  @IsOptional()
  @IsString()
  onConflict?: "rename" | "skip" | "overwrite"

  @ApiPropertyOptional({ description: "标识不合法或冲突时用的兜底名称" })
  @IsOptional()
  @IsString()
  fallbackName?: string

  @ApiPropertyOptional({ description: "导入后关联到这些智能体" })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  agentIds?: string[]
}