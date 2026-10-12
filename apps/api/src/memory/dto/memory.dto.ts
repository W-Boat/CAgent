import { IsString, IsOptional, IsInt, Min, Max, IsDateString } from "class-validator"
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger"

export class CreateMemoryDto {
  @ApiProperty({ description: "记忆内容", example: "用户喜欢用Python编程" })
  @IsString()
  content: string

  @ApiPropertyOptional({ description: "智能体ID（为空表示全局记忆）", example: "agent_123" })
  @IsOptional()
  @IsString()
  agentId?: string

  @ApiPropertyOptional({ description: "记忆类别", example: "preference", default: "general" })
  @IsOptional()
  @IsString()
  category?: string

  @ApiPropertyOptional({ description: "重要性（1-5）", example: 3, default: 3 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  importance?: number

  @ApiPropertyOptional({ description: "过期时间", example: "2025-12-31T23:59:59Z" })
  @IsOptional()
  @IsDateString()
  expiresAt?: string
}

export class UpdateMemoryDto {
  @ApiPropertyOptional({ description: "记忆内容" })
  @IsOptional()
  @IsString()
  content?: string

  @ApiPropertyOptional({ description: "记忆类别" })
  @IsOptional()
  @IsString()
  category?: string

  @ApiPropertyOptional({ description: "重要性（1-5）" })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  importance?: number

  @ApiPropertyOptional({ description: "过期时间（null表示永久）" })
  @IsOptional()
  expiresAt?: string | null
}

export class BatchDeleteMemoryDto {
  @ApiProperty({ description: "记忆ID列表", type: [String] })
  memoryIds: string[]
}
