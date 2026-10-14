import { Module } from "@nestjs/common"
import { ChatService } from "./chat.service"
import {ResponseCacheService} from './response-cache.service'
import {RuntimeCheckpointService} from './runtime/runtime-checkpoint.service'
import { ChatController } from "./chat.controller"
import { LlmModule } from "./llm/llm.module"
import { ProvidersModule } from "../providers/providers.module"
import { ModelsModule } from "../models/models.module"
import { SettingsModule } from "../settings/settings.module"
import { SkillsModule } from "../skills/skills.module"
import { AgentsModule } from "../agents/agents.module"
import { BrowserModule } from "../browser/browser.module"
import { LearningModule } from "../learning/learning.module"
import { MemoryModule } from "../memory/memory.module"
import { CampusModule } from "../campus/campus.module"
import { KnowledgeStoreModule } from '../knowledge/knowledge-store.module'
import {EvaluationController} from '../evaluation/evaluation.controller'
import {EvaluationService} from '../evaluation/evaluation.service'

@Module({
  imports: [
    LlmModule,
    ProvidersModule,
    ModelsModule,
    SettingsModule,
    SkillsModule,
    AgentsModule,
    BrowserModule,
    LearningModule,
    MemoryModule,
    // 校园导览知识库检索服务（统一知识库 answerBlock），供对话层做检索兜底注入
    CampusModule, KnowledgeStoreModule
  ],
  controllers: [ChatController,EvaluationController],
  providers: [ChatService,ResponseCacheService,RuntimeCheckpointService,EvaluationService],
  exports: [ChatService]
})
export class ChatModule {}
