import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger"
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from "class-validator"

export class LoginDto {
  @ApiProperty({ example: "admin@cagent.local" })
  @IsEmail({}, { message: "请输入合法的邮箱地址" })
  email!: string

  @ApiProperty({ example: "CHANGE_ME_SEED_ADMIN_PASSWORD" })
  @IsString()
  @MinLength(6, { message: "密码至少 6 位" })
  password!: string
}

export class RegisterDto {
  @ApiProperty()
  @IsEmail({}, { message: "请输入合法的邮箱地址" })
  email!: string

  @ApiProperty()
  @IsString()
  @MinLength(8, { message: "密码至少 8 位" })
  @MaxLength(64)
  password!: string

  @ApiProperty()
  @IsString()
  @MinLength(1)
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
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  refreshToken!: string
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  oldPassword!: string

  @ApiProperty()
  @IsString()
  @MinLength(8, { message: "新密码至少 8 位" })
  @MaxLength(64)
  newPassword!: string
}

export class UpdateProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  name?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  department?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  avatar?: string
}