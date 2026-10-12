import { Module } from "@nestjs/common"
import { LlmFactory } from "./llm.factory"
import { ContextBuilderService } from "../context-builder.service"

/**
 * 纯 LLM 基础设施模块（无业务依赖），
 * 供 ChatModule 与 SkillsModule 共用，避免模块循环依赖。
 */
@Module({
  providers: [LlmFactory, ContextBuilderService],
  exports: [LlmFactory, ContextBuilderService]
})
export class LlmModule {}