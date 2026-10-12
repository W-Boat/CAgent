import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger"
import { Type } from "class-transformer"
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min
} from "class-validator"

export class SearchGuideDto {
  @ApiProperty({ description: "关键词或自然语言问法", example: "校园卡丢了怎么补办" })
  @IsString()
  q!: string

  @ApiPropertyOptional({
    description: "guide=只给指引（默认）；full=追加正文与清单",
    enum: ["guide", "full"]
  })
  @IsOptional()
  @IsIn(["guide", "full"])
  mode?: "guide" | "full"

  @ApiPropertyOptional({ description: "返回条数，1~20，默认 5" })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number

  @ApiPropertyOptional({description:'按知识库筛选；不指定时联动查询'})
  @IsOptional()
  @IsString()
  @MaxLength(160)
  collection?: string

  @ApiPropertyOptional({description:'章节主题，如学生社团、超市'})
  @IsOptional()
  @IsString()
  @MaxLength(160)
  topic?: string
}

export class ListGuideDto {
  @ApiPropertyOptional({ description: "关键词" })
  @IsOptional()
  @IsString()
  keyword?: string

  @ApiPropertyOptional({ description: "分类" })
  @IsOptional()
  @IsString()
  cat?: string

  @ApiPropertyOptional({ description: "类型：事项/表单/预约/业务系统入口/服务指南/通知公告..." })
  @IsOptional()
  @IsString()
  type?: string

  @ApiPropertyOptional({ description: "访问方式：公网/校园网·VPN/已合并下线" })
  @IsOptional()
  @IsString()
  access?: string

  @ApiPropertyOptional({ description: "详情完整度" })
  @IsOptional()
  @IsString()
  detailStatus?: string

  @ApiPropertyOptional({ description: "办理部门" })
  @IsOptional()
  @IsString()
  dept?: string

  @ApiPropertyOptional({ description: "数据来源" })
  @IsOptional()
  @IsString()
  source?: string

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number
}

export class OpenGuideDto {
  @ApiPropertyOptional({ description: "导览条目 ID（externalId 或 cuid 均可）" })
  @IsOptional()
  @IsString()
  itemId?: string

  @ApiPropertyOptional({ description: "直接指定要打开的 URL" })
  @IsOptional()
  @IsString()
  url?: string

  @ApiPropertyOptional({ description: "是否复用当前用户最近的活跃导览会话，默认 true" })
  @IsOptional()
  @IsBoolean()
  reuse?: boolean

  @ApiPropertyOptional({ description: "无头模式；前端内嵌展示建议 false 以外的默认 true" })
  @IsOptional()
  @IsBoolean()
  headless?: boolean

  @ApiPropertyOptional({
    description: "视口宽度（像素）。前端把内嵌区域的宽度传进来，画面比例更贴近实际容器",
    minimum: 320,
    maximum: 2560
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(320)
  @Max(2560)
  width?: number

  @ApiPropertyOptional({
    description: "视口高度（像素）",
    minimum: 240,
    maximum: 1600
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(240)
  @Max(1600)
  height?: number
}

export class AdvanceStepDto {
  @ApiProperty({ description: "步骤序号，从 1 开始" })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  step!: number

  @ApiPropertyOptional({ description: "该步骤是否已完成，默认 true" })
  @IsOptional()
  @IsBoolean()
  done?: boolean

  @ApiPropertyOptional({ description: "备注" })
  @IsOptional()
  @IsString()
  note?: string
}

export class HighlightDto {
  @ApiPropertyOptional({
    description: "要高亮的 CSS 选择器（只做视觉标注，不点击、不填表）"
  })
  @IsOptional()
  @IsString()
  selector?: string

  @ApiPropertyOptional({
    description: "按页面上的可见文字定位，取最小的包含该文字的元素；与 selector 二选一"
  })
  @IsOptional()
  @IsString()
  text?: string

  @ApiPropertyOptional({ description: "高亮提示文案" })
  @IsOptional()
  @IsString()
  label?: string

  @ApiPropertyOptional({ description: "是否清除已有高亮，默认 false" })
  @IsOptional()
  @IsBoolean()
  clear?: boolean
}

export class ScrollDto {
  @ApiPropertyOptional({ description: "向下滚动的像素数，默认 600；负数向上" })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  y?: number
}

export class CampusActivityDto {
 @IsString() @MaxLength(100) requestId!:string
 @IsIn(['CONTENT_VIEW','LINK_CLICK','MAP_VIEW','RENDER_ERROR','RENDER_RECOVERED']) eventType!:string
 @IsIn(['student-chat','admin-chat','trial-chat','campus-guide','campus-map','presentation-lab','api']) origin!:string
 @IsOptional() @IsString() @MaxLength(160) entryId?:string
 @IsOptional() @IsString() @MaxLength(160) collection?:string
 @IsOptional() @IsString() @MaxLength(240) title?:string
 @IsOptional() @IsString() @MaxLength(2000) url?:string
 @IsOptional() @IsString() @MaxLength(80) component?:string
 @IsOptional() @IsIn(['syntax','schema','component','module']) errorType?:string
 @IsOptional() @IsIn(['initial','automatic','manual']) retryMode?:string
 @IsOptional() @IsInt() @Min(0) @Max(100) attempt?:number
 @IsOptional() @IsString() @MaxLength(160) messageId?:string
}
export class LibraryGuideDto extends ListGuideDto {
 @IsOptional() @IsString() @MaxLength(160) collection?:string
 @IsOptional() @IsString() @MaxLength(40) format?:string
}
