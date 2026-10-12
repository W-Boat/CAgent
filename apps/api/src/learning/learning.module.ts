import { Module } from "@nestjs/common"
import { KnowledgeStoreModule } from '../knowledge/knowledge-store.module'
import { LearningService } from "./learning.service"
import { LearningController } from "./learning.controller"

@Module({
  imports:[KnowledgeStoreModule],
  controllers: [LearningController],
  providers: [LearningService],
  exports: [LearningService]
})
export class LearningModule {}
