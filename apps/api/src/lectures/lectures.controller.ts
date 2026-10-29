import {Body,Controller,Get,Param,Post,Put,Query} from '@nestjs/common'
import {ApiBearerAuth,ApiTags} from '@nestjs/swagger'
import {IsArray,ArrayMinSize,ArrayMaxSize,IsObject,IsOptional,IsString,MaxLength} from 'class-validator'
import {Transform} from 'class-transformer'
import {RequirePermissions} from '../common/decorators/permissions.decorator'
import {CurrentUser,type AuthUser} from '../common/decorators/current-user.decorator'
import {LecturesService} from './lectures.service'
class ImportLecturesDto {
 @Transform(({obj})=>obj.records) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsObject({each:true}) records!:Record<string,unknown>[]
 @IsOptional() @IsString() @MaxLength(50) capturedAt?:string
}
@ApiTags('校园讲座') @ApiBearerAuth() @Controller('lectures')
export class LecturesController {
 constructor(private lectures:LecturesService){}
 @Get() list(@Query() query:Record<string,string>){return this.lectures.directory(query)}
 @Get('collector/config') @RequirePermissions('campus:admin') config(){return this.lectures.config()}
 @Put('collector/config') @RequirePermissions('campus:admin') configure(@Body() input:Record<string,unknown>,@CurrentUser() user:AuthUser){return this.lectures.saveConfig(input,user)}
 @Get('collector/status') @RequirePermissions('campus:admin') status(){return this.lectures.status()}
 @Post('collector/test') @RequirePermissions('campus:admin') test(@Body() input:Record<string,unknown>){return this.lectures.test(input)}
 @Post('collector/run') @RequirePermissions('campus:admin') run(@CurrentUser() user:AuthUser){return this.lectures.queue(user)}
 @Post('import') @RequirePermissions('campus:admin') async import(@Body() input:ImportLecturesDto,@CurrentUser() user:AuthUser){
  const result=await this.lectures.importRecords(input.records,input.capturedAt,user);return result
 }
 @Get(':id') detail(@Param('id') id:string){return this.lectures.detail(id)}
}
