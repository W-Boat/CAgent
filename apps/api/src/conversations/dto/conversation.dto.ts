import { ApiPropertyOptional } from "@nestjs/swagger"
import {
  IsBoolean,
  IsIn,
  IsInt,
  Min,
  Max,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength
} from "class-validator"
import { Type } from "class-transformer"
import { ConversationStatus } from "@prisma/client"

export class CreateConversationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  modelId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  agentId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  systemPrompt?: string
}

export class UpdateConversationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  modelId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  systemPrompt?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  temperature?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  pinned?: boolean

  @ApiPropertyOptional({ enum: ConversationStatus })
  @IsOptional()
  @IsEnum(ConversationStatus)
  status?: ConversationStatus
}

export class QueryConversationDto {
  @ApiPropertyOptional({ description: "管理员按用户筛选" })
  @IsOptional()
  @IsString()
  userId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  keyword?: string

  @ApiPropertyOptional({ enum: ConversationStatus })
  @IsOptional()
  @IsEnum(ConversationStatus)
  status?: ConversationStatus

  @ApiPropertyOptional()
  @IsOptional()
  page?: number

  @ApiPropertyOptional()
  @IsOptional()
  pageSize?: number
}

export class QueryMessageDto {
  @ApiPropertyOptional({ description: "Stable cursor for loading older messages" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  beforeId?: string

  @ApiPropertyOptional({ description: "Newest messages in chronological order" })
  @IsOptional()
  @IsIn(["true", "false"])
  latest?: string

  @ApiPropertyOptional({ description: "Load messages older than this sequence" })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  beforeSeq?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  keyword?: string

  @ApiPropertyOptional({ description: "只看某个会话的消息" })
  @IsOptional()
  @IsString()
  conversationId?: string

  @ApiPropertyOptional({ description: "只看某个用户的消息" })
  @IsOptional()
  @IsString()
  userId?: string

  @ApiPropertyOptional({ description: "只看被标记的消息" })
  @IsOptional()
  flagged?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  role?: string

  @ApiPropertyOptional({ description: "起始日期 YYYY-MM-DD" })
  @IsOptional()
  @IsString()
  from?: string

  @ApiPropertyOptional({ description: "结束日期 YYYY-MM-DD" })
  @IsOptional()
  @IsString()
  to?: string

  @ApiPropertyOptional()
  @IsOptional()
  page?: number

  @ApiPropertyOptional()
  @IsOptional()
  pageSize?: number
}

export class FlagMessageDto {
  @ApiPropertyOptional()
  @IsBoolean()
  flagged!: boolean

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string
}
