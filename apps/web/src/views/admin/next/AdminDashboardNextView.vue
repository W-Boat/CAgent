<template>
  <div class="nx-root nx-page">
    <!-- 头部：区间切换 + 刷新 -->
    <header class="nx-head">
      <div class="nx-head-text">
        <h1 class="nx-h1">{{ title }}</h1>
        <p class="nx-muted">全平台统计 · 覆盖所有用户的会话、消息及模型用量</p>
      </div>
      <div class="nx-head-actions">
        <slot name="actions" />
        <div class="nx-seg" role="group" aria-label="统计区间">
          <button
            v-for="d in DAYS_OPTIONS"
            :key="d"
            type="button"
            class="nx-seg-item"
            :class="{ 'is-on': days === d }"
            @click="setDays(d)"
          >
            近 {{ d }} 天
          </button>
        </div>
        <button type="button" class="nx-btn nx-btn-secondary" :disabled="loading" @click="reload">
          <el-icon><Refresh /></el-icon>刷新
        </button>
      </div>
    </header>

    <!-- 首次加载骨架 -->
    <div v-if="loading && !summary" class="nx-skel-page">
      <div class="nx-stats">
        <div v-for="i in 6" :key="i" class="nx-card nx-card-pad nx-stat">
          <span class="nx-skel nx-skel-line" style="width: 42%"></span>
          <span class="nx-skel nx-skel-value"></span>
        </div>
      </div>
      <div class="nx-card nx-card-pad">
        <span class="nx-skel nx-skel-line" style="width: 28%"></span>
        <div class="nx-skel nx-skel-chart"></div>
      </div>
    </div>

    <!-- 加载失败：给重试入口 -->
    <div v-else-if="!summary" class="nx-notice nx-error">
      {{ title }}数据加载失败
      <button type="button" class="nx-link-btn" @click="reload">重试</button>
    </div>

    <template v-else>
      <!-- 核心指标 -->
      <p class="nx-group-label">核心指标</p>
      <section class="nx-stats">
        <div v-for="tile in coreTiles" :key="tile.key" class="nx-card nx-card-pad nx-stat">
          <div class="nx-stat-top">
            <span class="nx-stat-label">{{ tile.label }}</span>
            <el-icon class="nx-stat-icon"><component :is="tile.icon" /></el-icon>
          </div>
          <div class="nx-stat-value">{{ tile.value }}</div>
          <div class="nx-stat-hint">{{ tile.hint }}</div>
        </div>
      </section>

      <!-- 资源与风险 -->
      <p class="nx-group-label">资源与风险</p>
      <section class="nx-stats nx-stats-risk">
        <div
          v-for="tile in riskTiles"
          :key="tile.key"
          class="nx-card nx-card-pad nx-stat"
          :class="{ 'is-danger': tile.danger }"
        >
          <div class="nx-stat-top">
            <span class="nx-stat-label">{{ tile.label }}</span>
            <el-icon class="nx-stat-icon"><component :is="tile.icon" /></el-icon>
          </div>
          <div class="nx-stat-value">{{ tile.value }}</div>
          <div class="nx-stat-hint">{{ tile.hint }}</div>
        </div>
      </section>

      <!-- 平台趋势 -->
      <section class="nx-card nx-card-pad nx-block">
        <header class="nx-block-head">
          <h2 class="nx-card-title">平台趋势</h2>
          <div class="nx-chip-row">
            <button
              v-for="m in METRICS"
              :key="m.key"
              type="button"
              class="nx-chip"
              :class="{ 'is-on': metric === m.key }"
              @click="metric = m.key"
            >
              {{ m.label }}
            </button>
          </div>
        </header>
        <!--
          图表容器始终渲染（v-show 控制显隐），空态放兄弟节点：
          ECharts 注入 canvas 属于 Vue 之外的 DOM 变更，
          v-if 与它抢同一父节点会触发 insertBefore 报错（见 ChartPanel 同款处理）。
        -->
        <div class="nx-chart-wrap">
          <div v-show="!trendEmpty" ref="trendHolder" class="nx-chart"></div>
          <div v-if="trendEmpty" class="nx-chart-empty">
            <el-icon :size="22"><TrendCharts /></el-icon>
            <p>所选区间内暂无趋势数据</p>
          </div>
        </div>
      </section>

      <!-- 四个 Top10 榜 -->
      <div class="nx-boards">
        <section v-for="board in boards" :key="board.key" class="nx-card nx-card-pad">
          <header class="nx-board-head">
            <h2 class="nx-card-title">{{ board.title }} Top 10</h2>
            <span class="nx-muted">近 7 天</span>
          </header>
          <p v-if="!board.rows.length" class="nx-board-empty">{{ board.empty }}</p>
          <ol v-else class="nx-rank">
            <li v-for="(row, i) in board.rows" :key="row.key" class="nx-rank-row">
              <span class="nx-rank-no" :class="{ 'is-top': i < 3 }">{{ i + 1 }}</span>
              <span class="nx-rank-main">
                <span class="nx-rank-name" :class="{ 'nx-mono': board.key === 'models' }">
                  {{ row.title }}
                </span>
                <span v-if="row.sub" class="nx-rank-sub">{{ row.sub }}</span>
              </span>
              <span class="nx-rank-vals">
                <b class="nx-rank-primary">{{ row.primary }}</b>
                <span v-if="row.secondary" class="nx-rank-secondary">{{ row.secondary }}</span>
              </span>
            </li>
          </ol>
        </section>
      </div>

      <!-- 最近操作：扁平时间线 -->
      <section class="nx-card nx-card-pad nx-block">
        <header class="nx-block-head">
          <h2 class="nx-card-title">最近操作</h2>
          <button type="button" class="nx-link-btn" @click="router.push('/admin/audit')">
            查看全部
          </button>
        </header>
        <div v-if="!activity.length" class="nx-list-empty">
          <el-icon :size="20"><List /></el-icon>
          <p>暂无操作记录</p>
        </div>
        <ol v-else class="nx-timeline">
          <li v-for="log in activity" :key="log.id" class="nx-tl-item">
            <span class="nx-tl-dot" :class="log.success ? 'is-ok' : 'is-fail'"></span>
            <div class="nx-tl-body">
              <div class="nx-tl-text">
                <b>{{ log.user?.name || log.actor || "系统" }}</b>
                <span class="nx-tl-action">{{ log.action }}</span>
                <span class="nx-chip">{{ log.resource }}</span>
                <span v-if="log.resourceId" class="nx-muted nx-mono">
                  {{ truncate(log.resourceId, 18) }}
                </span>
              </div>
              <!-- 绝对时间放 title，界面只留相对时间减少噪音 -->
              <span class="nx-tl-time" :title="formatDateTime(log.createdAt)">
                {{ fromNow(log.createdAt) }}
              </span>
            </div>
          </li>
        </ol>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { useRouter } from "vue-router"
import { loadECharts, initChartQueued, type ECharts, type EChartsOption } from "@/utils/echarts"
import { dashboardApi } from "@/api"
import { toastError } from "@/api/client"
import { resolvedColor } from "@/utils/chart-palette"
import { useThemeStore } from "@/stores/theme"
import { useUiStore } from "@/stores/ui"
import type {
  AuditLog,
  DashboardRankings,
  DashboardSummary,
  DashboardTrendPoint
} from "@/api/types"
import { formatCost, formatDateTime, formatNumber, formatTokens, fromNow, truncate } from "@/utils/format"
import { useKeepAliveChartResize, useKeepAliveRefresh } from "@/utils/keep-alive"

/*
 * 声明组件名，供 <keep-alive :include> 匹配（约定与路由 name 一致）。
 * 不声明的话缓存会静默失效：切走再回来仍会重建组件、重新拉数据。
 */
defineOptions({ name: "admin-dashboard" })
const props = withDefaults(defineProps<{ title?: string }>(), { title: "数据看板" })

const theme = useThemeStore()
const ui = useUiStore()
const router = useRouter()

const days = ref(14)
const metric = ref<"tokens" | "requests" | "messages" | "newUsers" | "skillRuns" | "costUsd">("tokens")
const loading = ref(false)
const summary = ref<DashboardSummary | null>(null)
const trends = ref<DashboardTrendPoint[]>([])
const rankings = ref<DashboardRankings | null>(null)
const activity = ref<AuditLog[]>([])

const trendHolder = ref<HTMLDivElement>()
let chart: ECharts | null = null
let observer: ResizeObserver | null = null
/** 卸载后到达的异步渲染要丢弃，否则会对已卸载 DOM 调 init */
let disposed = false

const DAYS_OPTIONS = [7, 14, 30] as const

const METRICS: { key: typeof metric.value; label: string }[] = [
  { key: "tokens", label: "Token" },
  { key: "requests", label: "请求" },
  { key: "messages", label: "消息" },
  { key: "newUsers", label: "新增用户" },
  { key: "skillRuns", label: "技能运行" },
  { key: "costUsd", label: "费用" }
]

const METRIC_LABELS: Record<string, string> = {
  tokens: "Token",
  requests: "请求数",
  messages: "消息数",
  newUsers: "新增用户",
  skillRuns: "技能运行",
  costUsd: "费用($)"
}

const metricLabel = computed(() => METRIC_LABELS[metric.value])
const trendEmpty = computed(() => trends.value.length === 0)

/* ---------- 统计卡（字段与经典 StatTile 一一对应） ---------- */

interface Tile {
  key: string
  label: string
  value: string
  icon: string
  hint: string
  danger?: boolean
}

const coreTiles = computed<Tile[]>(() => [
  {
    key: "users",
    label: "用户总数",
    value: formatNumber(summary.value?.users.total || 0),
    icon: "User",
    hint: `今日新增 ${summary.value?.users.newToday || 0}`
  },
  {
    key: "conversations",
    label: "会话总数",
    value: formatNumber(summary.value?.conversations.total || 0),
    icon: "ChatDotRound",
    hint: `今日 ${summary.value?.conversations.today || 0}`
  },
  {
    key: "messages",
    label: "消息总数",
    value: formatNumber(summary.value?.messages.total || 0),
    icon: "Document",
    hint: `今日 ${summary.value?.messages.today || 0}`
  },
  {
    key: "requestsToday",
    label: "今日请求",
    value: formatNumber(summary.value?.usage.requestsToday || 0),
    icon: "Promotion",
    hint: `失败 ${summary.value?.usage.failedToday || 0}`
  },
  {
    key: "tokensToday",
    label: "今日 Token",
    value: formatTokens(summary.value?.usage.tokensToday),
    icon: "DataLine",
    hint: "输入 + 输出"
  },
  {
    key: "costMonth",
    label: "近 30 天费用",
    value: formatCost(summary.value?.usage.costMonthUsd),
    icon: "Coin",
    hint: "按模型单价估算"
  }
])

const riskTiles = computed<Tile[]>(() => [
  {
    key: "providers",
    label: "供应商",
    value: `${summary.value?.providers.enabled || 0}/${summary.value?.providers.total || 0}`,
    icon: "Connection",
    hint: "已启用 / 总数"
  },
  {
    key: "models",
    label: "模型",
    value: `${summary.value?.models.enabled || 0}/${summary.value?.models.total || 0}`,
    icon: "Cpu",
    hint: "已启用 / 总数"
  },
  {
    key: "skills",
    label: "技能",
    value: `${summary.value?.skills.enabled || 0}/${summary.value?.skills.total || 0}`,
    icon: "MagicStick",
    hint: `今日运行 ${summary.value?.skills.runsToday || 0}`
  },
  {
    key: "agents",
    label: "智能体",
    value: formatNumber(summary.value?.agents.enabled || 0),
    icon: "Avatar",
    hint: "已启用"
  },
  {
    key: "browser",
    label: "浏览器会话",
    value: formatNumber(summary.value?.browser.activeSessions || 0),
    icon: "Monitor",
    hint: "当前活跃"
  },
  {
    key: "flagged",
    label: "违规标记",
    value: formatNumber(summary.value?.messages.flagged || 0),
    icon: "WarningFilled",
    hint: "待复核消息",
    danger: true
  }
])

/* ---------- Top10 榜 ---------- */

interface RankRow {
  key: string
  title: string
  sub?: string
  primary: string
  secondary?: string
}

const boards = computed<
  { key: string; title: string; rows: RankRow[]; empty: string }[]
>(() => [
  {
    key: "users",
    title: "活跃用户",
    rows: (rankings.value?.users || []).slice(0, 10).map((r, i) => ({
      key: r.user?.id ?? `u-${i}`,
      title: r.user?.name || "未知用户",
      sub: r.user?.email || r.user?.department || "-",
      primary: `${formatNumber(r.requests)} 次请求`,
      secondary: `${formatTokens(r.tokens)} Token`
    })),
    empty: "近 7 天暂无活跃用户"
  },
  {
    key: "models",
    title: "热门模型",
    rows: (rankings.value?.models || []).slice(0, 10).map((r, i) => ({
      key: r.modelKey || `m-${i}`,
      title: r.modelKey,
      primary: `${formatNumber(r.requests)} 次请求`,
      secondary: `${formatTokens(r.tokens)} Token`
    })),
    empty: "近 7 天暂无模型调用"
  },
  {
    key: "skills",
    title: "热门技能",
    rows: (rankings.value?.skills || []).slice(0, 10).map((r, i) => ({
      key: r.skill?.id ?? `s-${i}`,
      title: r.skill?.name || "未知技能",
      primary: `${formatNumber(r.runs)} 次运行`
    })),
    empty: "暂无技能运行记录"
  },
  {
    key: "agents",
    title: "热门智能体",
    rows: (rankings.value?.agents || []).slice(0, 10).map((r, i) => ({
      key: r.agent?.id ?? `a-${i}`,
      title: r.agent?.name || "未知智能体",
      primary: `${formatNumber(r.conversations)} 个会话`
    })),
    empty: "暂无智能体会话"
  }
])

/* ---------- 图表 ---------- */

/** 读取 nx 令牌的实际色值：canvas 不认 CSS 变量，必须解析成具体颜色 */
function nxColor(el: HTMLElement, name: string, fallback: string): string {
  return resolvedColor(el, name, fallback)
}

async function renderTrend() {
  const el = trendHolder.value
  if (!el || disposed) return
  // 容器被 v-show 隐藏或尚未布局时尺寸为 0，此时 init 会告警且画布不可见
  if (el.clientWidth === 0 || el.clientHeight === 0) return

  // echarts 按需加载
  const echarts = await loadECharts()
  if (disposed || !trendHolder.value) return
  // 排队初始化，避免同帧多个 chart 一起 init 阻塞主线程
  if (!chart || chart.isDisposed()) {
    chart = await initChartQueued(echarts, el)
    if (disposed || !trendHolder.value) {
      chart.dispose()
      chart = null
      return
    }
  }

  const accent = nxColor(el, "--nx-accent", "#4f46e5")
  const success = nxColor(el, "--nx-success", "#16a34a")
  const warning = nxColor(el, "--nx-warning", "#d97706")
  const text2 = nxColor(el, "--nx-text-2", "#55555e")
  const text3 = nxColor(el, "--nx-text-3", "#8e8e99")
  const border = nxColor(el, "--nx-border", "#e8e8ec")
  const surface = nxColor(el, "--nx-surface", "#ffffff")

  chart.setOption(
    {
      grid: { left: 52, right: 16, top: 36, bottom: 26 },
      tooltip: {
        trigger: "axis",
        backgroundColor: surface,
        borderColor: border,
        textStyle: { color: nxColor(el, "--nx-text", "#18181b"), fontSize: 12 },
        valueFormatter: (v: number) =>
          metric.value === "costUsd" ? formatCost(v) : formatNumber(v)
      },
      legend: {
        top: 0,
        right: 0,
        icon: "circle",
        itemWidth: 8,
        itemHeight: 8,
        itemGap: 16,
        textStyle: { color: text2, fontSize: 11 }
      },
      xAxis: {
        type: "category",
        data: trends.value.map((t) => t.date.slice(5)),
        boundaryGap: false,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: border } },
        axisLabel: { color: text3, fontSize: 11 }
      },
      yAxis: {
        type: "value",
        splitLine: { lineStyle: { color: border } },
        axisLabel: {
          color: text3,
          fontSize: 11,
          formatter: (v: number) =>
            metric.value === "costUsd" ? `$${v}` : formatNumber(v)
        }
      },
      series: [
        {
          name: metricLabel.value,
          type: "line",
          smooth: true,
          symbolSize: 5,
          showSymbol: false,
          data: trends.value.map((t) => t[metric.value]),
          itemStyle: { color: accent },
          lineStyle: { width: 2, color: accent }
        },
        {
          name: "消息数",
          type: "line",
          smooth: true,
          symbolSize: 5,
          showSymbol: false,
          data: trends.value.map((t) => t.messages),
          itemStyle: { color: success },
          lineStyle: { width: 1.5, color: success }
        },
        {
          name: "技能运行",
          type: "line",
          smooth: true,
          symbolSize: 5,
          showSymbol: false,
          data: trends.value.map((t) => t.skillRuns),
          itemStyle: { color: warning },
          lineStyle: { width: 1.5, color: warning }
        }
      ]
    },
    true
  )
}

function resize() {
  chart?.resize()
}

/*
 * 指标切换 / 暗色切换 / 强调色切换共用同一条重绘路径：
 * 图表颜色在渲染时从 CSS 令牌解析（canvas 不认 CSS 变量），
 * 任何影响令牌取值的状态变化都要触发一次重画。
 */
function rerenderCharts() {
  void renderTrend()
}

// 指标/主题切换立即重画；trends 变化要等 v-show 翻转后再测量容器
watch([metric, () => theme.isDark, () => ui.accent], rerenderCharts)
watch(trends, () => void nextTick(() => void renderTrend()))

/*
 * 被 keep-alive 缓存：onMounted 只跑一次，切回来是旧数据。
 * 用统一的 composable 按「是否过期」决定要不要重拉（与经典看板同为 60s）。
 */
const { refresh } = useKeepAliveRefresh(loadAll, { staleAfter: 60_000 })
useKeepAliveChartResize(() => chart?.resize())

async function loadTrends() {
  try {
    trends.value = await dashboardApi.trends(days.value)
  } catch (error) {
    toastError(error, "趋势数据加载失败")
  }
}

async function loadAll() {
  loading.value = true
  try {
    const [s, r, a] = await Promise.all([
      dashboardApi.summary(),
      dashboardApi.rankings(),
      dashboardApi.activity(12)
    ])
    summary.value = s
    rankings.value = r
    activity.value = a
  } catch (error) {
    toastError(error, props.title + "数据加载失败")
  } finally {
    loading.value = false
  }
  await loadTrends()
}

/** 区间切换只重拉趋势，与经典版行为一致 */
function setDays(d: (typeof DAYS_OPTIONS)[number]) {
  if (days.value === d) return
  days.value = d
  void loadTrends()
}

/** 手动刷新 / 失败重试 */
function reload() {
  void refresh()
}

onMounted(async () => {
  window.addEventListener("resize", resize)
  await refresh()
})

/*
 * 图表容器在 v-else 分支里惰性渲染，onMounted 时还不存在，
 * 因此 ResizeObserver 挂在 ref 上：容器出现时接上，
 * 用于感知侧栏折叠、空态切换等不经过 window.resize 的尺寸变化。
 */
watch(trendHolder, (el) => {
  if (!el || observer || typeof ResizeObserver === "undefined") return
  observer = new ResizeObserver(() => {
    if (!chart || chart.isDisposed()) void renderTrend()
    else resize()
  })
  observer.observe(el)
})

onBeforeUnmount(() => {
  disposed = true
  window.removeEventListener("resize", resize)
  observer?.disconnect()
  observer = null
  chart?.dispose()
  chart = null
})
</script>

<style scoped>
.nx-page {
  width: 100%;
  max-width: 1320px;
  margin: 0 auto;
  padding: 22px clamp(16px, 3vw, 28px) 44px;
}

/* ---------- 头部 ---------- */
.nx-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  /* 区块间垂直节奏统一 24px */
  margin-bottom: 24px;
}

.nx-head-text .nx-h1 {
  margin: 0 0 4px;
}

.nx-head-text .nx-muted {
  margin: 0;
}

.nx-head-actions {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 8px;
}

/* 分段控件（Vercel 风格）：浅底槽 + 白色浮起选中块 */
.nx-seg {
  display: inline-flex;
  padding: 2px;
  background: var(--nx-bg-soft);
  border: 1px solid var(--nx-border);
  border-radius: 8px;
}

.nx-seg-item {
  height: 26px;
  padding: 0 10px;
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--nx-text-2);
  white-space: nowrap;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 6px;
  transition: color 0.15s ease, background 0.15s ease;
}

.nx-seg-item:hover {
  color: var(--nx-text);
}

.nx-seg-item.is-on {
  color: var(--nx-text);
  background: var(--nx-surface);
  box-shadow: var(--nx-shadow-sm);
}

.nx-seg-item:focus-visible {
  outline: none;
  box-shadow: var(--nx-focus-ring);
}

/* ---------- 分组标签 ---------- */
.nx-group-label {
  margin: 0 0 8px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--nx-text-3);
}

/* ---------- 统计卡网格 ---------- */
.nx-stats {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  /* 统计卡网格 gap 统一 12px；区块间垂直节奏 24px */
  gap: 12px;
  margin-bottom: 24px;
}

/* 卡片内边距交给共享类 .nx-card-pad（16/18），不再自写 */
.nx-stat-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.nx-stat-label {
  overflow: hidden;
  font-size: 12.5px;
  color: var(--nx-text-3);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.nx-stat-icon {
  flex: 0 0 auto;
  font-size: 16px;
  color: var(--nx-text-3);
}

.nx-stat-value {
  margin-top: 8px;
  overflow: hidden;
  font-size: 22px;
  font-weight: 650;
  line-height: 1.15;
  letter-spacing: -0.02em;
  color: var(--nx-text);
  white-space: nowrap;
  text-overflow: ellipsis;
  font-variant-numeric: tabular-nums;
}

.nx-stat-hint {
  margin-top: 5px;
  overflow: hidden;
  font-size: 12px;
  color: var(--nx-text-3);
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* 违规标记等风险指标：icon + 数值用 danger 着色 */
.nx-stat.is-danger .nx-stat-icon,
.nx-stat.is-danger .nx-stat-value {
  color: var(--nx-danger);
}

.nx-stat.is-danger .nx-stat-icon {
  opacity: 0.85;
}

/* ---------- 图表 ---------- */
.nx-block {
  margin-bottom: 24px;
}

.nx-block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

/* 标题字号/字重走共享类 .nx-card-title，这里只关掉它在 flex 行内的下边距 */
.nx-block-head .nx-card-title {
  margin-bottom: 0;
}

.nx-chip-row {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 6px;
}

.nx-chart-wrap {
  position: relative;
  height: 300px;
}

.nx-chart {
  width: 100%;
  height: 100%;
}

.nx-chart-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--nx-text-2);
  font-size: 13px;
  text-align: center;
}

.nx-chart-empty p {
  margin: 0;
}

/* ---------- Top10 榜 ---------- */
.nx-boards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  /* 区块间距与垂直节奏统一 24px（窄屏折单列时行距同样吃到） */
  gap: 24px;
  margin-bottom: 24px;
}

.nx-board-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

/* 标题字号/字重走共享类 .nx-card-title，这里只关掉它在 flex 行内的下边距 */
.nx-board-head .nx-card-title {
  margin-bottom: 0;
}

.nx-board-empty {
  margin: 0;
  padding: 28px 0;
  font-size: 13px;
  color: var(--nx-text-3);
  text-align: center;
}

.nx-rank {
  margin: 0;
  padding: 0;
  list-style: none;
}

.nx-rank-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 8px;
  margin: 0 -8px;
  border-radius: 8px;
  transition: background 0.15s ease;
}

/* 发丝线分隔 + hover 行高亮 */
.nx-rank-row + .nx-rank-row {
  border-top: 1px solid var(--nx-border);
}

.nx-rank-row:hover {
  background: var(--nx-surface-hover);
}

.nx-rank-no {
  display: inline-flex;
  flex: 0 0 22px;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--nx-text-3);
  font-variant-numeric: tabular-nums;
  background: var(--nx-bg-soft);
  border-radius: 6px;
}

/* 前三名用 accent 徽标 */
.nx-rank-no.is-top {
  color: var(--nx-accent);
  background: var(--nx-accent-soft);
}

.nx-rank-main {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 1px;
}

.nx-rank-name {
  overflow: hidden;
  font-size: 13px;
  font-weight: 550;
  color: var(--nx-text);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.nx-rank-sub {
  overflow: hidden;
  font-size: 11.5px;
  color: var(--nx-text-3);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.nx-rank-vals {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
}

.nx-rank-primary {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--nx-text);
  font-variant-numeric: tabular-nums;
}

.nx-rank-secondary {
  font-size: 11.5px;
  color: var(--nx-text-3);
  font-variant-numeric: tabular-nums;
}

.nx-mono {
  font-family: var(--nx-font-mono);
  font-size: 12.5px;
}

/* ---------- 时间线 ---------- */
.nx-list-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 26px 12px;
  color: var(--nx-text-2);
  font-size: 13px;
  text-align: center;
}

.nx-list-empty p {
  margin: 0;
}

.nx-timeline {
  margin: 0;
  padding: 0;
  list-style: none;
}

.nx-tl-item {
  position: relative;
  display: flex;
  gap: 12px;
  padding: 0 0 18px 2px;
}

/* 圆点之间的竖向发丝线 */
.nx-tl-item::before {
  content: "";
  position: absolute;
  top: 18px;
  bottom: -2px;
  left: 6px;
  width: 1px;
  background: var(--nx-border);
}

.nx-tl-item:last-child {
  padding-bottom: 0;
}

.nx-tl-item:last-child::before {
  display: none;
}

.nx-tl-dot {
  flex: 0 0 9px;
  width: 9px;
  height: 9px;
  margin-top: 5px;
  background: var(--nx-text-3);
  border-radius: 50%;
}

.nx-tl-dot.is-ok {
  background: var(--nx-success);
}

.nx-tl-dot.is-fail {
  background: var(--nx-danger);
}

.nx-tl-body {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.nx-tl-text {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  font-size: 13px;
}

.nx-tl-text b {
  font-weight: 600;
  color: var(--nx-text);
}

.nx-tl-action {
  font-family: var(--nx-font-mono);
  font-size: 12px;
  color: var(--nx-text-2);
  word-break: break-all;
}

.nx-tl-time {
  flex: 0 0 auto;
  font-size: 11.5px;
  color: var(--nx-text-3);
  white-space: nowrap;
}

/* ---------- 骨架 ---------- */
.nx-skel-line {
  display: block;
  height: 12px;
}

.nx-skel-value {
  display: block;
  width: 55%;
  height: 22px;
  margin-top: 12px;
}

.nx-skel-chart {
  height: 260px;
  margin-top: 16px;
}

.nx-error {
  justify-content: center;
  margin-bottom: 24px;
}

/* ---------- 响应式 ---------- */
@media (max-width: 1200px) {
  .nx-stats {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 1024px) {
  /* 统计卡 3→2 列；Top 榜双列转单列 */
  .nx-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .nx-boards {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 640px) {
  /* 看板页水平 padding 收到 16px，小屏多留内容 */
  .nx-page {
    padding: 22px 16px 44px;
  }

  .nx-head {
    flex-direction: column;
    align-items: stretch;
  }

  .nx-stats {
    grid-template-columns: minmax(0, 1fr);
  }

  .nx-chart-wrap {
    height: 240px;
  }
}
</style>
