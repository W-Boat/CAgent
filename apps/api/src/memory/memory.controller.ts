import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards
} from "@nestjs/common"
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger"
import { MemoryService } from "./memory.service"
import { CurrentUser } from "../common/decorators/current-user.decorator"
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard"
import {
  CreateMemoryDto,
  UpdateMemoryDto,
  BatchDeleteMemoryDto
} from "./dto/memory.dto"

@ApiTags("记忆")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("memory")
export class MemoryController {
  constructor(private readonly memoryService: MemoryService) {}

  @Get("stats")
  @ApiOperation({ summary: "获取记忆统计" })
  async getStats(@CurrentUser() user: { id: string }) {
    return this.memoryService.getMemoryStats(user.id)
  }

  @Get()
  @ApiOperation({ summary: "获取用户记忆列表" })
  async getMemories(
    @CurrentUser() user: { id: string },
    @Query("agentId") agentId?: string,
    @Query("limit") limit?: string
  ) {
    return this.memoryService.getUserMemories(
      user.id,
      agentId,
      Math.min(100,Math.max(1,Number(limit)||50)),
      true
    )
  }

  @Post()
  @ApiOperation({ summary: "创建记忆" })
  async createMemory(
    @CurrentUser() user: { id: string },
    @Body() dto: CreateMemoryDto
  ) {
    return this.memoryService.upsertMemory({
      userId: user.id,
      agentId: dto.agentId,
      content: dto.content,
      category: dto.category,
      importance: dto.importance,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined
    })
  }

  @Patch(":id")
  @ApiOperation({ summary: "更新记忆" })
  async updateMemory(
    @Param("id") id: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateMemoryDto
  ) {
    return this.memoryService.updateMemory(id, user.id, {
      content: dto.content,
      category: dto.category,
      importance: dto.importance,
      expiresAt: dto.expiresAt === null ? null : dto.expiresAt ? new Date(dto.expiresAt) : undefined
    })
  }

  @Delete(":id")
  @ApiOperation({ summary: "删除记忆" })
  async deleteMemory(
    @Param("id") id: string,
    @CurrentUser() user: { id: string }
  ) {
    await this.memoryService.deleteMemory(id, user.id)
    return { success: true }
  }

  @Post("batch-delete")
  @ApiOperation({ summary: "批量删除记忆" })
  async batchDeleteMemories(
    @CurrentUser() user: { id: string },
    @Body() dto: BatchDeleteMemoryDto
  ) {
    await this.memoryService.batchDeleteMemories(dto.memoryIds, user.id)
    return { success: true, count: dto.memoryIds.length }
  }
}
