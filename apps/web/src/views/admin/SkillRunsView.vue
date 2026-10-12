<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title">技能运行记录</h2>
        <p class="page-subtitle">追踪每一次技能调用的入参、输出与耗时 · 共 {{ total }} 条</p>
      </div>
      <div class="page-actions">
        <el-radio-group v-model="statsDays" size="small" @change="loadStats">
          <el-radio-button :value="7">近 7 天</el-radio-button>
          <el-radio-button :value="14">近 14 天</el-radio-button>
          <el-radio-button :value="30">近 30 天</el-radio-button>
        </el-radio-group>
        <el-button @click="loadAll">
          <el-icon><Refresh /></el-icon> 刷新
        </el-button>
      </div>
    </div>

    <el-row :gutter="14">
      <el-col :xs="12" :sm="6">
        <StatTile label="运行总次数" :value="stats?.total || 0" icon="Tickets" :hint="`近 ${statsDays} 天`" />
      </el-col>
      <el-col :xs="12" :sm="6">
        <StatTile
          label="成功"
          :value="stats?.success || 0"
          icon="CircleCheck"
          color="#10b981"
          :hint="successRate"
        />
      </el-col>
      <el-col :xs="12" :sm="6">
        <StatTile label="失败" :value="stats?.failed || 0" icon="CircleClose" color="#ef4444" hint="含执行异常" />
      </el-col>
      <el-col :xs="12" :sm="6">
        <StatTile
          label="平均耗时"
          :value="formatDuration(stats?.avgDurationMs)"
          icon="Timer"
          color="#8b5cf6"
          hint="单次调用"
        />
      </el-col>
    </el-row>

    <div class="trend-row">
      <ChartPanel title="每日运行量" :option="dayOption" :height="280" :is-empty="(stats?.byDay || []).length === 0" />
      <ChartPanel
        title="按技能分布"
        :option="skillOption"
        :height="280"
        :is-empty="(stats?.bySkill || []).length === 0"
      />
    </div>

    <div class="filter-bar">
      <el-select v-model="query.skillId" placeholder="全部技能" clearable filterable style="width: 200px" @change="reload">
        <el-option v-for="s in skills" :key="s.id" :label="s.name" :value="s.id" />
      </el-select>

      <el-select v-model="query.status" placeholder="全部状态" clearable style="width: 140px" @change="reload">
        <el-option label="运行中" value="RUNNING" />
        <el-option label="成功" value="SUCCESS" />
        <el-option label="失败" value="FAILED" />
        <el-option label="已取消" value="CANCELLED" />
      </el-select>

      <el-input
        v-model="query.userId"
        placeholder="按用户 ID 精确筛选"
        clearable
        style="width: 230px"
        @keyup.enter="reload"
        @clear="reload"
      />
      <el-button @click="reset">重置</el-button>
    </div>

    <el-table :data="runs" v-loading="loading" stripe size="small">
      <el-table-column label="开始时间" width="168">
        <template #default="{ row }">{{ formatDateTime(row.startedAt) }}</template>
      </el-table-column>

      <el-table-column label="技能" min-width="170">
        <template #default="{ row }">
          <div class="skill-cell">
            <span>{{ row.skill?.name || "-" }}</span>
            <el-tag v-if="row.skill?.type" size="small" effect="plain">{{ typeText(row.skill.type) }}</el-tag>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="调用者" min-width="170">
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

      <el-table-column label="耗时" width="100">
        <template #default="{ row }">{{ formatDuration(row.durationMs) }}</template>
      </el-table-column>

      <el-table-column label="输出摘要" min-width="230">
        <template #default="{ row }">
          <span v-if="row.error" class="err-text">{{ truncate(row.error, 60) }}</span>
          <span v-else class="muted">{{ outputPreview(row.output) }}</span>
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

    <el-drawer v-model="detailVisible" title="运行详情" size="600px">
      <div v-if="current">
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="技能">{{ current.skill?.name || "-" }}</el-descriptions-item>
          <el-descriptions-item label="调用者">
            {{ current.user?.name || "-" }}
            <span class="muted">{{ current.user?.email || "" }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="statusType(current.status)" size="small">{{ statusText(current.status) }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="开始">{{ formatDateTime(current.startedAt) }}</el-descriptions-item>
          <el-descriptions-item label="结束">{{ formatDateTime(current.finishedAt) }}</el-descriptions-item>
          <el-descriptions-item label="耗时">{{ formatDuration(current.durationMs) }}</el-descriptions-item>
          <el-descriptions-item label="会话 ID">
            <span class="mono small">{{ current.conversationId || "-" }}</span>
          </el-descriptions-item>
        </el-descriptions>

        <h4 class="detail-title">入参</h4>
        <pre class="result-body">{{ JSON.stringify(current.input ?? {}, null, 2) }}</pre>

        <template v-if="current.output !== undefined && current.output !== null">
          <h4 class="detail-title">输出</h4>
          <pre class="result-body">{{
            typeof current.output === "string" ? current.output : JSON.stringify(current.output, null, 2)
          }}</pre>
        </template>

        <el-alert
          v-if="current.error"
          :title="current.error"
          type="error"
          show-icon
          :closable="false"
          class="detail-alert"
        />
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue"
import type { EChartsOption } from "@/utils/echarts"
import ChartPanel from "@/components/ChartPanel.vue"
import StatTile from "@/components/StatTile.vue"
import { skillsApi } from "@/api"
import { toastError } from "@/api/client"
import type { SkillItem, SkillRun } from "@/api/types"
import { formatDateTime, formatDuration, statusText, statusType, truncate } from "@/utils/format"

/*
 * 声明组件名，供 <keep-alive :include> 匹配（约定与路由 name 一致）。
 * 不声明的话缓存会静默失效：切走再回来仍会重建组件、重新拉数据。
 */
defineOptions({ name: "admin-skill-runs" })

const statsDays = ref(7)
const stats = ref<Awaited<ReturnType<typeof skillsApi.stats>> | null>(null)

const runs = ref<SkillRun[]>([])
const total = ref(0)
const loading = ref(false)
const skills = ref<SkillItem[]>([])

const detailVisible = ref(false)
const current = ref<SkillRun | null>(null)

const query = reactive({
  skillId: "",
  status: "",
  userId: "",
  page: 1,
  pageSize: 20
})

const successRate = computed(() => {
  const total_ = stats.value?.total || 0
  if (!total_) return "暂无运行"
  return `成功率 ${Math.round(((stats.value?.success || 0) / total_) * 100)}%`
})

const dayOption = computed<EChartsOption>(() => {
  const days = stats.value?.byDay || []
  return {
    tooltip: { trigger: "axis" },
    legend: { top: 0, icon: "circle" },
    grid: { left: 46, right: 20, top: 40, bottom: 40 },
    xAxis: {
      type: "category",
      data: days.map((d) => d.date.slice(5)),
      axisLine: { lineStyle: { color: "#e2e8f0" } }
    },
    yAxis: { type: "value", splitLine: { lineStyle: { color: "#f1f5f9" } } },
    series: [
      {
        name: "运行次数",
        type: "bar",
        stack: "total",
        barMaxWidth: 22,
        data: days.map((d) => d.runs),
        itemStyle: { color: "#2563eb", borderRadius: [4, 4, 0, 0] }
      },
      {
        name: "失败",
        type: "bar",
        stack: "total",
        barMaxWidth: 22,
        data: days.map((d) => d.failed),
        itemStyle: { color: "#ef4444" }
      }
    ]
  }
})

const skillOption = computed<EChartsOption>(() => {
  const items = [...(stats.value?.bySkill || [])].sort((a, b) => a.runs - b.runs).slice(-8)
  return {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    grid: { left: 110, right: 30, top: 20, bottom: 30 },
    xAxis: { type: "value", splitLine: { lineStyle: { color: "#f1f5f9" } } },
    yAxis: {
      type: "category",
      data: items.map((i) => i.skill?.name || "未知技能"),
      axisLine: { lineStyle: { color: "#e2e8f0" } }
    },
    series: [
      {
        name: "运行次数",
        type: "bar",
        barMaxWidth: 18,
        data: items.map((i) => i.runs),
        itemStyle: { color: "#8b5cf6", borderRadius: [0, 4, 4, 0] }
      }
    ]
  }
})

function typeText(type: string) {
  const map: Record<string, string> = {
    PROMPT: "提示词",
    TOOL: "工具",
    HTTP: "HTTP",
    BROWSER: "浏览器"
  }
  return map[type] || type
}

function outputPreview(output: unknown) {
  if (output === undefined || output === null) return "-"
  const text = typeof output === "string" ? output : JSON.stringify(output)
  return truncate(text, 70)
}

async function load() {
  loading.value = true
  try {
    const page = await skillsApi.runs({
      skillId: query.skillId || undefined,
      status: query.status || undefined,
      userId: query.userId.trim() || undefined,
      page: query.page,
      pageSize: query.pageSize
    })
    runs.value = page.items
    total.value = page.total
  } catch (error) {
    toastError(error, "运行记录加载失败")
  } finally {
    loading.value = false
  }
}

async function loadStats() {
  try {
    stats.value = await skillsApi.stats(statsDays.value)
  } catch (error) {
    toastError(error, "统计数据加载失败")
  }
}

async function loadAll() {
  await Promise.all([load(), loadStats()])
}

function reload() {
  query.page = 1
  void load()
}

function reset() {
  query.skillId = ""
  query.status = ""
  query.userId = ""
  reload()
}

function showDetail(row: SkillRun) {
  current.value = row
  detailVisible.value = true
}

onMounted(async () => {
  await loadAll()
  try {
    skills.value = await skillsApi.list()
  } catch {
    // 技能下拉失败不影响主列表
  }
})
</script>

<style scoped>
.trend-row {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 14px;
  margin: 4px 0 14px;
}
.page :deep(.el-col) {
  margin-bottom: 14px;
}
.filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
}
.skill-cell {
  display: flex;
  align-items: center;
  gap: 6px;
}
.user-cell {
  display: flex;
  flex-direction: column;
}
.small {
  font-size: 11.5px;
}
.err-text {
  font-size: 12.5px;
  color: #ef4444;
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
  max-height: 300px;
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
</style>