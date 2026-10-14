import { IsArray, ArrayMinSize, ArrayMaxSize, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator'
import {Transform} from 'class-transformer'

export class CollectiveTimetableDto {
  @Transform(({obj})=>obj.complete) @IsBoolean() complete!:boolean
  @IsString() @MaxLength(50) semester!:string
  @IsString() @MaxLength(50) capturedAt!:string
  @IsString() @MaxLength(500) sourcePage!:string
  @IsOptional() @IsIn(['良乡','望京','通用']) campus?:string
  @Transform(({obj})=>obj.records) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5000) @IsObject({each:true}) records!:Record<string,unknown>[]
}

export class BaseDto {
  @IsString() @MinLength(1) @MaxLength(120) name!:string
  @IsOptional() @IsString() @MaxLength(1000) description?:string
  @IsOptional() @IsIn(['LOCAL','POSTGRES','MYSQL','WECHAT']) kind?:string
  @IsOptional() @IsBoolean() mounted?:boolean
  @IsOptional() @IsString() agentId?:string
  @IsOptional() @IsObject() connection?:Record<string,any>
  @IsOptional() @IsString() @MaxLength(4000) password?:string
  @IsOptional() @Transform(({obj})=>obj.aiReviewEnabled) @IsBoolean() aiReviewEnabled?:boolean
  @IsOptional() @Transform(({obj})=>obj.aiSummaryEnabled) @IsBoolean() aiSummaryEnabled?:boolean
  @IsOptional() @IsString() automationModelId?:string
}
export class AutomationPolicyDto {
  @Transform(({obj})=>obj.reviewEnabled) @IsBoolean() reviewEnabled!:boolean
  @Transform(({obj})=>obj.summaryEnabled) @IsBoolean() summaryEnabled!:boolean
  @IsOptional() @IsString() modelId?:string
  @IsOptional() @IsInt() @Min(1) @Max(5) batchSize?:number
}
export class WechatAccountsDto {
  @IsObject() connection!:Record<string,any>
  @IsOptional() @IsString() @MaxLength(4000) password?:string
  @IsOptional() @IsString() baseId?:string
  @IsOptional() @IsString() @MaxLength(100) keyword?:string
}
export class EntryDto {
  @IsString() @MinLength(1) baseId!:string
  @IsString() @MinLength(1) @MaxLength(500) title!:string
  @IsOptional() @IsString() @MaxLength(1000) question?:string
  @IsString() @MinLength(1) @MaxLength(20000) answer!:string
  @IsOptional() @IsArray() @IsString({each:true}) @MaxLength(300,{each:true}) aliases?:string[]
  @IsOptional() @IsString() @MaxLength(1000) url?:string
  @IsOptional() @IsIn(['RAG','FIXED','CORRECTION','TRIGGER']) mode?:string
  @IsOptional() @IsIn(['DRAFT','APPROVED','ARCHIVED']) status?:string
  @IsOptional() @IsInt() @Min(1) @Max(100) priority?:number
  @IsOptional() @IsString() @MaxLength(500) source?:string
  @IsOptional() @IsString() sourceMessageId?:string
}
export class ParseDto {
  @IsString() @MinLength(1) @MaxLength(15000) text!:string
  @IsOptional() @IsString() modelId?:string
}
export class MountDto { @IsBoolean() mounted!:boolean }
export class RemoveBaseDto { @IsString() @MinLength(1) @MaxLength(500) name!:string }
export class CorrectionDto {
  @IsOptional() @IsString() @MaxLength(1000) question?:string
  @IsString() @MinLength(1) @MaxLength(20000) answer!:string
}
export class ResolveFeedbackDto {
  @IsIn(['OPEN','RESOLVED','DISMISSED']) resolution!:string
  @IsOptional() @IsString() @MaxLength(2000) note?:string
}
