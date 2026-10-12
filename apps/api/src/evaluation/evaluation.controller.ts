import {Body,Controller,Get,Param,Post,Query,Res} from '@nestjs/common'
import {ApiBearerAuth,ApiOperation,ApiTags} from '@nestjs/swagger'
import type {Response} from 'express'
import {CurrentUser,type AuthUser} from '../common/decorators/current-user.decorator'
import {RequirePermissions} from '../common/decorators/permissions.decorator'
import {CreateEvaluationDto} from './evaluation.dto'
import {EvaluationService} from './evaluation.service'
@ApiTags('批量对话测试') @ApiBearerAuth() @RequirePermissions('conversation:read') @Controller('evaluations')
export class EvaluationController {
 constructor(private readonly evaluation:EvaluationService){}
 @Post() @ApiOperation({summary:'导入 JSON/CSV 测试集并异步执行多轮对话'}) create(@CurrentUser() user:AuthUser,@Body() dto:CreateEvaluationDto){return this.evaluation.create(user,dto)}
 @Get() @ApiOperation({summary:'任务列表'}) list(@CurrentUser() user:AuthUser){return this.evaluation.list(user)}
 @Get(':id') @ApiOperation({summary:'执行状态与回答预览'}) detail(@CurrentUser() user:AuthUser,@Param('id') id:string){return this.evaluation.detail(user,id)}
 @Post(':id/cancel') @ApiOperation({summary:'停止任务，保留已有结果'}) cancel(@CurrentUser() user:AuthUser,@Param('id') id:string){return this.evaluation.cancel(user,id)}
 @Get(':id/export') @ApiOperation({summary:'下载包含批次、轮次、题目和回复的 JSON/CSV'}) async export(@CurrentUser() user:AuthUser,@Param('id') id:string,@Query('format') format='json',@Res() res:Response){const output=await this.evaluation.export(user,id,format);res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',output.mime);res.setHeader('Content-Disposition',`attachment; filename="evaluation-${id}.${format}"`);res.send(output.body)}
}
