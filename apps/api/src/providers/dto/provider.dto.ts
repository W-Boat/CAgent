import { ApiPropertyOptional } from "@nestjs/swagger"
import {
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength
} from "class-validator"
import { ProviderType } from "@prisma/client"

export class CreateProviderDto {
  @ApiPropertyOptional({ description: "唯一标识，如 deepseek" })
  @IsString()
  @MinLength(2)
  @MaxLength(32)
  key!: string

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(32)
  name!: string

  @ApiPropertyOptional({ enum: ProviderType })
  @IsOptional()
  @IsEnum(ProviderType)
  type?: ProviderType

  @ApiPropertyOptional({ description: "接口基地址，如 https://api.deepseek.com/v1" })
  @IsOptional()
  @IsString()
  baseUrl?: string

  @ApiPropertyOptional({ description: "API Key（明文传入，服务端加密存储）" })
  @IsOptional()
  @IsString()
  apiKey?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string

  @ApiPropertyOptional()
  @IsOptional()
  sort?: number

  @ApiPropertyOptional({ description: "附加配置：组织 ID、region、apiVersion 等" })
  @IsOptional()
  @IsObject()
  extra?: Record<string, unknown>
}

export class UpdateProviderDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  name?: string

  @ApiPropertyOptional({ enum: ProviderType })
  @IsOptional()
  @IsEnum(ProviderType)
  type?: ProviderType

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  baseUrl?: string

  @ApiPropertyOptional({ description: "留空表示不修改；传空字符串表示清除" })
  @IsOptional()
  @IsString()
  apiKey?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string

  @ApiPropertyOptional()
  @IsOptional()
  sort?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  extra?: Record<string, unknown>
}