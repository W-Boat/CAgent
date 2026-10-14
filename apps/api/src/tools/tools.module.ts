import { Module } from "@nestjs/common"

/**
 * 内置工具装配。
 *
 * 内置工具的主体（定义 + 执行器）在 `tool-registry.ts` 的模块级常量里，
 * 无需依赖注入即可工作，因此本模块目前没有 provider。
 *
 * 本模块保留为空壳，供需要 NestJS 注入的内置工具在此装配。
 */
@Module({})
export class ToolsModule {}
