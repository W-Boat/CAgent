import { ApiPropertyOptional } from "@nestjs/swagger"
import { IsArray, IsOptional, IsString, MaxLength, MinLength } from "class-validator"

export class CreateRoleDto {
  @ApiPropertyOptional({ description: "唯一标识，如 teacher" })
  @IsString()
  @MinLength(2)
  @MaxLength(32)
  key!: string

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(32)
  name!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  description?: string

  @ApiPropertyOptional({ type: [String], description: "权限码列表" })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: string[]

  @ApiPropertyOptional()
  @IsOptional()
  sort?: number
}

export class UpdateRoleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  name?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  description?: string

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: string[]

  @ApiPropertyOptional()
  @IsOptional()
  sort?: number
}