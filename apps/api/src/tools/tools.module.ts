import { Module } from "@nestjs/common"

/**
 * 内置工具装配。
 *
 * 内置工具的主体（定义 + 执行器）在 `tool-registry.ts` 的模块级常量里，
 * 无需依赖注入即可工作，因此本模块目前没有 provider。
 *
 * 历史上这里负责两件事：把 LovelineService 实例交给工具桥接层、把情侣
 * 空间的 5 个 couple_* 工具登记进 ToolRegistry —— 该功能已整体移除
 * （代码停放在仓库根 removedfeature/），本模块保留为空壳，
 * 供将来「需要 NestJS 注入才能工作」的内置工具在此装配。
 */
@Module({})
export class ToolsModule {}
