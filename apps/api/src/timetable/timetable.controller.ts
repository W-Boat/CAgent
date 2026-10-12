import { Body, Controller, Delete, Get, Header, Param, Patch, Post, UseGuards } from '@nestjs/common'
import { TimetableReadGuard } from './timetable-read.guard'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { CaptureDto, TimetablePreferencesDto, TimetableBrowserActionDto } from './timetable.dto'
import {TimetableBrowserService} from './timetable-browser.service'
import { TimetableService } from './timetable.service'
@Controller('timetable')
export class TimetableController {
  constructor(private readonly service:TimetableService,private readonly browser:TimetableBrowserService){}
  @Post('browser') @Header('Cache-Control','no-store') @UseGuards(TimetableReadGuard) start(@CurrentUser('id') id:string){return this.browser.start(id)}
  @Get('browser/:session/frame') @Header('Cache-Control','no-store') frame(@CurrentUser('id') id:string,@Param('session') session:string){return this.browser.frame(id,session)}
  @Post('browser/:session/action') @Header('Cache-Control','no-store') @UseGuards(TimetableReadGuard) action(@CurrentUser('id') id:string,@Param('session') session:string,@Body() dto:TimetableBrowserActionDto){return this.browser.action(id,session,dto)}
  @Post('browser/:session/capture') @Header('Cache-Control','no-store') @UseGuards(TimetableReadGuard) capture(@CurrentUser('id') id:string,@Param('session') session:string){return this.browser.capture(id,session)}
  @Delete('browser/:session') close(@CurrentUser('id') id:string,@Param('session') session:string){return this.browser.close(id,session)}
  @Delete('browser') closeAll(@CurrentUser('id') id:string){return this.browser.closeOwner(id)}
  @Get() @Header('Cache-Control','no-store') get(@CurrentUser('id') id:string){return this.service.get(id)}
  @Post('preview') @UseGuards(TimetableReadGuard) preview(@Body() body:CaptureDto){return this.service.preview(body)}
  @Post() @UseGuards(TimetableReadGuard) save(@CurrentUser('id') id:string,@Body() body:CaptureDto){return this.service.save(id,body)}
  @Patch('preferences') preferences(@CurrentUser('id') id:string,@Body() body:TimetablePreferencesDto){return this.service.preferences(id,body)}
  @Get('upcoming') @Header('Cache-Control','no-store') upcoming(@CurrentUser('id') id:string){return this.service.upcoming(id)}
  @Get('calendar') @Header('Cache-Control','no-store') calendar(@CurrentUser('id') id:string){return this.service.calendar(id)}
  @Delete() remove(@CurrentUser('id') id:string){return this.service.remove(id)}
}
