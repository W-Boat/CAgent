import {CampusActivityService} from "./campus-activity.service"
import {AuthModule} from "../auth/auth.module"
import { Module } from "@nestjs/common"
import { CampusController } from "./campus.controller"
import { CampusGuideService } from "./campus-guide.service"
import { CampusGuideRunService } from "./campus-guide-run.service"
import { BrowserModule } from "../browser/browser.module"
import { KnowledgeStoreModule } from '../knowledge/knowledge-store.module'

/**
 * UCASS 校园门户导览模块。
 *
 * 复用平台的浏览器操控引擎（BrowserModule）与 Prisma，不引入新的外部依赖，
 * 因此天然融入已有的权限体系、审计与后台管理。
 */
@Module({
  imports: [BrowserModule,KnowledgeStoreModule,AuthModule],
  controllers: [CampusController],
  providers: [CampusGuideService, CampusGuideRunService,CampusActivityService],
  exports: [CampusGuideService, CampusGuideRunService,CampusActivityService]
})
export class CampusModule {}
