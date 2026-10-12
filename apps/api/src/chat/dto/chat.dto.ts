import { ApiPropertyOptional } from "@nestjs/swagger"
import {
  IsIn,
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength
} from "class-validator"

export class SendMessageDto {
  @IsOptional() @IsIn(['cards','adaptive','text']) outputPreference?:'cards'|'adaptive'|'text'
  @IsOptional() @IsBoolean() bypassCache?:boolean
  @IsOptional() @IsIn(["student-chat","admin-chat","trial-chat","api"]) origin?:string

  @ApiPropertyOptional({ description: "会话 id，缺省时自动新建会话" })
  @IsOptional()
  @IsString()
  conversationId?: string

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(100000)
  content!: string

  @ApiPropertyOptional({ description: "覆盖会话使用的模型" })
  @IsOptional()
  @IsString()
  modelId?: string

  @ApiPropertyOptional({ description: "使用某个智能体" })
  @IsOptional()
  @IsString()
  agentId?: string

  @ApiPropertyOptional({ type: [String], description: "附加图片（data URL 或 http 地址）" })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[]

  @ApiPropertyOptional({ description: "本次请求启用的技能 key 列表" })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skills?: string[]

  @ApiPropertyOptional({ description: "是否启用工具（技能）调用" })
  @IsOptional()
  @IsBoolean()
  enableTools?: boolean

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  temperature?: number

  @ApiPropertyOptional({ description: "用户是否同意开启自动记忆（首次使用时征询；false 时不做自动记忆提取）" })
  @IsOptional()
  @IsBoolean()
  memoryEnabled?: boolean
}

export class RegenerateDto {
  @IsOptional() @IsIn(['cards','adaptive','text']) outputPreference?:'cards'|'adaptive'|'text'
  @IsOptional() @IsIn(["student-chat","admin-chat","trial-chat","api"]) origin?:string
  @IsOptional() @IsString() modelId?:string
  @ApiPropertyOptional()
  @IsString()
  conversationId!: string

  @ApiPropertyOptional({ description: "要重新生成的消息 id，缺省为最后一条助手消息" })
  @IsOptional()
  @IsString()
  messageId?: string
}

export class TestModelDto {
  @ApiPropertyOptional()
  @IsString()
  modelId!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  prompt?: string
}
