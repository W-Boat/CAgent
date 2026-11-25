import {CampusActivityService} from "./campus-activity.service"
import {AuthModule} from "../auth/auth.module"
import { Module } from "@nestjs/common"
import { CampusController } from "./campus.controller"
import { CampusGuideService } from "./campus-guide.service"
import { CampusGuideRunService } from "./campus-guide-run.service"
import { BrowserModule } from "../browser/browser.module"
import { KnowledgeStoreModule } from '../knowledge/knowledge-store.module'
import { StudentPortalController } from './student-portal.controller'
import { StudentPortalService } from './student-portal.service'
import { StudentDirectoryService } from './student-directory.service'
import { PublicNewsService } from './public-news.service'
import { SettingsModule } from '../settings/settings.module'

/**
 * campusdemo 校园门户导览模块。
 *
 * 复用平台的浏览器操控引擎（BrowserModule）与 Prisma，不引入新的外部依赖，
 * 因此天然融入已有的权限体系、审计与后台管理。
 */
@Module({
  imports: [BrowserModule,KnowledgeStoreModule,AuthModule,SettingsModule],
  controllers: [CampusController,StudentPortalController],
  providers: [CampusGuideService, CampusGuideRunService,CampusActivityService,StudentPortalService,PublicNewsService,StudentDirectoryService],
  exports: [CampusGuideService, CampusGuideRunService,CampusActivityService]
})
export class CampusModule {}
