import {IsBoolean,IsIn,IsInt,Min,Max,IsOptional,IsString,MaxLength} from 'class-validator'
export class CreateEvaluationDto {
 @IsString() @MaxLength(120) title!:string
 @IsIn(['json','csv']) format!:'json'|'csv'
 @IsString() @MaxLength(1_500_000) data!:string
 @IsOptional() @IsIn(['test','validation']) split?:'test'|'validation'
 @IsOptional() @IsString() modelId?:string
 @IsOptional() @IsString() agentId?:string
 @IsOptional() @IsBoolean() bypassCache?:boolean
 @IsOptional() @IsInt() @Min(1) @Max(8) concurrency?:number
 @IsOptional() @IsBoolean() strictMode?:boolean
 @IsOptional() @IsIn(['mounted','v2-only']) knowledgeScope?:'mounted'|'v2-only'
 @IsOptional() @IsIn(['cards','adaptive','text']) outputPreference?:'cards'|'adaptive'|'text'
}
