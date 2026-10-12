import { ApiPropertyOptional } from "@nestjs/swagger"
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  MinLength
} from "class-validator"
import { AgentMode, AgentVisibility } from "@prisma/client"

export class CreateAgentDto {
  @ApiPropertyOptional({ description: "唯一标识，如 campus-assistant" })
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  key!: string

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(64)
  name!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  description?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  avatar?: string

  @ApiPropertyOptional({ description: "系统提示词" })
  @IsString()
  systemPrompt!: string

  @ApiPropertyOptional({ description: "开场白" })
  @IsOptional()
  @IsString()
  greeting?: string

  @ApiPropertyOptional({ description: "推荐追问" })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  starters?: string[]

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  modelId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  temperature?: number

  @ApiPropertyOptional({ description: "最大上下文轮数" })
  @IsOptional()
  @IsNumber()
  maxContextMessages?: number

  @ApiPropertyOptional({ enum: AgentVisibility })
  @IsOptional()
  @IsEnum(AgentVisibility)
  visibility?: AgentVisibility

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowBrowser?: boolean

  @ApiPropertyOptional()
  @IsOptional()
  sort?: number

  @ApiPropertyOptional({ description: "关联技能 id" })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skillIds?: string[]

  @ApiPropertyOptional({
    enum: AgentMode,
    description: "CHAT 纯对话不给工具；AGENT 由模型自主调用工具"
  })
  @IsOptional()
  @IsEnum(AgentMode)
  mode?: AgentMode

  @ApiPropertyOptional({ description: "单轮最多工具调用轮数，1-20" })
  @IsOptional()
  @IsNumber()
  maxToolRounds?: number

  @ApiPropertyOptional({ description: "管理备注（仅后台可见）" })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string
}

export class UpdateAgentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  avatar?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  systemPrompt?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  greeting?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  starters?: string[]

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  modelId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  temperature?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  maxContextMessages?: number

  @ApiPropertyOptional({ enum: AgentVisibility })
  @IsOptional()
  @IsEnum(AgentVisibility)
  visibility?: AgentVisibility

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowBrowser?: boolean

  @ApiPropertyOptional()
  @IsOptional()
  sort?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skillIds?: string[]

  @ApiPropertyOptional({ enum: AgentMode })
  @IsOptional()
  @IsEnum(AgentMode)
  mode?: AgentMode

  @ApiPropertyOptional({ description: "单轮最多工具调用轮数，1-20" })
  @IsOptional()
  @IsNumber()
  maxToolRounds?: number

  @ApiPropertyOptional({ description: "管理备注（仅后台可见）" })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string
}

export class QueryAgentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  keyword?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  enabled?: string

  @ApiPropertyOptional({ enum: AgentVisibility })
  @IsOptional()
  @IsEnum(AgentVisibility)
  visibility?: AgentVisibility
}