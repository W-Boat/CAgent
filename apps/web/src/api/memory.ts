import { del, get, patch, post } from "./client"

export interface UserMemory {
  id: string
  userId: string
  agentId: string | null
  source: "USER_EXPLICIT" | "SYSTEM_INFERRED" | "USER_EXTRACTED"
  status: "PENDING" | "ACTIVE" | "ARCHIVED"
  content: string
  category: string
  importance: number
  usedCount: number
  expiresAt: string | null
  sourceConversationId: string | null
  sourceMessageId: string | null
  reviewedById: string | null
  reviewedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateMemoryDto {
  content: string
  agentId?: string
  category?: string
  importance?: number
  expiresAt?: string
}

export interface UpdateMemoryDto {
  content?: string
  category?: string
  importance?: number
  expiresAt?: string | null
}

export interface MemoryStats {
  total: number
  active: number
  archived: number
  byCategory: Array<{
    category: string
    count: number
  }>
}

export const memoryApi = {
  /** 获取记忆统计 */
  getStats: () => get<MemoryStats>("/memory/stats"),

  /** 获取用户记忆列表 */
  getMemories: (agentId?: string, limit?: number) =>
    get<UserMemory[]>("/memory", { agentId, limit }),

  /** 创建记忆 */
  create: (data: CreateMemoryDto) => post<UserMemory>("/memory", data),

  /** 更新记忆 */
  update: (id: string, data: UpdateMemoryDto) =>
    patch<UserMemory>(`/memory/${id}`, data),

  /** 删除记忆 */
  delete: (id: string) => del<{ success: boolean }>(`/memory/${id}`),

  /** 批量删除记忆 */
  batchDelete: (memoryIds: string[]) =>
    post<{ success: boolean; count: number }>("/memory/batch-delete", { memoryIds })
}
