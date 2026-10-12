import { ApiPropertyOptional } from "@nestjs/swagger"
import { IsOptional, IsString } from "class-validator"

export class QueryAuditDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  keyword?: string

  @ApiPropertyOptional({ description: "动作，如 user.update" })
  @IsOptional()
  @IsString()
  action?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  resource?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  resourceId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  userId?: string

  @ApiPropertyOptional({ description: "只看失败/拒绝的操作" })
  @IsOptional()
  @IsString()
  onlyFailed?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  from?: string

  @ApiPropertyOptional()
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