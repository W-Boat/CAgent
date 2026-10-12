import { ApiPropertyOptional } from "@nestjs/swagger"
import {
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength
} from "class-validator"
import { UserStatus } from "@prisma/client"

export class CreateUserDto {
  @ApiPropertyOptional()
  @IsEmail({}, { message: "请输入合法的邮箱地址" })
  email!: string

  @ApiPropertyOptional()
  @IsString()
  @MinLength(8, { message: "密码至少 8 位" })
  password!: string

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(32)
  name!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  username?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  department?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  studentNo?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string

  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus

  @ApiPropertyOptional({ type: [String], description: "角色 key 列表" })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roles?: string[]
}

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  name?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  username?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  department?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  studentNo?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  avatar?: string

  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roles?: string[]
}

export class ResetPasswordDto {
  @ApiPropertyOptional()
  @IsString()
  @MinLength(8, { message: "密码至少 8 位" })
  password!: string
}

export class SetStatusDto {
  @ApiPropertyOptional({ enum: UserStatus })
  @IsEnum(UserStatus)
  status!: UserStatus
}

export class QueryUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  keyword?: string

  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  department?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  role?: string

  @ApiPropertyOptional()
  @IsOptional()
  page?: number

  @ApiPropertyOptional()
  @IsOptional()
  pageSize?: number
}