import { Module } from '@nestjs/common'
import { TimetableService } from './timetable.service'
import { TimetableController } from './timetable.controller'
import {SettingsModule} from '../settings/settings.module'
import {TimetableReadGuard} from './timetable-read.guard'
import {TimetableBrowserService} from './timetable-browser.service'
@Module({imports:[SettingsModule],providers:[TimetableService,TimetableReadGuard,TimetableBrowserService],controllers:[TimetableController],exports:[TimetableService]})
export class TimetableModule {}
