import { ApiPropertyOptional } from "@nestjs/swagger"
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength
} from "class-validator"

export class CreateBrowserSessionDto {
  @ApiPropertyOptional({ description: "会话名称" })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  name?: string

  @ApiPropertyOptional({ description: "起始地址" })
  @IsOptional()
  @IsString()
  startUrl?: string

  @ApiPropertyOptional({ description: "是否无头模式（仅服务端执行时有意义）" })
  @IsOptional()
  @IsBoolean()
  headless?: boolean

  @ApiPropertyOptional({
    description:
      "执行位置：LOCAL 用户本地浏览器（默认，服务器不装 Chromium）；SERVER 服务端浏览器（需服务器内存充足）",
    enum: ["LOCAL", "SERVER"]
  })
  @IsOptional()
  @IsIn(["LOCAL", "SERVER"])
  executor?: "LOCAL" | "SERVER"

  @ApiPropertyOptional({
    description: "本地客户端类型：WEB 网页端直连；EXTENSION 浏览器扩展",
    enum: ["WEB", "EXTENSION"]
  })
  @IsOptional()
  @IsIn(["WEB", "EXTENSION"])
  clientKind?: string
}

export class BrowserActionDto {
  @ApiPropertyOptional({
    description:
      "动作类型：goto / click / type / press / wait / extract / screenshot / evaluate / scroll / back / forward / reload / select"
  })
  @IsString()
  action!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  selector?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  value?: string

  @ApiPropertyOptional({ description: "等待毫秒数，wait 动作使用" })
  @IsOptional()
  @IsInt()
  timeout?: number
}

/** 本地客户端领取指令 */
export class ClaimCommandDto {
  @ApiPropertyOptional({
    description: "客户端类型：WEB | EXTENSION",
    enum: ["WEB", "EXTENSION"]
  })
  @IsOptional()
  @IsIn(["WEB", "EXTENSION"])
  clientKind?: string
}

/** 本地客户端回填执行结果 */
export class ReportCommandDto {
  @ApiPropertyOptional({ description: "是否执行成功" })
  @IsBoolean()
  ok!: boolean

  @ApiPropertyOptional({ description: "结构化结果（文本、匹配数等）" })
  @IsOptional()
  result?: unknown

  @ApiPropertyOptional({ description: "截图 dataURL 或裸 base64" })
  @IsOptional()
  @IsString()
  screenshot?: string

  @ApiPropertyOptional({ description: "执行后的页面地址" })
  @IsOptional()
  @IsString()
  url?: string

  @ApiPropertyOptional({ description: "执行后的页面标题" })
  @IsOptional()
  @IsString()
  title?: string

  @ApiPropertyOptional({ description: "失败原因" })
  @IsOptional()
  @IsString()
  error?: string

  @ApiPropertyOptional({ description: "耗时（毫秒）" })
  @IsOptional()
  @IsInt()
  durationMs?: number
}

export class QueryBrowserSessionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  userId?: string

  @ApiPropertyOptional()
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