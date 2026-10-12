<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title">用量统计</h2>
        <p class="page-subtitle">全平台调用量、Token 消耗与费用趋势</p>
      </div>
      <div class="page-actions">
        <el-radio-group v-model="days" size="small" @change="load">
          <el-radio-button :value="7">近 7 天</el-radio-button>
          <el-radio-button :value="14">近 14 天</el-radio-button>
          <el-radio-button :value="30">近 30 天</el-radio-button>
          <el-radio-button :value="90">近 90 天</el-radio-button>
        </el-radio-group>
        <el-button @click="load">
          <el-icon><Refresh /></el-icon> 刷新
        </el-button>
      </div>
    </div>

    <el-row :gutter="14" v-loading="loading">
      <el-col :xs="12" :sm="8" :md="4">
        <StatTile label="调用次数" :value="totals.requests" icon="Promotion" :hint="`失败 ${totals.failedRequests}`" />
      </el-col>
      <el-col :xs="12" :sm="8" :md="4">
        <StatTile label="消耗 Token" :value="formatTokens(totals.totalTokens)" icon="Coin" hint="输入 + 输出" />
      </el-col>
      <el-col :xs="12" :sm="8" :md="4">
        <StatTile
          label="预估费用"
          :value="formatCost(totals.costUsd)"
          icon="Money"
          color="#f59e0b"
          hint="按模型单价估算"
        />
      </el-col>
      <el-col :xs="12" :sm="8" :md="4">
        <StatTile
          label="成功率"
          :value="`${totals.successRate}%`"
          icon="CircleCheck"
          color="#10b981"
          hint="调用整体成功率"
        />
      </el-col>
      <el-col :xs="12" :sm="8" :md="4">
        <StatTile
          label="平均延迟"
          :value="formatDuration(totals.avgLatencyMs)"
          icon="Timer"
          color="#8b5cf6"
          hint="单次请求"
        />
      </el-col>
      <el-col :xs="12" :sm="8" :md="4">
        <StatTile label="输入 Token" :value="formatTokens(totals.promptTokens)" icon="Bottom" hint="prompt" />
      </el-col>
    </el-row>

    <div class="trend-row">
      <ChartPanel title="用量趋势" :option="trendOption" :height="320" :is-empty="trend.length === 0">
        <template #extra>
          <el-radio-group v-model="metric" size="small">
            <el-radio-button value="tokens">Token</el-radio-button>
            <el-radio-button value="requests">请求数</el-radio-button>
            <el-radio-button value="costUsd">费用</el-radio-button>
          </el-radio-group>
        </template>
      </ChartPanel>

      <ChartPanel title="来源分布" :option="sourceOption" :height="320" :is-empty="bySource.length === 0" />
    </div>

    <el-row :gutter="14" class="charts">
      <el-col :xs="24" :lg="12">
        <ChartPanel title="模型调用占比 Top 8" :option="modelPieOption" :height="300" :is-empty="byModel.length === 0" />
      </el-col>
      <el-col :xs="24" :lg="12">
        <ChartPanel title="用户消耗 Top 10" :option="userBarOption" :height="300" :is-empty="byUser.length === 0" />
      </el-col>
    </el-row>

    <el-card shadow="never" class="block">
      <template #header><span class="block-title">按模型统计</span></template>
      <el-table :data="byModel" v-loading="loading" size="small">
        <el-table-column label="模型" min-width="200">
          <template #default="{ row }">
            <div class="model-cell">
              <span>{{ row.modelKey }}</span>
              <el-tag size="small" type="info" effect="plain">{{ row.providerKey }}</el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="调用次数" width="110" prop="requests" />
        <el-table-column label="输入 Token" width="130">
          <template #default="{ row }">{{ formatNumber(row.promptTokens) }}</template>
        </el-table-column>
        <el-table-column label="输出 Token" width="130">
          <template #default="{ row }">{{ formatNumber(row.completionTokens) }}</template>
        </el-table-column>
        <el-table-column label="合计 Token" width="130">
          <template #default="{ row }">{{ formatTokens(row.totalTokens) }}</template>
        </el-table-column>
        <el-table-column label="费用" width="120">
          <template #default="{ row }">{{ formatCost(row.costUsd) }}</template>
        </el-table-column>
        <el-table-column label="平均延迟" width="120">
          <template #default="{ row }">{{ formatDuration(row.avgLatencyMs) }}</template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="never" class="block">
      <template #header><span class="block-title">按用户统计</span></template>
      <el-table :data="byUser" v-loading="loading" size="small">
        <el-table-column label="用户" min-width="220">
          <template #default="{ row }">
            <div class="user-cell">
              <span>{{ row.user?.name || "未知用户" }}</span>
              <span class="muted small">{{ row.user?.email || row.userId }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="院系" width="150">
          <template #default="{ row }">
            <span class="muted">{{ row.user?.department || "-" }}</span>
          </template>
        </el-table-column>
        <el-table-column label="调用次数" width="110" prop="requests" />
        <el-table-column label="消耗 Token" width="140">
          <template #default="{ row }">{{ formatTokens(row.totalTokens) }}</template>
        </el-table-column>
        <el-table-column label="费用" width="120">
          <template #default="{ row }">{{ formatCost(row.costUsd) }}</template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!loading && byUser.length === 0" description="暂无用户用量" :image-size="80" />
    </el-card>

    <el-card shadow="never" class="block">
      <template #header>
        <div class="card-head">
          <span class="block-title">调用明细</span>
          <div class="filter-inline">
            <el-select v-model="filters.source" placeholder="全部来源" clearable size="small" style="width: 120px" @change="loadRecords">
              <el-option label="对话" value="CHAT" />
              <el-option label="技能" value="SKILL" />
              <el-option label="浏览器" value="BROWSER" />
              <el-option label="向量化" value="EMBEDDING" />
            </el-select>
            <el-select v-model="filters.providerKey" placeholder="全部供应商" clearable size="small" style="width: 150px" @change="loadRecords">
              <el-option v-for="p in providerKeys" :key="p" :label="p" :value="p" />
            </el-select>
          </div>
        </div>
      </template>

      <el-table :data="records" v-loading="recordsLoading" size="small" stripe>
        <el-table-column label="时间" width="165">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="用户" min-width="180">
          <template #default="{ row }">
            <div class="user-cell">
              <span>{{ row.user?.name || "-" }}</span>
              <span class="muted small">{{ row.user?.email || "" }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="模型" min-width="160">
          <template #default="{ row }">
            <div class="model-cell">
              <span>{{ row.modelKey }}</span>
              <span class="muted mono small">{{ row.providerKey }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="来源" width="90">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ sourceText(row.source) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="Token（入/出）" width="150">
          <template #default="{ row }">
            <span class="mono small">{{ row.promptTokens }} / {{ row.completionTokens }}</span>
          </template>
        </el-table-column>
        <el-table-column label="费用" width="100">
          <template #default="{ row }">{{ formatCost(row.costUsd) }}</template>
        </el-table-column>
        <el-table-column label="延迟" width="100">
          <template #default="{ row }">{{ formatDuration(row.latencyMs) }}</template>
        </el-table-column>
        <el-table-column label="结果" width="90">
          <template #default="{ row }">
            <el-tag :type="row.success ? 'success' : 'danger'" size="small" effect="plain">
              {{ row.success ? "成功" : "失败" }}
            </el-tag>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-if="recordsTotal > 0"
        v-model:current-page="recordsPage"
        :page-size="20"
        :total="recordsTotal"
        layout="total, prev, pager, next"
        background
        class="pager"
        @current-change="loadRecords"
      />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue"
import type { EChartsOption } from "@/utils/echarts"
import ChartPanel from "@/components/ChartPanel.vue"
import StatTile from "@/components/StatTile.vue"
import { usageApi } from "@/api"
import { toastError } from "@/api/client"
import { useKeepAliveRefresh } from "@/utils/keep-alive"
import type {
  UsageByModel,
  UsageByUser,
  UsageOverview,
  UsageRecord,
  UsageTrendPoint
} from "@/api/types"
import {
  formatCost,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatTokens,
  lastNDays,
  sourceText
} from "@/utils/format"

/*
 * 声明组件名，供 <keep-alive :include> 匹配（约定与路由 name 一致）。
 * 不声明的话缓存会静默失效：切走再回来仍会重建组件、重新拉数据。
 */
defineOptions({ name: "admin-usage" })

const days = ref(14)
const metric = ref<"tokens" | "requests" | "costUsd">("tokens")
const loading = ref(false)
const recordsLoading = ref(false)

const overview = ref<UsageOverview | null>(null)
const trend = ref<UsageTrendPoint[]>([])
const byModel = ref<UsageByModel[]>([])
const byUser = ref<UsageByUser[]>([])

const records = ref<UsageRecord[]>([])
const recordsPage = ref(1)
const recordsTotal = ref(0)

const filters = reactive({ source: "", providerKey: "" })

const totals = computed(
  () =>
    overview.value?.totals || {
      requests: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      avgLatencyMs: 0,
      failedRequests: 0,
      successRate: 100
    }
)

const bySource = computed(() => overview.value?.bySource || [])

const providerKeys = computed(() =>
  Array.from(new Set(byModel.value.map((m) => m.providerKey))).sort()
)

const metricLabel = computed(() => {
  if (metric.value === "requests") return "请求数"
  if (metric.value === "costUsd") return "费用($)"
  return "Token"
})

const trendOption = computed<EChartsOption>(() => ({
  tooltip: { trigger: "axis" },
  grid: { left: 56, right: 24, top: 30, bottom: 44 },
  xAxis: {
    type: "category",
    data: trend.value.map((t) => t.date.slice(5)),
    axisLine: { lineStyle: { color: "#e2e8f0" } }
  },
  yAxis: { type: "value", splitLine: { lineStyle: { color: "#f1f5f9" } } },
  series: [
    {
      name: metricLabel.value,
      type: "line",
      smooth: true,
      symbolSize: 6,
      data: trend.value.map((t) => (metric.value === "costUsd" ? t.costUsd : t[metric.value])),
      itemStyle: { color: "#2563eb" },
      areaStyle: { color: "rgba(37, 99, 235, 0.10)" }
    },
    {
      name: "失败请求",
      type: "bar",
      barMaxWidth: 16,
      data: trend.value.map((t) => t.failed || 0),
      itemStyle: { color: "rgba(239, 68, 68, 0.65)", borderRadius: [3, 3, 0, 0] }
    }
  ]
}))

const sourceOption = computed<EChartsOption>(() => ({
  tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
  legend: { bottom: 0, icon: "circle" },
  series: [
    {
      type: "pie",
      radius: ["46%", "68%"],
      center: ["50%", "45%"],
      itemStyle: { borderRadius: 6, borderColor: "#fff", borderWidth: 2 },
      label: { show: false },
      data: bySource.value.map((s) => ({ name: sourceText(s.source), value: s.totalTokens }))
    }
  ]
}))

const modelPieOption = computed<EChartsOption>(() => {
  const top = [...byModel.value].sort((a, b) => b.totalTokens - a.totalTokens).slice(0, 8)
  return {
    tooltip: { trigger: "item", formatter: "{b}: {c} tokens ({d}%)" },
    legend: { bottom: 0, type: "scroll", icon: "circle" },
    series: [
      {
        type: "pie",
        radius: ["42%", "66%"],
        center: ["50%", "44%"],
        itemStyle: { borderRadius: 6, borderColor: "#fff", borderWidth: 2 },
        label: { show: false },
        data: top.map((m) => ({ name: m.modelKey, value: m.totalTokens }))
      }
    ]
  }
})

const userBarOption = computed<EChartsOption>(() => {
  const top = [...byUser.value].sort((a, b) => b.totalTokens - a.totalTokens).slice(0, 10).reverse()
  return {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    grid: { left: 110, right: 30, top: 20, bottom: 30 },
    xAxis: { type: "value", splitLine: { lineStyle: { color: "#f1f5f9" } } },
    yAxis: {
      type: "category",
      data: top.map((u) => u.user?.name || "未知"),
      axisLine: { lineStyle: { color: "#e2e8f0" } }
    },
    series: [
      {
        name: "Token",
        type: "bar",
        barMaxWidth: 18,
        data: top.map((u) => u.totalTokens),
        itemStyle: { color: "#10b981", borderRadius: [0, 4, 4, 0] }
      }
    ]
  }
})

async function load() {
  loading.value = true
  try {
    const range = lastNDays(days.value)
    const data = await usageApi.overview({ from: range.from, to: range.to })
    overview.value = data.overview
    trend.value = data.trend || []
    byModel.value = data.byModel || []
    byUser.value = data.byUser || []
  } catch (error) {
    toastError(error, "用量数据加载失败")
  } finally {
    loading.value = false
  }
  await loadRecords()
}

async function loadRecords() {
  recordsLoading.value = true
  try {
    const range = lastNDays(days.value)
    const page = await usageApi.records({
      from: range.from,
      to: range.to,
      source: filters.source || undefined,
      providerKey: filters.providerKey || undefined,
      page: recordsPage.value,
      pageSize: 20
    })
    records.value = page.items
    recordsTotal.value = page.total
  } catch (error) {
    toastError(error, "调用明细加载失败")
  } finally {
    recordsLoading.value = false
  }
}

/*
 * 被 keep-alive 缓存：onMounted 只跑一次，切回来是旧数据。
 * 用统一的 composable 按「是否过期」决定要不要重拉，
 * 避免快速来回切换时打出一串请求。
 */
const { refresh } = useKeepAliveRefresh(load, { staleAfter: 30000 })
onMounted(refresh)
</script>

<style scoped>
.page :deep(.el-col) {
  margin-bottom: 14px;
}
.trend-row {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 14px;
  margin-bottom: 14px;
}
.charts :deep(.el-col) {
  margin-bottom: 14px;
}
.block {
  margin-bottom: 14px;
  border-radius: var(--cg-radius);
}
.block-title {
  font-size: 15px;
  font-weight: 600;
}
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.filter-inline {
  display: flex;
  gap: 8px;
}
.model-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}
.user-cell {
  display: flex;
  flex-direction: column;
}
.small {
  font-size: 11.5px;
}
.pager {
  margin-top: 14px;
  justify-content: flex-end;
}

@media (max-width: 1200px) {
  .trend-row {
    grid-template-columns: 1fr;
  }
}
</style>