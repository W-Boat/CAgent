import { ApiPropertyOptional } from "@nestjs/swagger"
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength } from "class-validator"

export class QueryUsageDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  userId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  providerKey?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  modelKey?: string

  @ApiPropertyOptional({ description: "来源：CHAT / SKILL / BROWSER / EMBEDDING" })
  @IsOptional()
  @IsString()
  source?: string

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

export class UpdateQuotaDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean

  @ApiPropertyOptional({ description: "每日 token 上限，0 表示不限" })
  @IsOptional()
  @IsInt()
  dailyTokenLimit?: number

  @ApiPropertyOptional({ description: "每月 token 上限，0 表示不限" })
  @IsOptional()
  @IsInt()
  monthlyTokenLimit?: number

  @ApiPropertyOptional({ description: "每日请求次数上限，0 表示不限" })
  @IsOptional()
  @IsInt()
  dailyRequestLimit?: number

  @ApiPropertyOptional({ description: "每分钟请求上限，0 表示不限" })
  @IsOptional()
  @IsInt()
  rpmLimit?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string
}

export class BatchQuotaDto extends UpdateQuotaDto {
  @ApiPropertyOptional({ description: "批量应用到的用户 id 列表" })
  @IsOptional()
  userIds?: string[]

  @ApiPropertyOptional({ description: "按角色批量应用" })
  @IsOptional()
  @IsString()
  roleKey?: string

  @ApiPropertyOptional({ description: "按院系批量应用" })
  @IsOptional()
  @IsString()
  department?: string
}