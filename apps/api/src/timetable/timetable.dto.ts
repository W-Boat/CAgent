import { Transform, Type } from 'class-transformer'
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ArrayMinSize, ArrayMaxSize, ValidateNested } from 'class-validator'
export class CaptureRowDto {
  @IsString() @MaxLength(200) courseNo!: string
  @IsString() @MaxLength(200) name!: string
  @IsString() @MaxLength(200) section!: string
  @IsString() @MaxLength(4000) arrangement!: string
  @IsString() @MaxLength(200) teachingMethod!: string
}
export class CaptureDto {
  @IsString() @MaxLength(50) semester!: string
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(120) @ValidateNested({each:true}) @Type(()=>CaptureRowDto) rows!: CaptureRowDto[]
}
export class TimetablePreferencesDto {
  @IsOptional() @IsString() @Matches(/^20\d{2}-\d{2}-\d{2}$/) semesterStart?:string|null
  @IsOptional() @IsIn(['liangxiang','wangjing']) campus?:string
  @IsOptional() @Transform(({obj,key})=>obj[key]) @IsBoolean() useInChat?:boolean
  @IsOptional() @Transform(({obj,key})=>obj[key]) @IsBoolean() remindersEnabled?:boolean
  @IsOptional() @IsInt() @Min(1) @Max(120) reminderLeadMinutes?:number
}
export class TimetableBrowserActionDto {
  @IsIn(['click','type','press','scroll','timetable','login']) action!:string
  @IsOptional() @IsInt() @Min(0) @Max(1279) x?:number
  @IsOptional() @IsInt() @Min(0) @Max(799) y?:number
  @IsOptional() @IsString() @MaxLength(300) text?:string
  @IsOptional() @IsIn(['Enter','Tab','Shift+Tab','Backspace','Delete','Escape','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown','Control+A']) key?:string
  @IsOptional() @IsInt() @Min(-1600) @Max(1600) delta?:number
}
