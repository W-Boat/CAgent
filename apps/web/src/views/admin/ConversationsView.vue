<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title">会话审计</h2>
        <p class="page-subtitle">全平台会话检索与内容核查 · 共 {{ total }} 个会话</p>
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
        placeholder="搜索标题 / 用户邮箱或姓名"
        clearable
        style="width: 250px"
        @keyup.enter="reload"
        @clear="reload"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>

      <el-select v-model="query.status" placeholder="全部状态" clearable style="width: 140px" @change="reload">
        <el-option label="进行中" value="ACTIVE" />
        <el-option label="已归档" value="ARCHIVED" />
        <el-option label="已删除" value="DELETED" />
      </el-select>

      <el-select
        v-model="query.userId"
        placeholder="按用户筛选"
        clearable
        filterable
        style="width: 220px"
        @change="reload"
      >
        <el-option
          v-for="u in users"
          :key="u.id"
          :label="`${u.name}（${u.email}）`"
          :value="u.id"
        />
      </el-select>

      <el-button @click="reset">重置</el-button>
    </div>

    <el-table :data="items" v-loading="loading" stripe size="small">
      <el-table-column label="会话" min-width="240">
        <template #default="{ row }">
          <div class="conv-cell">
            <el-icon class="conv-icon"><ChatLineSquare /></el-icon>
            <div class="conv-main">
              <div class="conv-title">
                {{ row.title || "未命名会话" }}
                <el-tag v-if="row.pinned" size="small" type="warning" effect="plain">置顶</el-tag>
              </div>
              <div class="muted small mono">{{ row.id }}</div>
            </div>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="所属用户" min-width="180">
        <template #default="{ row }">
          <div class="user-cell">
            <span>{{ row.user?.name || "-" }}</span>
            <span class="muted small">{{ row.user?.email || "" }}</span>
            <span v-if="row.user?.department" class="muted small">{{ row.user.department }}</span>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="模型 / 智能体" width="180">
        <template #default="{ row }">
          <div class="model-cell">
            <el-tag v-if="row.model" size="small" effect="plain">{{ row.model.name }}</el-tag>
            <el-tag v-if="row.agent" size="small" type="success" effect="plain">{{ row.agent.name }}</el-tag>
            <span v-if="!row.model && !row.agent" class="muted">-</span>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="消息数" width="90">
        <template #default="{ row }">{{ row._count?.messages ?? row.messageCount ?? 0 }}</template>
      </el-table-column>

      <el-table-column label="Token" width="110">
        <template #default="{ row }">{{ formatTokens(row.totalTokens) }}</template>
      </el-table-column>

      <el-table-column label="状态" width="95">
        <template #default="{ row }">
          <el-tag :type="convStatusType(row.status)" size="small" effect="plain">
            {{ convStatusText(row.status) }}
          </el-tag>
        </template>
      </el-table-column>

      <el-table-column label="更新时间" width="168">
        <template #default="{ row }">{{ formatDateTime(row.updatedAt) }}</template>
      </el-table-column>

      <el-table-column label="操作" width="150" fixed="right">
        <template #default="{ row }">
          <el-button text type="primary" size="small" @click="showDetail(row)">查看对话</el-button>
          <el-button
            text
            type="primary"
            size="small"
            :disabled="!auth.can('conversation:export')"
            @click="exportConv(row)"
          >
            导出
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

    <el-drawer v-model="detailVisible" :title="current?.title || '会话详情'" size="720px">
      <div v-if="current" v-loading="detailLoading">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="用户">
            {{ current.user?.name || "-" }}
            <span class="muted small">{{ current.user?.email || "" }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="模型">{{ current.model?.name || "-" }}</el-descriptions-item>
          <el-descriptions-item label="智能体">{{ current.agent?.name || "-" }}</el-descriptions-item>
          <el-descriptions-item label="温度">{{ current.temperature }}</el-descriptions-item>
          <el-descriptions-item label="创建时间">{{ formatDateTime(current.createdAt) }}</el-descriptions-item>
          <el-descriptions-item label="更新时间">{{ formatDateTime(current.updatedAt) }}</el-descriptions-item>
        </el-descriptions>

        <div v-if="current.systemPrompt" class="sys-prompt">
          <h4 class="detail-title">系统提示词</h4>
          <pre class="sys-body">{{ current.systemPrompt }}</pre>
        </div>

        <h4 class="detail-title">消息记录（{{ messages.length }}条）</h4>
        <div class="msg-list">
          <div v-for="msg in messages" :key="msg.id" class="msg" :class="msg.role">
            <div class="msg-head">
              <el-tag size="small" :type="roleTag(msg.role)" effect="plain">{{ roleText(msg.role) }}</el-tag>
              <span class="muted small">#{{ msg.seq }}</span>
              <span class="muted small">{{ formatDateTime(msg.createdAt) }}</span>
              <el-tag v-if="msg.totalTokens" size="small" type="info" effect="plain">
                {{ msg.totalTokens }} tokens
              </el-tag>
              <el-tag v-if="msg.flagged" size="small" type="danger" effect="plain">已标记</el-tag>
              <el-tag v-if="msg.status !== 'SUCCESS'" size="small" type="warning" effect="plain">
                {{ statusText(msg.status) }}
              </el-tag>
            </div>
            <div class="msg-body">{{ msg.content }}</div>
            <div v-if="msg.reasoning" class="msg-reasoning">
              <div class="muted small">思考过程</div>
              <pre>{{ msg.reasoning }}</pre>
            </div>
            <el-alert
              v-if="msg.error"
              :title="msg.error"
              type="error"
              show-icon
              :closable="false"
              class="msg-error"
            />
          </div>
          <el-empty v-if="messages.length === 0" description="该会话没有消息" :image-size="70" />
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue"
import { conversationsApi, usersApi } from "@/api"
import { toastError, toastOk } from "@/api/client"
import { useAuthStore } from "@/stores/auth"
import type { ConversationItem, MessageItem, UserItem } from "@/api/types"
import {
  downloadJson,
  formatDateTime,
  formatTokens,
  statusText
} from "@/utils/format"

/*
 * 声明组件名，供 <keep-alive :include> 匹配（约定与路由 name 一致）。
 * 不声明的话缓存会静默失效：切走再回来仍会重建组件、重新拉数据。
 */
defineOptions({ name: "admin-conversations" })

const auth = useAuthStore()

interface AdminConversation extends ConversationItem {
  systemPrompt?: string | null
  _count?: { messages: number }
}

const items = ref<AdminConversation[]>([])
const total = ref(0)
const loading = ref(false)
const users = ref<UserItem[]>([])

const query = reactive({
  keyword: "",
  status: "",
  userId: "",
  page: 1,
  pageSize: 20
})

const detailVisible = ref(false)
const detailLoading = ref(false)
const current = ref<AdminConversation | null>(null)
const messages = ref<MessageItem[]>([])

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

function convStatusText(status: string) {
  const map: Record<string, string> = {
    ACTIVE: "进行中",
    ARCHIVED: "已归档",
    DELETED: "已删除"
  }
  return map[status] || status
}

function convStatusType(status: string) {
  if (status === "ACTIVE") return "success"
  if (status === "ARCHIVED") return "info"
  return "danger"
}

async function load() {
  loading.value = true
  try {
    const page = await conversationsApi.adminAll({
      keyword: query.keyword || undefined,
      status: query.status || undefined,
      userId: query.userId || undefined,
      page: query.page,
      pageSize: query.pageSize
    })
    items.value = page.items as AdminConversation[]
    total.value = page.total
  } catch (error) {
    toastError(error, "会话列表加载失败")
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
  query.status = ""
  query.userId = ""
  reload()
}

async function showDetail(row: AdminConversation) {
  detailVisible.value = true
  detailLoading.value = true
  current.value = row
  messages.value = []
  try {
    const data = await conversationsApi.detail(row.id)
    current.value = data as AdminConversation
    messages.value = data.messages || []
  } catch (error) {
    toastError(error, "会话详情加载失败")
  } finally {
    detailLoading.value = false
  }
}

async function exportConv(row: AdminConversation) {
  try {
    const data = await conversationsApi.export(row.id)
    downloadJson(data, `conversation-${row.id}.json`)
    toastOk("会话已导出")
  } catch (error) {
    toastError(error, "导出失败")
  }
}

onMounted(async () => {
  await load()
  try {
    const page = await usersApi.list({ page: 1, pageSize: 200 })
    users.value = page.items
  } catch {
    // 用户下拉失败不影响主列表
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
.conv-cell {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.conv-icon {
  margin-top: 2px;
  color: var(--cg-brand);
}
.conv-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13.5px;
  font-weight: 500;
}
.user-cell,
.model-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.model-cell {
  flex-direction: row;
  flex-wrap: wrap;
  gap: 4px;
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
.sys-prompt .sys-body {
  max-height: 180px;
  padding: 12px;
  overflow: auto;
  font-size: 12.5px;
  line-height: 1.7;
  white-space: pre-wrap;
  background: var(--cg-card-bg-soft);
  border-radius: 8px;
}
.msg-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.msg {
  padding: 12px 14px;
  border: 1px solid var(--cg-border);
  border-radius: 10px;
}
.msg.user {
  background: var(--cg-card-bg-soft);
}
.msg.assistant {
  background: var(--cg-card-bg);
  border-color: var(--cg-info-border);
}
/* system / tool 用语义色，暗色主题下自动切换为半透明叠加而不是刺眼白底 */
.msg.system {
  background: var(--cg-warning-soft);
  border-color: var(--cg-warning-border);
}
.msg.tool {
  background: var(--cg-info-soft);
  border-color: var(--cg-info-border);
}
.msg-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.msg-body {
  font-size: 13px;
  line-height: 1.75;
  white-space: pre-wrap;
  word-break: break-word;
}
.msg-reasoning {
  padding: 8px 10px;
  margin-top: 8px;
  background: var(--cg-hover-bg);
  border-radius: 6px;
}
.msg-reasoning pre {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.65;
  white-space: pre-wrap;
}
.msg-error {
  margin-top: 8px;
}
</style>