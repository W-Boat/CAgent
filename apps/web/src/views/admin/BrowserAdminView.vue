<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title">浏览器会话</h2>
        <p class="page-subtitle">
          查看全部浏览器操控会话与操作轨迹，必要时强制关闭 · 共 {{ total }} 个会话
        </p>
      </div>
      <div class="page-actions">
        <el-button @click="load">
          <el-icon><Refresh /></el-icon> 刷新
        </el-button>
      </div>
    </div>

    <div class="filter-bar">
      <el-select v-model="query.status" placeholder="全部状态" clearable style="width: 140px" @change="reload">
        <el-option label="运行中" value="ACTIVE" />
        <el-option label="已关闭" value="CLOSED" />
        <el-option label="已崩溃" value="CRASHED" />
      </el-select>
      <el-input
        v-model="query.userId"
        placeholder="按用户 ID 精确筛选"
        clearable
        style="width: 240px"
        @keyup.enter="reload"
        @clear="reload"
      />
      <el-button @click="reset">重置</el-button>
    </div>

    <el-table :data="sessions" v-loading="loading" stripe size="small">
      <el-table-column label="会话" min-width="220">
        <template #default="{ row }">
          <div class="name-cell">
            <span class="name">{{ row.name }}</span>
            <el-tag v-if="row.alive" size="small" type="success" effect="plain">存活</el-tag>
          </div>
          <div class="muted small mono">{{ truncate(row.currentUrl || row.startUrl || "尚未导航", 58) }}</div>
        </template>
      </el-table-column>

      <el-table-column label="所属用户" min-width="180">
        <template #default="{ row }">
          <div class="user-cell">
            <span>{{ row.user?.name || "-" }}</span>
            <span class="muted small">{{ row.user?.email || "" }}</span>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="状态" width="95">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)" size="small" effect="plain">
            {{ statusText(row.status) }}
          </el-tag>
        </template>
      </el-table-column>

      <el-table-column label="模式" width="90">
        <template #default="{ row }">
          <el-tag size="small" effect="plain" type="info">{{ row.headless ? "无头" : "有头" }}</el-tag>
        </template>
      </el-table-column>

      <el-table-column label="步数" width="80">
        <template #default="{ row }">{{ row._count?.steps ?? row.steps?.length ?? 0 }}</template>
      </el-table-column>

      <el-table-column label="创建时间" width="168">
        <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
      </el-table-column>

      <el-table-column label="关闭时间" width="168">
        <template #default="{ row }">{{ formatDateTime(row.closedAt) }}</template>
      </el-table-column>

      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row }">
          <el-button text type="primary" size="small" @click="showDetail(row)">轨迹</el-button>
          <el-button
            text
            type="danger"
            size="small"
            :disabled="row.status !== 'ACTIVE'"
            @click="forceClose(row)"
          >
            强制关闭
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

    <el-drawer v-model="detailVisible" :title="detail?.name || '会话轨迹'" size="680px">
      <div v-if="detail" v-loading="detailLoading">
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="用户">
            {{ detail.user?.name || "-" }}
            <span class="muted">{{ detail.user?.email || "" }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="statusType(detail.status)" size="small">{{ statusText(detail.status) }}</el-tag>
            <el-tag v-if="detail.alive" size="small" type="success" effect="plain" class="ml">浏览器存活</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="当前地址">
            <span class="mono small">{{ detail.currentUrl || detail.startUrl || "-" }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="创建 / 关闭">
            {{ formatDateTime(detail.createdAt) }} / {{ formatDateTime(detail.closedAt) }}
          </el-descriptions-item>
        </el-descriptions>

        <h4 class="detail-title">操作轨迹（{{ steps.length }} 步）</h4>
        <el-timeline v-if="steps.length">
          <el-timeline-item
            v-for="step in steps"
            :key="step.id"
            :timestamp="`#${step.seq} · ${formatDateTime(step.createdAt)}`"
            :type="step.status === 'SUCCESS' ? 'primary' : step.status === 'RUNNING' ? 'info' : 'danger'"
            placement="top"
          >
            <div class="step-head">
              <el-tag size="small" effect="plain">{{ step.action }}</el-tag>
              <span class="muted small">{{ formatDuration(step.durationMs) }}</span>
            </div>
            <div v-if="step.selector" class="step-line mono">selector: {{ step.selector }}</div>
            <div v-if="step.value" class="step-line mono">value: {{ truncate(step.value, 90) }}</div>
            <div v-if="step.url" class="step-line muted mono">{{ truncate(step.url, 90) }}</div>
            <el-alert
              v-if="step.error"
              :title="step.error"
              type="error"
              show-icon
              :closable="false"
              class="step-error"
            />
            <img
              v-if="step.screenshotPath"
              :src="artifactUrl(step.screenshotPath)"
              class="step-shot"
              alt="操作截图"
              @click="preview(step.screenshotPath)"
            />
            <pre v-if="step.snapshot" class="step-snapshot">{{ JSON.stringify(step.snapshot, null, 2) }}</pre>
          </el-timeline-item>
        </el-timeline>
        <el-empty v-else description="该会话没有执行过动作" :image-size="70" />
      </div>
    </el-drawer>

    <el-dialog v-model="previewVisible" title="操作截图" width="80%" top="4vh" append-to-body>
      <img v-if="previewSrc" :src="previewSrc" class="preview-img" alt="截图预览" />
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue"
import { browserApi } from "@/api"
import { toastError, toastOk } from "@/api/client"
import type { BrowserSession, BrowserStep } from "@/api/types"
import {
  artifactUrl,
  formatDateTime,
  formatDuration,
  statusText,
  statusType,
  truncate
} from "@/utils/format"

/*
 * 声明组件名，供 <keep-alive :include> 匹配（约定与路由 name 一致）。
 * 不声明的话缓存会静默失效：切走再回来仍会重建组件、重新拉数据。
 */
defineOptions({ name: "admin-browser" })

const sessions = ref<BrowserSession[]>([])
const total = ref(0)
const loading = ref(false)

const query = reactive({
  status: "",
  userId: "",
  page: 1,
  pageSize: 20
})

const detailVisible = ref(false)
const detailLoading = ref(false)
const detail = ref<(BrowserSession & { steps: BrowserStep[] }) | null>(null)
const steps = ref<BrowserStep[]>([])

const previewVisible = ref(false)
const previewSrc = ref("")

async function load() {
  loading.value = true
  try {
    const page = await browserApi.sessions({
      status: query.status || undefined,
      userId: query.userId.trim() || undefined,
      page: query.page,
      pageSize: query.pageSize
    })
    sessions.value = page.items
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
  query.status = ""
  query.userId = ""
  reload()
}

async function showDetail(row: BrowserSession) {
  detailVisible.value = true
  detailLoading.value = true
  detail.value = null
  steps.value = []
  try {
    const data = await browserApi.detail(row.id)
    detail.value = data
    steps.value = data.steps || []
  } catch (error) {
    toastError(error, "会话详情加载失败")
  } finally {
    detailLoading.value = false
  }
}

async function forceClose(row: BrowserSession) {
  try {
    await ElMessageBox.confirm(
      `强制关闭「${row.name}」？浏览器实例会立即释放，已记录的轨迹仍会保留。`,
      "强制关闭会话",
      { type: "warning", confirmButtonText: "关闭", cancelButtonText: "取消" }
    )
  } catch {
    return
  }
  try {
    await browserApi.close(row.id)
    toastOk("会话已关闭")
    await load()
  } catch (error) {
    toastError(error)
  }
}

function preview(path: string) {
  previewSrc.value = artifactUrl(path)
  previewVisible.value = true
}

onMounted(load)
</script>

<style scoped>
.filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
}
.name-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}
.name {
  font-size: 13.5px;
  font-weight: 500;
}
.user-cell {
  display: flex;
  flex-direction: column;
}
.small {
  font-size: 11.5px;
}
.ml {
  margin-left: 6px;
}
.pager {
  margin-top: 14px;
  justify-content: flex-end;
}
.detail-title {
  margin: 20px 0 14px;
  font-size: 13.5px;
  font-weight: 600;
}
.step-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.step-line {
  margin-top: 4px;
  font-size: 12px;
  word-break: break-all;
}
.step-error {
  margin-top: 6px;
}
.step-shot {
  width: 100%;
  margin-top: 8px;
  cursor: zoom-in;
  border: 1px solid var(--cg-border);
  border-radius: 8px;
}
.step-snapshot {
  max-height: 200px;
  padding: 10px;
  margin-top: 8px;
  overflow: auto;
  font-size: 12px;
  background: var(--cg-card-bg-soft);
  border-radius: 6px;
}
.preview-img {
  width: 100%;
}
</style>