<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title">审计日志</h2>
        <p class="page-subtitle">
          记录管理员的关键操作，便于回溯与追责 · 共 {{ total }} 条
        </p>
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
        placeholder="搜索操作人 / 动作 / 资源"
        clearable
        style="width: 230px"
        @keyup.enter="reload"
        @clear="reload"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>

      <el-select v-model="query.action" placeholder="全部动作" clearable filterable style="width: 200px" @change="reload">
        <el-option
          v-for="a in facets.actions"
          :key="a.value"
          :label="`${a.value} (${a.count})`"
          :value="a.value"
        />
      </el-select>

      <el-select v-model="query.resource" placeholder="全部资源" clearable style="width: 160px" @change="reload">
        <el-option
          v-for="r in facets.resources"
          :key="r.value"
          :label="`${r.value} (${r.count})`"
          :value="r.value"
        />
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

      <el-select v-model="query.onlyFailed" placeholder="全部结果" clearable style="width: 130px" @change="reload">
        <el-option label="只看失败" value="true" />
      </el-select>

      <el-button @click="reset">重置</el-button>
    </div>

    <el-table :data="logs" v-loading="loading" stripe size="small">
      <el-table-column label="时间" width="168">
        <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
      </el-table-column>

      <el-table-column label="操作人" min-width="170">
        <template #default="{ row }">
          <div class="actor-cell">
            <el-avatar :size="24" :src="row.user?.avatar || undefined">
              {{ (row.user?.name || row.actor || "S").slice(0, 1) }}
            </el-avatar>
            <div>
              <div>{{ row.user?.name || row.actor || "系统" }}</div>
              <div class="muted small">{{ row.user?.email || row.ip || "-" }}</div>
            </div>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="动作" width="190">
        <template #default="{ row }">
          <el-tag size="small" effect="plain" :type="actionTag(row.action)">{{ row.action }}</el-tag>
        </template>
      </el-table-column>

      <el-table-column label="资源" width="130">
        <template #default="{ row }">
          <span class="mono small">{{ row.resource }}</span>
        </template>
      </el-table-column>

      <el-table-column label="资源 ID" width="150">
        <template #default="{ row }">
          <span v-if="row.resourceId" class="mono small">{{ truncate(row.resourceId, 16) }}</span>
          <span v-else class="muted">-</span>
        </template>
      </el-table-column>

      <el-table-column label="详情" min-width="220">
        <template #default="{ row }">
          <span class="muted small">{{ detailPreview(row.detail) }}</span>
        </template>
      </el-table-column>

      <el-table-column label="IP" width="130">
        <template #default="{ row }">
          <span class="mono small">{{ row.ip || "-" }}</span>
        </template>
      </el-table-column>

      <el-table-column label="结果" width="80">
        <template #default="{ row }">
          <el-tag :type="row.success ? 'success' : 'danger'" size="small" effect="plain">
            {{ row.success ? "成功" : "失败" }}
          </el-tag>
        </template>
      </el-table-column>

      <el-table-column label="" width="70" fixed="right">
        <template #default="{ row }">
          <el-button text type="primary" size="small" @click="showDetail(row)">详情</el-button>
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

    <el-drawer v-model="detailVisible" title="审计日志详情" size="560px">
      <div v-if="current">
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="时间">{{ formatDateTime(current.createdAt) }}</el-descriptions-item>
          <el-descriptions-item label="操作人">
            {{ current.user?.name || current.actor || "系统" }}
            <span class="muted">{{ current.user?.email || "" }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="动作">
            <el-tag size="small" effect="plain">{{ current.action }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="资源">{{ current.resource }}</el-descriptions-item>
          <el-descriptions-item label="资源 ID">
            <span class="mono small">{{ current.resourceId || "-" }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="IP">
            <span class="mono small">{{ current.ip || "-" }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="结果">
            <el-tag :type="current.success ? 'success' : 'danger'" size="small">
              {{ current.success ? "成功" : "失败" }}
            </el-tag>
          </el-descriptions-item>
        </el-descriptions>

        <h4 class="detail-title">请求详情</h4>
        <pre class="result-body">{{ JSON.stringify(current.detail ?? {}, null, 2) }}</pre>

        <template v-if="current.userAgent">
          <h4 class="detail-title">User-Agent</h4>
          <div class="muted small">{{ current.userAgent }}</div>
        </template>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue"
import { auditApi } from "@/api"
import { toastError } from "@/api/client"
import type { AuditLog } from "@/api/types"
import { formatDateTime, truncate } from "@/utils/format"

/*
 * 声明组件名，供 <keep-alive :include> 匹配（约定与路由 name 一致）。
 * 不声明的话缓存会静默失效：切走再回来仍会重建组件、重新拉数据。
 */
defineOptions({ name: "admin-audit" })

const logs = ref<AuditLog[]>([])
const total = ref(0)
const loading = ref(false)
const facets = ref<{
  actions: { value: string; count: number }[]
  resources: { value: string; count: number }[]
}>({ actions: [], resources: [] })

const range = ref<[string, string] | null>(null)

const query = reactive({
  keyword: "",
  action: "",
  resource: "",
  onlyFailed: "",
  page: 1,
  pageSize: 20
})

const detailVisible = ref(false)
const current = ref<AuditLog | null>(null)

function actionTag(action: string) {
  if (action.includes("delete") || action.includes("remove")) return "danger"
  if (action.includes("create")) return "success"
  if (action.includes("update") || action.includes("set")) return "warning"
  return "info"
}

function detailPreview(detail?: Record<string, any> | null) {
  if (!detail) return "-"
  const text = JSON.stringify(detail)
  return text === "{}" ? "-" : truncate(text, 70)
}

function params() {
  return {
    keyword: query.keyword || undefined,
    action: query.action || undefined,
    resource: query.resource || undefined,
    onlyFailed: query.onlyFailed || undefined,
    from: range.value?.[0],
    to: range.value?.[1],
    page: query.page,
    pageSize: query.pageSize
  }
}

async function load() {
  loading.value = true
  try {
    const page = await auditApi.list(params())
    logs.value = page.items
    total.value = page.total
  } catch (error) {
    toastError(error, "审计日志加载失败")
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
  query.action = ""
  query.resource = ""
  query.onlyFailed = ""
  range.value = null
  reload()
}

async function showDetail(row: AuditLog) {
  current.value = row
  detailVisible.value = true
  try {
    current.value = await auditApi.detail(row.id)
  } catch {
    // 保留列表中的简要数据
  }
}

onMounted(async () => {
  await load()
  try {
    facets.value = await auditApi.facets()
  } catch {
    // 筛选项失败不影响列表
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
.actor-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}
.small {
  font-size: 12px;
}
.pager {
  margin-top: 14px;
  justify-content: flex-end;
}
.detail-title {
  margin: 18px 0 8px;
  font-size: 13.5px;
  font-weight: 600;
}
.result-body {
  max-height: 340px;
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
</style>