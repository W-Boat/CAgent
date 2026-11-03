import {BadRequestException,Body,Controller,Get,Param,Post,Query,Res} from '@nestjs/common'
import {ApiBearerAuth,ApiOperation,ApiTags} from '@nestjs/swagger'
import type {Response} from 'express'
import {CurrentUser,type AuthUser} from '../common/decorators/current-user.decorator'
import {RequirePermissions} from '../common/decorators/permissions.decorator'
import {CreateEvaluationDto,ImportEvaluationWorkbookDto} from './evaluation.dto'
import {parseValidationWorkbook,validationTemplate,XLSX_MIME} from './evaluation-xlsx'
import {EvaluationService} from './evaluation.service'
@ApiTags('批量对话测试') @ApiBearerAuth() @RequirePermissions('conversation:read') @Controller('evaluations')
export class EvaluationController {
 constructor(private readonly evaluation:EvaluationService){}
 @Post('import-xlsx') @ApiOperation({summary:'读取两列 Excel 验证集，不调用模型'}) importWorkbook(@Body() dto:ImportEvaluationWorkbookDto){try{const batches=parseValidationWorkbook(dto.data,dto.split||'validation');return {batches,total:batches.reduce((n,b)=>n+b.questions.length,0)}}catch(e){throw new BadRequestException((e as Error).message)}}
 @Get('template') @ApiOperation({summary:'下载空白 Excel 验证集模板'}) template(@Res() res:Response){res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',XLSX_MIME);res.setHeader('Content-Disposition','attachment; filename="validation-template.xlsx"');res.send(validationTemplate())}
 @Post() @ApiOperation({summary:'导入 JSON/CSV 测试集并异步执行多轮对话'}) create(@CurrentUser() user:AuthUser,@Body() dto:CreateEvaluationDto){return this.evaluation.create(user,dto)}
 @Get() @ApiOperation({summary:'任务列表'}) list(@CurrentUser() user:AuthUser){return this.evaluation.list(user)}
 @Get(':id') @ApiOperation({summary:'执行状态与回答预览'}) detail(@CurrentUser() user:AuthUser,@Param('id') id:string){return this.evaluation.detail(user,id)}
 @Post(':id/cancel') @ApiOperation({summary:'停止任务，保留已有结果'}) cancel(@CurrentUser() user:AuthUser,@Param('id') id:string){return this.evaluation.cancel(user,id)}
 @Get(':id/export') @ApiOperation({summary:'下载包含问题、预期答案和实际回复的 Excel/JSON/CSV'}) async export(@CurrentUser() user:AuthUser,@Param('id') id:string,@Query('format') format='json',@Res() res:Response){const output=await this.evaluation.export(user,id,format);res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',output.mime);res.setHeader('Content-Disposition',`attachment; filename="evaluation-${id}.${format}"`);res.send(output.body)}
}
