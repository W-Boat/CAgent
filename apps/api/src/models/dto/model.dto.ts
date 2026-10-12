import { ApiPropertyOptional } from "@nestjs/swagger"
import {
  IsBoolean,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength
} from "class-validator"

export class CreateModelDto {
  @ApiPropertyOptional({ description: "供应商标识，如 gpt-4o-mini" })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  key!: string

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(64)
  name!: string

  @ApiPropertyOptional()
  @IsString()
  providerId!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean

  @ApiPropertyOptional()
  @IsOptional()
  sort?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  contextWindow?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  maxOutputTokens?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  supportsVision?: boolean

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  supportsTools?: boolean

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  supportsStream?: boolean

  @ApiPropertyOptional({ description: "输入价格（美元/百万 token）" })
  @IsOptional()
  @IsNumber()
  inputPricePerM?: number

  @ApiPropertyOptional({ description: "输出价格（美元/百万 token）" })
  @IsOptional()
  @IsNumber()
  outputPricePerM?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  extra?: Record<string, unknown>
}

export class UpdateModelDto extends CreateModelDto {}

export class QueryModelDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  providerId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  keyword?: string

  @ApiPropertyOptional()
  @IsOptional()
  enabled?: string
}