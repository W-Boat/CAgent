<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title">消息审计</h2>
        <p class="page-subtitle">全平台消息内容检索与合规标记 · 共 {{ total }} 条</p>
      </div>
      <div class="page-actions">
        <el-button @click="load">
          <el-icon><Refresh /></el-icon> 刷新
        </el-button>
      </div>
    </div>

    <div class="filter-bar">
      <el-input
        v-model="query.keyword"
        placeholder="搜索消息内容"
        clearable
        style="width: 260px"
        @keyup.enter="reload"
        @clear="reload"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>

      <el-select v-model="query.conversationId" placeholder="按会话筛选" clearable filterable style="width: 220px" @change="reload">
        <el-option
          v-for="c in conversations"
          :key="c.id"
          :label="c.title || c.id"
          :value="c.id"
        />
      </el-select>

      <el-select v-model="query.role" placeholder="全部角色" clearable style="width: 130px" @change="reload">
        <el-option label="用户" value="user" />
        <el-option label="助手" value="assistant" />
        <el-option label="系统" value="system" />
        <el-option label="工具" value="tool" />
      </el-select>

      <el-select v-model="query.flagged" placeholder="全部消息" clearable style="width: 140px" @change="reload">
        <el-option label="仅看已标记" value="true" />
        <el-option label="仅看未标记" value="false" />
      </el-select>

      <el-date-picker
        v-model="range"
        type="daterange"
        value-format="YYYY-MM-DD"
        range-separator="~"
        start-placeholder="开始日期"
        end-placeholder="结束日期"
        style="width: 250px"
        @change="reload"
      />

      <el-button @click="reset">重置</el-button>
    </div>

    <el-table :data="items" v-loading="loading" stripe size="small">
      <el-table-column label="时间" width="168">
        <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
      </el-table-column>

      <el-table-column label="角色" width="90">
        <template #default="{ row }">
          <el-tag :type="roleTag(row.role)" size="small" effect="plain">{{ roleText(row.role) }}</el-tag>
        </template>
      </el-table-column>

      <el-table-column label="内容" min-width="320">
        <template #default="{ row }">
          <div class="content-cell" @click="showDetail(row)">
            {{ truncate(row.content, 120) }}
          </div>
        </template>
      </el-table-column>

      <el-table-column label="模型" width="150">
        <template #default="{ row }">
          <span class="mono small">{{ row.modelKey || "-" }}</span>
        </template>
      </el-table-column>

      <el-table-column label="Token" width="100">
        <template #default="{ row }">{{ formatNumber(row.totalTokens) }}</template>
      </el-table-column>

      <el-table-column label="状态" width="95">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)" size="small" effect="plain">
            {{ statusText(row.status) }}
          </el-tag>
        </template>
      </el-table-column>

      <el-table-column label="标记" width="90">
        <template #default="{ row }">
          <el-tag v-if="row.flagged" type="danger" size="small" effect="plain">已标记</el-tag>
          <span v-else class="muted">-</span>
        </template>
      </el-table-column>

      <el-table-column label="操作" width="140" fixed="right">
        <template #default="{ row }">
          <el-button text type="primary" size="small" @click="showDetail(row)">详情</el-button>
          <el-button
            text
            :type="row.flagged ? 'info' : 'danger'"
            size="small"
            :disabled="!auth.can('message:flag')"
            @click="toggleFlag(row)"
          >
            {{ row.flagged ? "取消标记" : "标记" }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      v-if="total > 0"
      v-model:current-page="query.page"
      v-model:page-size="query.pageSize"
      :total="total"
      :page-sizes="[20, 50, 100]"
      layout="total, sizes, prev, pager, next"
      background
      class="pager"
      @current-change="load"
      @size-change="reload"
    />

    <el-drawer v-model="detailVisible" title="消息详情" size="620px">
      <div v-if="current">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="角色">
            <el-tag :type="roleTag(current.role)" size="small">{{ roleText(current.role) }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="序号">#{{ current.seq }}</el-descriptions-item>
          <el-descriptions-item label="模型">
            <span class="mono small">{{ current.modelKey || "-" }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="供应商">
            <span class="mono small">{{ current.providerKey || "-" }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="Token（入/出）">
            {{ current.promptTokens }} / {{ current.completionTokens }}
          </el-descriptions-item>
          <el-descriptions-item label="延迟">{{ formatDuration(current.latencyMs) }}</el-descriptions-item>
          <el-descriptions-item label="创建时间">{{ formatDateTime(current.createdAt) }}</el-descriptions-item>
          <el-descriptions-item label="会话">
            <span class="mono small">{{ truncate(current.conversationId, 14) }}</span>
          </el-descriptions-item>
        </el-descriptions>

        <h4 class="detail-title">内容</h4>
        <div class="content-body">{{ current.content }}</div>

        <template v-if="current.reasoning">
          <h4 class="detail-title">思考过程</h4>
          <pre class="result-body">{{ current.reasoning }}</pre>
        </template>

        <template v-if="current.toolCalls?.length">
          <h4 class="detail-title">工具调用</h4>
          <pre class="result-body">{{ JSON.stringify(current.toolCalls, null, 2) }}</pre>
        </template>

        <el-alert
          v-if="current.error"
          :title="current.error"
          type="error"
          show-icon
          :closable="false"
          class="detail-alert"
        />

        <template v-if="current.flagged">
          <h4 class="detail-title">标记备注</h4>
          <div class="muted">{{ current.flagNote || "（无备注）" }}</div>
        </template>

        <div class="detail-actions">
          <el-button
            :type="current.flagged ? 'info' : 'danger'"
            :disabled="!auth.can('message:flag')"
            @click="toggleFlag(current)"
          >
            {{ current.flagged ? "取消标记" : "标记为违规" }}
          </el-button>
          <el-button @click="copyMessage(current.content)">
            <el-icon><CopyDocument /></el-icon> 复制内容
          </el-button>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue"
import { conversationsApi } from "@/api"
import { toastError, toastOk } from "@/api/client"
import { useAuthStore } from "@/stores/auth"
import type { ConversationItem, MessageItem } from "@/api/types"
import {
  copyText,
  formatDateTime,
  formatDuration,
  formatNumber,
  statusText,
  statusType,
  truncate
} from "@/utils/format"

/*
 * 声明组件名，供 <keep-alive :include> 匹配（约定与路由 name 一致）。
 * 不声明的话缓存会静默失效：切走再回来仍会重建组件、重新拉数据。
 */
defineOptions({ name: "admin-messages" })

const auth = useAuthStore()

const items = ref<MessageItem[]>([])
const total = ref(0)
const loading = ref(false)
const conversations = ref<ConversationItem[]>([])
const range = ref<[string, string] | null>(null)

const query = reactive({
  keyword: "",
  conversationId: "",
  role: "",
  flagged: "",
  page: 1,
  pageSize: 20
})

const detailVisible = ref(false)
const current = ref<MessageItem | null>(null)

function roleText(role: string) {
  const map: Record<string, string> = {
    system: "系统",
    user: "用户",
    assistant: "助手",
    tool: "工具"
  }
  return map[role] || role
}

function roleTag(role: string) {
  if (role === "user") return "primary"
  if (role === "assistant") return "success"
  if (role === "tool") return "warning"
  return "info"
}

async function load() {
  loading.value = true
  try {
    const page = await conversationsApi.adminMessages({
      keyword: query.keyword || undefined,
      conversationId: query.conversationId || undefined,
      role: query.role || undefined,
      flagged: query.flagged || undefined,
      from: range.value?.[0],
      to: range.value?.[1],
      page: query.page,
      pageSize: query.pageSize
    })
    items.value = page.items
    total.value = page.total
  } catch (error) {
    toastError(error, "消息列表加载失败")
  } finally {
    loading.value = false
  }
}

function reload() {
  query.page = 1
  void load()
}

function reset() {
  query.keyword = ""
  query.conversationId = ""
  query.role = ""
  query.flagged = ""
  range.value = null
  reload()
}

function showDetail(row: MessageItem) {
  current.value = row
  detailVisible.value = true
}

async function toggleFlag(row: MessageItem) {
  const next = !row.flagged
  try {
    await conversationsApi.flagMessage(row.id, next)
    row.flagged = next
    if (current.value?.id === row.id) current.value.flagged = next
    toastOk(next ? "已标记为违规消息" : "已取消标记")
  } catch (error) {
    toastError(error)
  }
}

async function copyMessage(text: string) {
  await copyText(text)
  toastOk("已复制到剪贴板")
}

onMounted(async () => {
  await load()
  try {
    const page = await conversationsApi.adminAll({ page: 1, pageSize: 200 })
    conversations.value = page.items
  } catch {
    // 会话下拉失败不影响主列表
  }
})
</script>

<style scoped>
.filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
}
.content-cell {
  font-size: 13px;
  line-height: 1.6;
  cursor: pointer;
}
.content-cell:hover {
  color: var(--cg-brand);
}
.small {
  font-size: 11.5px;
}
.pager {
  margin-top: 14px;
  justify-content: flex-end;
}
.detail-title {
  margin: 20px 0 10px;
  font-size: 13.5px;
  font-weight: 600;
}
.content-body {
  padding: 12px 14px;
  font-size: 13px;
  line-height: 1.8;
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--cg-card-bg-soft);
  border-radius: 8px;
}
.result-body {
  max-height: 280px;
  padding: 12px;
  overflow: auto;
  font-size: 12.5px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  background: #0f172a;
  color: #e2e8f0;
  border-radius: 8px;
}
.detail-alert {
  margin-top: 14px;
}
.detail-actions {
  display: flex;
  gap: 8px;
  margin-top: 22px;
}
</style>