import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger"
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsIn,
  MaxLength,
  MinLength
} from "class-validator"
import { LearningKind } from "@prisma/client"
import { FEEDBACK_REASONS } from "../learning.service"

export class SubmitFeedbackDto {
  @ApiProperty({ description: "被评价的助手消息 id" })
  @IsString()
  @MinLength(1)
  messageId!: string

  @ApiProperty({ description: "true 点赞，false 点踩" })
  @IsBoolean()
  positive!: boolean

  @ApiPropertyOptional({
    description: `点踩原因，可选值：${FEEDBACK_REASONS.join(" / ")}`
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  reason?: string

  @ApiPropertyOptional({ description: "用户给出的正确答案（最有价值的学习信号）" })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  correction?: string
}

export class QueryLearningDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  agentId?: string

  @ApiPropertyOptional({ description: "PENDING / APPROVED / REJECTED / ALL" })
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

export class ReviewLearningDto {
  @ApiProperty({ description: "APPROVED 通过；REJECTED 否决", enum: ["APPROVED", "REJECTED"] })
  @IsIn(['APPROVED','REJECTED','PENDING'])
  status!: "APPROVED" | "REJECTED" | "PENDING"

  @IsOptional() @IsBoolean() pinAnswer?:boolean
  @IsOptional() @IsString() @MaxLength(20000) fixedAnswer?:string

  @ApiPropertyOptional({ description: "审核时可直接改写经验文本，使其更可执行" })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  instruction?: string

  @ApiPropertyOptional({ enum: LearningKind })
  @IsOptional()
  @IsEnum(LearningKind)
  kind?: LearningKind
}
