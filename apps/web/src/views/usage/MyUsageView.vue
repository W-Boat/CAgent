<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title">我的用量</h2>
        <p class="page-subtitle">
          {{ rangeLabel }} · 共 {{ formatNumber(totals.requests) }} 次调用 ·
          {{ formatTokens(totals.totalTokens) }} tokens
        </p>
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

    <!-- 配额 -->
    <el-card shadow="never" class="block quota-card" v-loading="loading">
      <template #header>
        <div class="card-head">
          <span class="block-title">配额状态</span>
          <el-tag :type="quota?.enabled ? (quota.allowed ? 'success' : 'danger') : 'info'" size="small">
            {{ quota && !quota.enabled ? "未启用限制" : quota?.allowed ? "正常" : "已受限" }}
          </el-tag>
        </div>
      </template>

      <div class="quota-grid">
        <div class="quota-item">
          <div class="qi-head">
            <span>今日 Token</span>
            <span class="mono">{{ formatTokens(used.dailyTokens) }} / {{ limitText(limits.dailyTokenLimit) }}</span>
          </div>
          <el-progress
            :percentage="percent(used.dailyTokens, limits.dailyTokenLimit)"
            :status="percent(used.dailyTokens, limits.dailyTokenLimit) >= 100 ? 'exception' : undefined"
            :stroke-width="8"
          />
        </div>

        <div class="quota-item">
          <div class="qi-head">
            <span>本月 Token</span>
            <span class="mono">{{ formatTokens(used.monthlyTokens) }} / {{ limitText(limits.monthlyTokenLimit) }}</span>
          </div>
          <el-progress
            :percentage="percent(used.monthlyTokens, limits.monthlyTokenLimit)"
            :stroke-width="8"
          />
        </div>

        <div class="quota-item">
          <div class="qi-head">
            <span>今日请求次数</span>
            <span class="mono">{{ used.dailyRequests }} / {{ limitText(limits.dailyRequestLimit) }}</span>
          </div>
          <el-progress
            :percentage="percent(used.dailyRequests, limits.dailyRequestLimit)"
            :stroke-width="8"
          />
        </div>

        <div class="quota-item">
          <div class="qi-head">
            <span>每分钟请求上限</span>
            <span class="mono">{{ limitText(limits.rpmLimit) }}</span>
          </div>
          <div class="qi-note">RPM 限制按分钟滑动窗口统计，超出会暂时拒绝请求</div>
        </div>
      </div>

      <el-alert
        v-if="quota?.reason"
        :title="quota.reason"
        type="warning"
        show-icon
        :closable="false"
        class="quota-alert"
      />
    </el-card>

    <!-- 指标卡 -->
    <el-row :gutter="14" class="tiles">
      <el-col :xs="12" :sm="12" :md="6">
        <StatTile label="调用次数" :value="totals.requests" icon="Promotion" hint="所选区间内" />
      </el-col>
      <el-col :xs="12" :sm="12" :md="6">
        <StatTile label="消耗 Token" :value="formatTokens(totals.totalTokens)" icon="Coin" hint="输入 + 输出" />
      </el-col>
      <el-col :xs="12" :sm="12" :md="6">
        <StatTile
          label="预估费用"
          :value="formatCost(totals.costUsd)"
          icon="Money"
          color="#f59e0b"
          hint="按模型单价估算"
        />
      </el-col>
      <el-col :xs="12" :sm="12" :md="6">
        <StatTile
          label="成功率"
          :value="`${totals.successRate}%`"
          icon="CircleCheck"
          color="#10b981"
          :hint="`失败 ${totals.failedRequests} 次`"
        />
      </el-col>
    </el-row>

    <!-- 趋势 -->
    <div class="trend-row">
      <ChartPanel title="用量趋势" :option="trendOption" :height="300" :is-empty="trend.length === 0">
        <template #extra>
          <el-radio-group v-model="metric" size="small">
            <el-radio-button value="tokens">Token</el-radio-button>
            <el-radio-button value="requests">请求数</el-radio-button>
            <el-radio-button value="costUsd">费用</el-radio-button>
          </el-radio-group>
        </template>
      </ChartPanel>

      <ChartPanel title="按来源分布" :option="sourceOption" :height="300" :is-empty="bySource.length === 0" />
    </div>

    <!-- 按模型 -->
    <el-card shadow="never" class="block">
      <template #header><span class="block-title">按模型统计</span></template>
      <el-table :data="byModel" v-loading="loading" size="small">
        <el-table-column label="模型" min-width="200">
          <template #default="{ row }">
            <div class="model-cell">
              <span>{{ row.modelKey }}</span>
              <el-tag size="small" effect="plain" type="info">{{ row.providerKey }}</el-tag>
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
        <el-table-column label="预估费用" width="120">
          <template #default="{ row }">{{ formatCost(row.costUsd) }}</template>
        </el-table-column>
        <el-table-column label="平均延迟" width="120">
          <template #default="{ row }">{{ formatDuration(row.avgLatencyMs) }}</template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!loading && byModel.length === 0" description="暂无调用记录" :image-size="80" />
    </el-card>

    <!-- 明细 -->
    <el-card shadow="never" class="block">
      <template #header>
        <div class="card-head">
          <span class="block-title">调用明细</span>
          <div class="filter-inline">
            <el-select v-model="sourceFilter" placeholder="全部来源" clearable size="small" style="width: 120px" @change="loadRecords">
              <el-option label="对话" value="CHAT" />
              <el-option label="技能" value="SKILL" />
              <el-option label="浏览器" value="BROWSER" />
              <el-option label="向量化" value="EMBEDDING" />
            </el-select>
          </div>
        </div>
      </template>

      <el-table :data="records" v-loading="recordsLoading" size="small" stripe>
        <el-table-column label="时间" width="165">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="模型" min-width="160">
          <template #default="{ row }">
            <div class="model-cell">
              <span>{{ row.modelKey }}</span>
              <span class="muted mono">{{ row.providerKey }}</span>
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
            <span class="mono">{{ row.promptTokens }} / {{ row.completionTokens }}</span>
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
import { computed, onMounted, ref } from "vue"
import type { EChartsOption } from "@/utils/echarts"
import ChartPanel from "@/components/ChartPanel.vue"
import StatTile from "@/components/StatTile.vue"
import { usageApi } from "@/api"
import { toastError } from "@/api/client"
import { useKeepAliveRefresh } from "@/utils/keep-alive"
import type {
  QuotaStatus,
  UsageByModel,
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
defineOptions({ name: "my-usage" })

const days = ref(14)
const metric = ref<"tokens" | "requests" | "costUsd">("tokens")
const loading = ref(false)
const recordsLoading = ref(false)
const sourceFilter = ref("")

const overview = ref<UsageOverview | null>(null)
const trend = ref<UsageTrendPoint[]>([])
const byModel = ref<UsageByModel[]>([])
const quota = ref<(QuotaStatus & { enabled?: boolean }) | null>(null)

const records = ref<UsageRecord[]>([])
const recordsPage = ref(1)
const recordsTotal = ref(0)

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

const used = computed(
  () =>
    quota.value?.used || {
      dailyTokens: 0,
      monthlyTokens: 0,
      dailyRequests: 0
    }
)

const limits = computed(
  () =>
    quota.value?.limits || {
      dailyTokenLimit: 0,
      monthlyTokenLimit: 0,
      dailyRequestLimit: 0,
      rpmLimit: 0
    }
)

const rangeLabel = computed(() => {
  const range = lastNDays(days.value)
  return `${range.from} ~ ${range.to}`
})

const trendOption = computed<EChartsOption>(() => ({
  tooltip: { trigger: "axis" },
  grid: { left: 50, right: 20, top: 30, bottom: 40 },
  xAxis: {
    type: "category",
    data: trend.value.map((t) => t.date.slice(5)),
    axisLine: { lineStyle: { color: "#e2e8f0" } }
  },
  yAxis: {
    type: "value",
    splitLine: { lineStyle: { color: "#f1f5f9" } }
  },
  series: [
    {
      name: metricLabel.value,
      type: "line",
      smooth: true,
      symbolSize: 6,
      data: trend.value.map((t) => (metric.value === "costUsd" ? t.costUsd : t[metric.value])),
      itemStyle: { color: "#2563eb" },
      areaStyle: { color: "rgba(37, 99, 235, 0.10)" }
    }
  ]
}))

const metricLabel = computed(() => {
  if (metric.value === "requests") return "请求数"
  if (metric.value === "costUsd") return "费用($)"
  return "Token"
})

const sourceOption = computed<EChartsOption>(() => ({
  tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
  legend: { bottom: 0, icon: "circle" },
  series: [
    {
      type: "pie",
      radius: ["48%", "70%"],
      center: ["50%", "45%"],
      avoidLabelOverlap: true,
      itemStyle: { borderRadius: 6, borderColor: "#fff", borderWidth: 2 },
      label: { show: false },
      data: bySource.value.map((s) => ({
        name: sourceText(s.source),
        value: s.totalTokens
      }))
    }
  ]
}))

function limitText(value?: number | null) {
  return !value ? "不限" : formatTokens(value)
}

function percent(value: number, limit: number) {
  if (!limit) return 0
  return Math.min(100, Math.round((value / limit) * 100))
}

async function load() {
  loading.value = true
  try {
    const range = lastNDays(days.value)
    const [data, quotaData] = await Promise.all([
      usageApi.mine({ from: range.from, to: range.to }),
      usageApi.myQuota().catch(() => null)
    ])
    overview.value = data.overview
    trend.value = data.trend || []
    byModel.value = data.byModel || []
    if (quotaData) {
      quota.value = {
        ...quotaData,
        used: quotaData.used ?? quotaData.usage,
        enabled: quotaData.quota?.enabled
      }
    }
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
    const page = await usageApi.myRecords({
      from: range.from,
      to: range.to,
      source: sourceFilter.value || undefined,
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
.quota-card {
  margin-bottom: 14px;
}
.quota-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 18px 26px;
}
.qi-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 13px;
}
.qi-note {
  font-size: 12px;
  line-height: 1.6;
  color: var(--cg-text-muted);
}
.quota-alert {
  margin-top: 16px;
}
.tiles {
  margin-bottom: 4px;
}
.tiles :deep(.el-col) {
  margin-bottom: 14px;
}
.trend-row {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 14px;
  margin-bottom: 14px;
}
.model-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}
.pager {
  margin-top: 14px;
  justify-content: flex-end;
}
.filter-inline {
  display: flex;
  gap: 8px;
}

@media (max-width: 1100px) {
  .trend-row {
    grid-template-columns: 1fr;
  }
}
</style>