import {IsArray,ArrayMaxSize,IsIn,IsOptional,IsString,MaxLength} from 'class-validator'
export class ImportEvaluationWorkbookDto {
 @IsString() @MaxLength(1_333_336) data!:string
}
export class CreateEvaluationDto {
 @IsString() @MaxLength(120) title!:string
 @IsIn(['xlsx']) format!:'xlsx'
 @IsString() @MaxLength(1_333_336) data!:string
 @IsOptional() @IsString() modelId?:string
 @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({each:true}) knowledgeBaseIds?:string[]
}
