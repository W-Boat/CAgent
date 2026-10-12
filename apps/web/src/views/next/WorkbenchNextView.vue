<template>
  <div class="nx-root nx-page">
    <!-- 问候 + 主操作：问候不依赖接口，首帧即可渲染 -->
    <header class="nx-head">
      <div class="nx-head-text">
        <h1 class="nx-h1">{{ greeting }}，{{ auth.user?.name || "同学" }}</h1>
        <p class="nx-muted">
          今天已发起 {{ mine?.stats.requestsToday ?? 0 }} 次请求<template v-if="mine">
            · 消耗 {{ formatTokens(mine.stats.tokensToday) }} Token · 费用
            {{ formatCost(mine.stats.costTodayUsd) }}</template
          >
        </p>
      </div>
      <div class="nx-head-actions">
        <button type="button" class="nx-btn nx-btn-primary" @click="router.push('/chat')">
          <el-icon><ChatDotRound /></el-icon>开始对话
        </button>
        <button type="button" class="nx-btn nx-btn-secondary" @click="router.push('/skills')">
          <el-icon><MagicStick /></el-icon>技能中心
        </button>
      </div>
    </header>

    <!-- 首次加载骨架：比转圈更接近成品的布局，感知等待更短 -->
    <div v-if="loading && !mine" class="nx-skel-page">
      <div class="nx-stats">
        <div v-for="i in 4" :key="i" class="nx-card nx-card-pad nx-stat">
          <span class="nx-skel nx-skel-line" style="width: 42%"></span>
          <span class="nx-skel nx-skel-value"></span>
        </div>
      </div>
      <div class="nx-card nx-card-pad">
        <span class="nx-skel nx-skel-line" style="width: 28%"></span>
        <div class="nx-skel nx-skel-chart"></div>
      </div>
    </div>

    <!-- 加载失败：给重试入口，而不是让用户对着白屏猜 -->
    <div v-else-if="!mine" class="nx-notice nx-error">
      工作台数据加载失败
      <button type="button" class="nx-link-btn" @click="retry">重试</button>
    </div>

    <template v-else>
      <!-- 今日配额：扁平进度条，超配额转 danger -->
      <section class="nx-card nx-card-pad nx-quota">
        <div class="nx-quota-item">
          <div class="nx-quota-line">
            <span class="nx-quota-label">今日 Token</span>
            <span class="nx-quota-num">
              {{ formatTokens(mine?.stats.tokensToday ?? 0) }}
              <template v-if="mine?.quota?.dailyTokenLimit">
                / {{ compactNumber(mine.quota.dailyTokenLimit) }}
              </template>
              <template v-else>· 不限</template>
            </span>
          </div>
          <template v-if="mine?.quota?.dailyTokenLimit">
            <div class="nx-bar">
              <i
                class="nx-bar-fill"
                :class="{ 'is-danger': tokenOver }"
                :style="{ width: `${Math.min(100, tokenPercent)}%` }"
              ></i>
            </div>
            <span class="nx-muted">{{ Math.round(tokenPercent) }}%</span>
          </template>
        </div>

        <div class="nx-quota-item">
          <div class="nx-quota-line">
            <span class="nx-quota-label">今日请求</span>
            <span class="nx-quota-num">
              {{ formatNumber(mine?.stats.requestsToday ?? 0) }}
              <template v-if="mine?.quota?.dailyRequestLimit">
                / {{ formatNumber(mine.quota.dailyRequestLimit) }}
              </template>
              <template v-else>· 不限</template>
            </span>
          </div>
          <template v-if="mine?.quota?.dailyRequestLimit">
            <div class="nx-bar">
              <i
                class="nx-bar-fill"
                :class="{ 'is-danger': requestOver }"
                :style="{ width: `${Math.min(100, requestPercent)}%` }"
              ></i>
            </div>
            <span class="nx-muted">{{ Math.round(requestPercent) }}%</span>
          </template>
        </div>

        <div class="nx-quota-foot">
          <span class="nx-muted">
            每月 Token
            {{ mine?.quota?.monthlyTokenLimit ? compactNumber(mine.quota.monthlyTokenLimit) : "不限" }}
          </span>
          <span class="nx-muted">
            每分钟请求 {{ mine?.quota?.rpmLimit ? mine.quota.rpmLimit : "不限" }}
          </span>
        </div>

        <div v-if="mine?.quota && !mine.quota.enabled" class="nx-notice nx-quota-notice">
          配额限制已关闭，可自由使用
        </div>
      </section>

      <!-- 统计卡一行 -->
      <section class="nx-stats">
        <div class="nx-card nx-card-pad nx-stat">
          <div class="nx-stat-top">
            <span class="nx-stat-label">我的会话</span>
            <el-icon class="nx-stat-icon"><ChatLineSquare /></el-icon>
          </div>
          <div class="nx-stat-value">{{ formatNumber(mine?.stats.conversations ?? 0) }}</div>
        </div>
        <div class="nx-card nx-card-pad nx-stat">
          <div class="nx-stat-top">
            <span class="nx-stat-label">消息总数</span>
            <el-icon class="nx-stat-icon"><Document /></el-icon>
          </div>
          <div class="nx-stat-value">{{ formatNumber(mine?.stats.messages ?? 0) }}</div>
        </div>
        <div class="nx-card nx-card-pad nx-stat">
          <div class="nx-stat-top">
            <span class="nx-stat-label">今日 Token</span>
            <el-icon class="nx-stat-icon"><DataLine /></el-icon>
          </div>
          <div class="nx-stat-value">{{ formatNumber(mine?.stats.tokensToday ?? 0) }}</div>
          <div class="nx-stat-hint">费用 {{ formatCost(mine?.stats.costTodayUsd) }}</div>
        </div>
        <div class="nx-card nx-card-pad nx-stat">
          <div class="nx-stat-top">
            <span class="nx-stat-label">今日请求</span>
            <el-icon class="nx-stat-icon"><Promotion /></el-icon>
          </div>
          <div class="nx-stat-value">{{ formatNumber(mine?.stats.requestsToday ?? 0) }}</div>
          <div class="nx-stat-hint">{{ requestHint }}</div>
        </div>
      </section>

      <div class="nx-grid">
        <div class="nx-col-main">
          <!-- 14 天用量趋势 -->
          <section class="nx-card nx-card-pad nx-block">
            <header class="nx-block-head">
              <h2 class="nx-card-title">近 14 天用量</h2>
              <div class="nx-chip-row">
                <button
                  v-for="m in TREND_METRICS"
                  :key="m.key"
                  type="button"
                  class="nx-chip"
                  :class="{ 'is-on': trendMetric === m.key }"
                  @click="trendMetric = m.key"
                >
                  {{ m.label }}
                </button>
              </div>
            </header>
            <!--
              图表容器始终渲染（v-show 控制显隐），空态放兄弟节点：
              ECharts 向容器注入 canvas 属于 Vue 之外的 DOM 变更，
              v-if 与它抢同一父节点会触发 insertBefore 报错（见 ChartPanel 同款处理）。
            -->
            <div class="nx-chart-wrap">
              <div v-show="!trendEmpty" ref="trendHolder" class="nx-chart"></div>
              <div v-if="trendEmpty" class="nx-chart-empty">
                <el-icon :size="22"><TrendCharts /></el-icon>
                <p>近 14 天还没有用量数据</p>
                <p class="nx-muted">发起第一次对话后，这里会出现你的用量曲线</p>
              </div>
            </div>
          </section>
        </div>

        <div class="nx-col-side">
          <!-- 最近会话 -->
          <section class="nx-card nx-card-pad nx-block">
            <header class="nx-block-head">
              <h2 class="nx-card-title">最近会话</h2>
              <button type="button" class="nx-link-btn" @click="router.push('/chat')">全部</button>
            </header>
            <div v-if="!mine?.recentConversations?.length" class="nx-list-empty">
              <el-icon :size="20"><ChatDotRound /></el-icon>
              <p>还没有对话记录</p>
              <button type="button" class="nx-link-btn" @click="router.push('/chat')">
                开启第一次对话
              </button>
            </div>
            <ol v-else class="nx-conv-list">
              <li
                v-for="conv in mine.recentConversations"
                :key="conv.id"
                class="nx-conv-item"
                @click="router.push(`/chat/${conv.id}`)"
              >
                <el-icon class="nx-conv-icon"><ChatDotRound /></el-icon>
                <span class="nx-conv-main">
                  <span class="nx-conv-title">{{ conv.title }}</span>
                  <span class="nx-muted">{{ conv.messageCount }} 条消息 · {{ fromNow(conv.updatedAt) }}</span>
                </span>
                <el-icon class="nx-conv-go"><ArrowRight /></el-icon>
              </li>
            </ol>
          </section>

          <!-- 精选技能 -->
          <section class="nx-card nx-card-pad nx-block">
            <header class="nx-block-head">
              <h2 class="nx-card-title">精选技能</h2>
              <button type="button" class="nx-link-btn" @click="router.push('/skills')">更多</button>
            </header>
            <div v-if="!mine?.featuredSkills?.length" class="nx-list-empty">
              <el-icon :size="20"><MagicStick /></el-icon>
              <p>暂无可用技能</p>
            </div>
            <ul v-else class="nx-skill-list">
              <li
                v-for="skill in mine.featuredSkills"
                :key="skill.id"
                class="nx-skill-item"
                @click="router.push('/skills')"
              >
                <span class="nx-avatar nx-skill-avatar">
                  <el-icon v-if="skillIconKind(skill.icon) === 'component'">
                    <component :is="skill.icon" />
                  </el-icon>
                  <span v-else-if="skillIconKind(skill.icon) === 'glyph'">{{ skill.icon }}</span>
                  <span v-else>{{ skill.name.slice(0, 1) }}</span>
                </span>
                <span class="nx-skill-main">
                  <span class="nx-skill-name">{{ skill.name }}</span>
                  <span class="nx-skill-desc">{{ truncate(skill.description, 46) }}</span>
                </span>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { useRouter } from "vue-router"
import { loadECharts, initChartQueued, type ECharts, type EChartsOption } from "@/utils/echarts"
import { dashboardApi, usageApi } from "@/api"
import { toastError } from "@/api/client"
import { useAuthStore } from "@/stores/auth"
import { resolvedColor } from "@/utils/chart-palette"
import { useThemeStore } from "@/stores/theme"
import { useUiStore } from "@/stores/ui"
import { ICONS } from "@/icons"
import type { MyDashboard, UsageTrendPoint } from "@/api/types"
import { compactNumber, formatCost, formatNumber, formatTokens, fromNow, truncate } from "@/utils/format"
import { useKeepAliveChartResize, useKeepAliveRefresh } from "@/utils/keep-alive"
import { dedupeSkills } from "@/utils/skills"

/*
 * 声明组件名，供 <keep-alive :include> 匹配（约定与路由 name 一致）。
 * 不声明的话缓存会静默失效：切走再回来仍会重建组件、重新拉数据。
 */
defineOptions({ name: "dashboard" })

const auth = useAuthStore()
const theme = useThemeStore()
const ui = useUiStore()
const router = useRouter()

const loading = ref(false)
const mine = ref<MyDashboard | null>(null)
const trend = ref<UsageTrendPoint[]>([])
const trendHolder = ref<HTMLDivElement>()
let chart: ECharts | null = null
let observer: ResizeObserver | null = null
/** 卸载后到达的异步渲染要丢弃，否则会对已卸载 DOM 调 init */
let disposed = false

type TrendMetric = "tokens" | "requests" | "costUsd"
const TREND_METRICS: { key: TrendMetric; label: string }[] = [
  { key: "tokens", label: "Token" },
  { key: "requests", label: "请求" },
  { key: "costUsd", label: "费用" }
]
const trendMetric = ref<TrendMetric>("tokens")

const trendEmpty = computed(() => trend.value.length === 0)

const greeting = computed(() => {
  const hour = new Date().getHours()
  if (hour < 6) return "夜深了，注意休息"
  if (hour < 11) return "早上好"
  if (hour < 14) return "中午好"
  if (hour < 18) return "下午好"
  return "晚上好"
})

/*
 * 配额进度用未封顶的原始百分比：超过 100% 时数字如实展示「超了多少」，
 * 进度条本身封顶（封顶的是视觉宽度，不是事实）。
 */
const tokenPercent = computed(() => {
  const limit = mine.value?.quota?.dailyTokenLimit || 0
  if (!limit) return 0
  return ((mine.value?.stats.tokensToday || 0) / limit) * 100
})

const requestPercent = computed(() => {
  const limit = mine.value?.quota?.dailyRequestLimit || 0
  if (!limit) return 0
  return ((mine.value?.stats.requestsToday || 0) / limit) * 100
})

const tokenOver = computed(() => tokenPercent.value > 100)
const requestOver = computed(() => requestPercent.value > 100)

const requestHint = computed(() => {
  const limit = mine.value?.quota?.dailyRequestLimit || 0
  return limit ? `上限 ${limit} 次/天` : "不限次数"
})

/** 技能 icon 字段可能是图标名 / emoji / 脏数据，解释规则与 SkillAvatar 一致 */
function skillIconKind(icon?: string | null): "component" | "glyph" | "auto" {
  const raw = (icon || "").trim()
  if (!raw) return "auto"
  // 只认全局注册过的图标名（ICONS 与 main.ts 的登记表同源）
  if (Object.prototype.hasOwnProperty.call(ICONS, raw)) return "component"
  // ASCII 字母组成的词多半是「写错的图标名」，交给首字占位更稳妥
  if (/^[A-Za-z][A-Za-z0-9_-]*$/.test(raw)) return "auto"
  return "glyph"
}

/** 读取 nx 令牌的实际色值：canvas 不认 CSS 变量，必须解析成具体颜色 */
function nxColor(el: HTMLElement, name: string, fallback: string): string {
  return resolvedColor(el, name, fallback)
}

/** #rrggbb → rgba(...)：渐变停靠点需要带透明度的颜色 */
function withAlpha(hex: string, alpha: number): string {
  const raw = hex.replace("#", "")
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw
  const num = Number.parseInt(full, 16)
  if (Number.isNaN(num)) return hex
  const r = (num >> 16) & 255
  const g = (num >> 8) & 255
  const b = num & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

async function renderTrend() {
  const el = trendHolder.value
  if (!el || disposed) return
  // 容器被 v-show 隐藏或尚未布局时尺寸为 0，此时 init 会告警且画布不可见
  if (el.clientWidth === 0 || el.clientHeight === 0) return

  // echarts 按需加载：工作台之外的页面不必为图表买单
  const echarts = await loadECharts()
  if (disposed || !trendHolder.value) return
  // 与其他图表共用排队机制，避免同帧多个 chart 一起 init 阻塞主线程
  if (!chart || chart.isDisposed()) {
    chart = await initChartQueued(echarts, el)
    if (disposed || !trendHolder.value) {
      chart.dispose()
      chart = null
      return
    }
  }

  // 颜色从渲染时的令牌解析：暗色/强调色切换后重画即可整体换肤
  const accent = nxColor(el, "--nx-accent", "#4f46e5")
  const text3 = nxColor(el, "--nx-text-3", "#8e8e99")
  const border = nxColor(el, "--nx-border", "#e8e8ec")
  const surface = nxColor(el, "--nx-surface", "#ffffff")

  const dates = trend.value.map((p) => p.date.slice(5))
  const values = trend.value.map((p) =>
    trendMetric.value === "tokens"
      ? p.tokens
      : trendMetric.value === "requests"
        ? p.requests
        : Number(p.costUsd.toFixed(5))
  )

  chart.setOption(
    {
      grid: { left: 48, right: 16, top: 18, bottom: 26 },
      tooltip: {
        trigger: "axis",
        backgroundColor: surface,
        borderColor: border,
        textStyle: { color: nxColor(el, "--nx-text", "#18181b"), fontSize: 12 },
        valueFormatter: (v: number) =>
          trendMetric.value === "costUsd" ? formatCost(v) : formatTokens(v)
      },
      xAxis: {
        type: "category",
        data: dates,
        boundaryGap: false,
        axisTick: { show: false },
        // 发丝轴：1px 边框色，弱化坐标存在感
        axisLine: { lineStyle: { color: border } },
        axisLabel: { color: text3, fontSize: 11 }
      },
      yAxis: {
        type: "value",
        splitLine: { lineStyle: { color: border } },
        axisLabel: {
          color: text3,
          fontSize: 11,
          formatter: (v: number) => (trendMetric.value === "costUsd" ? `$${v}` : compactNumber(v))
        }
      },
      series: [
        {
          type: "line",
          smooth: true,
          data: values,
          showSymbol: false,
          symbolSize: 5,
          itemStyle: { color: accent },
          lineStyle: { width: 2, color: accent },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: withAlpha(accent, 0.18) },
              { offset: 1, color: withAlpha(accent, 0.01) }
            ])
          }
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

watch([trendMetric, () => theme.isDark, () => ui.accent], rerenderCharts)

/*
 * 缓存页面的刷新与图表尺寸：
 * onMounted 只跑一次 → 切回来是旧数据；隐藏时容器尺寸为 0 → canvas 失真。
 * 统一交给 composable 处理（staleAfter 与经典工作台一致）。
 */
const { refresh: refreshAll } = useKeepAliveRefresh(loadAll, { staleAfter: 30_000 })
useKeepAliveChartResize(() => chart?.resize())

async function loadAll() {
  loading.value = true
  try {
    const [dashboardRaw, usage] = await Promise.all([
      dashboardApi.mine(),
      usageApi.mine({ from: undefined }).catch(() => null)
    ])
    /*
     * 精选技能过一遍去重：dashboard 接口直接取技能表，重复导入的技能
     * （如同名技能被导入 4 次）会在这里原样露出。判据与聊天页一致
     * （utils/skills.ts 的 dedupeSkills：名字+描述）。
     */
    let dashboard = dashboardRaw
    if (dashboard.featuredSkills?.length) {
      dashboard = { ...dashboard, featuredSkills: dedupeSkills(dashboard.featuredSkills) }
    }
    mine.value = dashboard
    if (usage?.trend) {
      trend.value = usage.trend.slice(-14)
    }
    // 等一帧让空态的 v-show 先翻转到 DOM，避免容器尺寸仍为 0 而跳过渲染
    void nextTick(() => void renderTrend())
  } catch (error) {
    toastError(error, "工作台数据加载失败")
  } finally {
    loading.value = false
  }
}

/** 加载失败后的手动重试入口 */
function retry() {
  void refreshAll()
}

onMounted(async () => {
  window.addEventListener("resize", resize)
  await refreshAll()
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
  gap: 8px;
}

/* ---------- 配额条 ---------- */
.nx-quota {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 40px;
  /* 卡片内边距交给共享类 .nx-card-pad（16/18），不再自写 */
  margin-bottom: 24px;
}

.nx-quota-item {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.nx-quota-line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.nx-quota-label {
  font-size: 13px;
  font-weight: 550;
  color: var(--nx-text-2);
}

.nx-quota-num {
  font-size: 12.5px;
  color: var(--nx-text-3);
  font-variant-numeric: tabular-nums;
}

/* 扁平进度条：bg-soft 底 + accent 填充，无轨道描边、无渐变 */
.nx-bar {
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--nx-bg-soft);
}

.nx-bar-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--nx-accent);
  transition: width 0.4s ease, background 0.2s ease;
}

.nx-bar-fill.is-danger {
  background: var(--nx-danger);
}

.nx-quota-foot {
  grid-column: 1 / -1;
  display: flex;
  gap: 24px;
  padding-top: 10px;
  border-top: 1px solid var(--nx-border);
}

.nx-quota-notice {
  grid-column: 1 / -1;
}

/* ---------- 统计卡 ---------- */
.nx-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  /* 统计卡网格 gap 统一 12px；区块间垂直节奏 24px */
  gap: 12px;
  margin-bottom: 24px;
}

.nx-stat-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.nx-stat-label {
  font-size: 12.5px;
  color: var(--nx-text-3);
}

.nx-stat-icon {
  font-size: 16px;
  color: var(--nx-text-3);
}

.nx-stat-value {
  margin-top: 8px;
  font-size: 24px;
  font-weight: 650;
  line-height: 1.15;
  letter-spacing: -0.02em;
  color: var(--nx-text);
  font-variant-numeric: tabular-nums;
}

.nx-stat-hint {
  margin-top: 5px;
  font-size: 12px;
  color: var(--nx-text-3);
}

/* ---------- 主体网格 ---------- */
.nx-grid {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  /* 区块间距与垂直节奏统一 24px（窄屏折单列时行距同样吃到） */
  gap: 24px;
  align-items: start;
}

.nx-col-main,
.nx-col-side {
  min-width: 0;
}

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

/* ---------- 图表 ---------- */
.nx-chart-wrap {
  position: relative;
  height: 260px;
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

.nx-chart-empty .nx-muted {
  margin: 0;
  max-width: 22em;
}

.nx-chart-empty p {
  margin: 0;
}

/* ---------- 列表 ---------- */
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

.nx-conv-list,
.nx-skill-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.nx-conv-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 8px;
  margin: 0 -8px;
  cursor: pointer;
  border-radius: 8px;
  transition: background 0.15s ease;
}

.nx-conv-item:hover {
  background: var(--nx-surface-hover);
}

.nx-conv-icon {
  flex: 0 0 auto;
  font-size: 16px;
  color: var(--nx-text-3);
}

.nx-conv-main {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.nx-conv-title {
  overflow: hidden;
  font-size: 13.5px;
  font-weight: 500;
  color: var(--nx-text);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.nx-conv-go {
  flex: 0 0 auto;
  font-size: 13px;
  color: var(--nx-text-3);
  opacity: 0;
  transition: opacity 0.15s ease;
}

.nx-conv-item:hover .nx-conv-go {
  opacity: 1;
}

.nx-skill-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 8px;
  margin: 0 -8px;
  cursor: pointer;
  border-radius: 8px;
  transition: background 0.15s ease;
}

.nx-skill-item:hover {
  background: var(--nx-surface-hover);
}

.nx-skill-avatar {
  width: 34px;
  height: 34px;
  border-radius: 8px;
}

.nx-skill-avatar .el-icon {
  color: var(--nx-accent);
}

.nx-skill-main {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.nx-skill-name {
  font-size: 13.5px;
  font-weight: 550;
  color: var(--nx-text);
}

.nx-skill-desc {
  overflow: hidden;
  font-size: 12px;
  color: var(--nx-text-3);
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* ---------- 骨架 ---------- */
.nx-skel-line {
  display: block;
  height: 12px;
}

.nx-skel-value {
  display: block;
  width: 55%;
  height: 24px;
  margin-top: 12px;
}

.nx-skel-chart {
  height: 240px;
  margin-top: 16px;
}

.nx-error {
  justify-content: center;
  margin-bottom: 24px;
}

/* ---------- 响应式 ---------- */
@media (max-width: 1024px) {
  .nx-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .nx-grid {
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

  .nx-quota {
    grid-template-columns: 1fr;
  }
}
</style>
