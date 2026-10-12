import { Module } from "@nestjs/common"
import { SkillsEngineService } from "./skills-engine.service"
import { SkillImportService } from "./skill-import.service"
import { SkillsController } from "./skills.controller"
import { BrowserModule } from "../browser/browser.module"
import { LlmModule } from "../chat/llm/llm.module"
import { ProvidersModule } from "../providers/providers.module"
import { CampusModule } from "../campus/campus.module"

@Module({
  imports: [BrowserModule, LlmModule, ProvidersModule, CampusModule],
  controllers: [SkillsController],
  providers: [SkillsEngineService, SkillImportService],
  exports: [SkillsEngineService, SkillImportService]
})
export class SkillsModule {}