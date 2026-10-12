<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title">导览记录</h2>
        <p class="page-subtitle">
          查看知识查询、资料阅读、链接跳转、地图查看与办理导览进度。
        </p>
      </div>
      <div class="page-actions">
        <el-button @click="refreshRecords">
          <el-icon><Refresh /></el-icon> 刷新
        </el-button>
      </div>
    </div>

    <el-radio-group v-model="recordTab" class="record-tabs"><el-radio-button v-if="auth.can('campus:admin')" value="activity">知识使用 / 链接跳转</el-radio-button><el-radio-button value="runs">办理导览会话</el-radio-button></el-radio-group>
    <CampusActivities v-if="recordTab==='activity'" ref="activityView"/>
    <template v-else>
    <div class="filter-bar">
      <el-input
        v-model="filters.keyword"
        placeholder="按条目标题查询全部记录"
        @change="page=1;load()"
        clearable
        style="width: 240px"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-select v-model="filters.status" @change="page=1;load()" style="width: 140px">
        <el-option label="全部状态" value="" />
        <el-option label="进行中" value="open" />
        <el-option label="已结束" value="closed" />
        <el-option label="已完成" value="done" />
      </el-select>
      <el-tag type="info" effect="plain">共 {{ total }} 条</el-tag>
    </div>

    <div class="table-card">
      <el-table :data="filtered" v-loading="loading" row-key="id">
        <el-table-column label="条目" min-width="260">
          <template #default="{ row }">
            <div class="cell-title">{{ row.item?.title || "（已删除）" }}</div>
            <div class="cell-sub">
              <el-tag
                v-if="row.item?.access"
                size="small"
                effect="plain"
                :type="accessType(row.item.access)"
              >
                {{ row.item.access }}
              </el-tag>
              <span v-if="row.item?.dept" class="muted">{{ row.item.dept }}</span>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="用户" width="180">
          <template #default="{ row }">
            <div>{{ row.user?.name || "-" }}</div>
            <div class="muted cell-sub">{{ row.user?.email }}</div>
          </template>
        </el-table-column>

        <el-table-column label="模式" width="90">
          <template #default="{ row }">
            <el-tag size="small" effect="plain" :type="row.mode === 'FULL' ? 'warning' : 'info'">
              {{ row.mode === "FULL" ? "含正文" : "仅指引" }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="进度" width="150">
          <template #default="{ row }">
            <el-progress
              :percentage="progressOf(row)"
              :stroke-width="8"
              :status="row.completed ? 'success' : undefined"
            />
            <div class="muted cell-sub">
              第 {{ row.currentStep }} 步 / 已完成 {{ doneCount(row) }} 步
            </div>
          </template>
        </el-table-column>

        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="row.closedAt ? 'info' : 'success'" effect="plain">
              {{ row.closedAt ? "已结束" : "进行中" }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="打开时间" width="170">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </el-table-column>

        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button text size="small" @click="showDetail(row)">详情</el-button>
            <el-button v-if="row.item?.url" text size="small" @click="openUrl(row.item.url)">
              打开入口
            </el-button>
          </template>
        </el-table-column>

        <template #empty>
          <el-empty description="还没有导览记录" :image-size="80" />
        </template>
      </el-table>

      <div class="pager">
        <el-pagination
          v-model:current-page="page"
          :page-size="pageSize"
          :total="total"
          layout="total, prev, pager, next"
          @current-change="load"
        />
      </div>
    </div>

    <el-drawer v-model="detailVisible" title="导览记录详情" size="620px">
      <div v-if="detail" v-loading="detailLoading" class="detail">
        <div class="detail-head">
          <h3>{{ detail.hit?.title || "（已删除的条目）" }}</h3>
          <div class="detail-meta">
            <el-tag size="small" effect="plain">
              {{ detail.run.mode === "FULL" ? "含正文" : "仅指引" }}
            </el-tag>
            <el-tag size="small" :type="detail.alive ? 'success' : 'info'" effect="plain">
              {{ detail.alive ? "会话存活" : "会话已结束" }}
            </el-tag>
            <span class="muted">{{ formatDateTime(detail.run.createdAt) }}</span>
          </div>
        </div>

        <el-alert
          v-if="detail.banner"
          :title="detail.banner"
          type="info"
          show-icon
          :closable="false"
          class="detail-banner"
        />

        <div class="kv-grid detail-kv">
          <div class="kv-item">
            <div class="kv-label">办理部门</div>
            <div class="kv-value small">{{ detail.hit?.dept || "-" }}</div>
          </div>
          <div class="kv-item">
            <div class="kv-label">地点</div>
            <div class="kv-value small">{{ detail.hit?.place || "-" }}</div>
          </div>
          <div class="kv-item">
            <div class="kv-label">电话</div>
            <div class="kv-value small">{{ detail.hit?.tel || "-" }}</div>
          </div>
          <div class="kv-item">
            <div class="kv-label">访问方式</div>
            <div class="kv-value small">{{ detail.hit?.access || "未标注" }}</div>
          </div>
        </div>

        <div v-if="(detail.warnings || []).length" class="detail-warns">
          <el-alert
            v-for="(w, i) in detail.warnings"
            :key="i"
            :title="w"
            type="warning"
            show-icon
            :closable="false"
            class="detail-warn"
          />
        </div>

        <h4 class="detail-sec">步骤进度</h4>
        <div class="detail-steps">
          <div v-for="s in detail.hints" :key="s.index" class="ds-item" :class="{ done: s.done }">
            <el-tag size="small" :type="s.done ? 'success' : 'info'" effect="plain">
              {{ s.done ? "已完成" : "未完成" }}
            </el-tag>
            <span>{{ s.tip }}</span>
          </div>
          <el-empty
            v-if="detail.hints.length === 0"
            description="该条目没有分步说明"
            :image-size="60"
          />
        </div>

        <h4 class="detail-sec">访问过的地址</h4>
        <div class="detail-urls">
          <div v-for="(u, i) in detail.run.visitedUrls || []" :key="i" class="mono du">{{ u }}</div>
          <span v-if="!(detail.run.visitedUrls || []).length" class="muted">无</span>
        </div>

        <h4 class="detail-sec">当前画面</h4>
        <img
          v-if="detailShot"
          :src="detailShot"
          class="detail-shot"
          alt="导览画面"
          @click="preview = true"
        />
        <el-empty v-else description="会话已结束，没有可用的画面" :image-size="60" />

        <h4 class="detail-sec">入口链接</h4>
        <el-link v-if="detail.hit?.url" type="primary" :href="detail.hit.url" target="_blank">
          {{ detail.hit.url }}
        </el-link>
        <span v-else class="muted">无</span>
      </div>
    </el-drawer>

    </template>
    <el-dialog v-model="preview" title="画面" width="84%" top="3vh" append-to-body>
      <img v-if="detailShot" :src="detailShot" class="detail-shot" alt="画面" />
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue"
import CampusActivities from "@/components/CampusActivities.vue"
import {useAuthStore} from '@/stores/auth'
import { campusApi } from "@/api"
import { toastError } from "@/api/client"
import type { CampusRun, CampusRunDetail } from "@/api/types"
import { artifactUrl, formatDateTime } from "@/utils/format"

/*
 * 声明组件名，供 <keep-alive :include> 匹配（约定与路由 name 一致）。
 * 不声明的话缓存会静默失效：切走再回来仍会重建组件、重新拉数据。
 */
defineOptions({ name: "admin-campus-runs" })

const activityView=ref<InstanceType<typeof CampusActivities>>()
function refreshRecords(){if(recordTab.value==='activity')void activityView.value?.load();else void load()}
const auth=useAuthStore()
const recordTab=ref(auth.can('campus:admin')?'activity':'runs')
const loading = ref(false)
const runs = ref<CampusRun[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)

const filters = reactive({ keyword: "", status: "" })

const detailVisible = ref(false)
const detailLoading = ref(false)
const detail = ref<CampusRunDetail | null>(null)
const preview = ref(false)

const filtered = computed(() => {
  let list = runs.value
  if (filters.status === "open") list = list.filter((r) => !r.closedAt)
  else if (filters.status === "closed") list = list.filter((r) => !!r.closedAt)
  else if (filters.status === "done") list = list.filter((r) => r.completed)
  const kw = filters.keyword.trim().toLowerCase()
  if (kw) list = list.filter((r) => (r.item?.title || "").toLowerCase().includes(kw))
  return list
})

const detailShot = computed(() =>
  detail.value?.frame?.screenshotPath ? artifactUrl(detail.value.frame.screenshotPath) : ""
)

async function load() {
  loading.value = true
  try {
    const res = await campusApi.runs({ page: page.value, pageSize: pageSize.value, all: true,keyword:filters.keyword,status:filters.status })
    runs.value = res.items
    total.value = res.total
  } catch (error) {
    toastError(error, "导览记录加载失败")
  } finally {
    loading.value = false
  }
}

async function showDetail(row: CampusRun) {
  detailVisible.value = true
  detailLoading.value = true
  detail.value = null
  try {
    detail.value = await campusApi.runDetail(row.id)
  } catch (error) {
    toastError(error, "详情加载失败")
  } finally {
    detailLoading.value = false
  }
}

function openUrl(url: string) {
  window.open(url, "_blank", "noopener,noreferrer")
}

function doneCount(row: CampusRun): number {
  return Object.values(row.stepProgress || {}).filter(Boolean).length
}

function progressOf(row: CampusRun): number {
  const values = Object.values(row.stepProgress || {})
  if (values.length === 0) return row.completed ? 100 : 0
  const done = values.filter(Boolean).length
  return Math.min(100, Math.round((done / values.length) * 100))
}

function accessType(access: string): "success" | "warning" | "danger" | "info" {
  if (access === "公网") return "success"
  if (access === "校园网/VPN") return "warning"
  if (access === "已合并下线") return "danger"
  return "info"
}

onMounted(load)
</script>

<style scoped>
.cell-title {
  font-size: 13.5px;
  font-weight: 500;
  line-height: 1.5;
}
.cell-sub {
  margin-top: 4px;
  font-size: 11.5px;
}
.detail-head h3 {
  margin: 0 0 8px;
  font-size: 16px;
  line-height: 1.5;
}
.detail-meta {
  display: flex;
  gap: 10px;
  align-items: center;
  font-size: 12px;
}
.detail-banner {
  margin: 14px 0;
}
.detail-warns {
  margin-top: 10px;
}
.detail-warn {
  margin-bottom: 8px;
}
.detail-kv {
  margin-top: 4px;
}
.kv-value.small {
  font-size: 14px;
  font-weight: 500;
}
.detail-sec {
  margin: 20px 0 10px;
  font-size: 13.5px;
  font-weight: 600;
}
.detail-steps {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ds-item {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 8px 10px;
  font-size: 13px;
  line-height: 1.7;
  background: var(--cg-card-bg-soft);
  border-radius: 8px;
}
.ds-item.done {
  opacity: 0.65;
}
.detail-urls {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.du {
  font-size: 11.5px;
  word-break: break-all;
}
.detail-shot {
  width: 100%;
  cursor: zoom-in;
  border: 1px solid var(--cg-border);
  border-radius: 8px;
}
</style>
