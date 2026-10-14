import { Module } from '@nestjs/common'
import { ChatModule } from '../chat/chat.module'
import { KnowledgeStoreModule } from './knowledge-store.module'
import { KnowledgeAdminService } from './knowledge-admin.service'
import { KnowledgeAdminController } from './knowledge-admin.controller'
import { CampusModule } from '../campus/campus.module'
import {SettingsModule} from '../settings/settings.module'
import {KnowledgeAutomationService} from './knowledge-automation.service'
import {CollectiveTimetableService} from './collective-timetable.service'
@Module({imports:[ChatModule,KnowledgeStoreModule,CampusModule,SettingsModule],providers:[KnowledgeAdminService,KnowledgeAutomationService,CollectiveTimetableService],controllers:[KnowledgeAdminController]})
export class KnowledgeAdminModule {}
