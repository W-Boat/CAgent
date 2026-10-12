<template>
  <el-card shadow="never" class="chart-card">
    <template #header>
      <div class="chart-head">
        <span class="chart-title">{{ title }}</span>
        <slot name="extra" />
      </div>
    </template>
    <!--
      注意：ECharts 会向容器内注入 canvas，属于「Vue 之外的 DOM 变更」。
      因此图表容器始终渲染（用 v-show 控制显隐），空状态放在兄弟节点上，
      避免 v-if 与 ECharts 抢占同一父节点的子节点顺序，
      否则会出现 Cannot read properties of null (reading 'insertBefore')。
    -->
    <div class="chart-body" :style="{ height: `${height}px` }">
      <div v-show="!isEmpty" ref="holder" class="chart-holder"></div>
      <div v-if="isEmpty" class="empty-block">暂无数据</div>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { loadECharts, initChartQueued, type ECharts, type EChartsOption } from "@/utils/echarts"
import { themedChartOption } from '@/utils/chart-palette'
import { useUiStore } from '@/stores/ui'
import { useThemeStore } from '@/stores/theme'

const ui=useUiStore(),theme=useThemeStore()

const props = withDefaults(
  defineProps<{
    title: string
    option: EChartsOption
    height?: number
    isEmpty?: boolean
  }>(),
  { height: 300, isEmpty: false }
)

const holder = ref<HTMLDivElement>()
let chart: ECharts | null = null
let observer: ResizeObserver | null = null
/** 组件卸载后到达的异步渲染要丢弃，否则会对已卸载 DOM 调 init */
let disposed = false

async function render() {
  const el = holder.value
  if (!el || props.isEmpty || disposed) return
  // 容器被 v-show 隐藏或尚未布局时尺寸为 0，此时 init 会告警且画布不可见，直接跳过
  if (el.clientWidth === 0 || el.clientHeight === 0) return

  // 图表库按需加载：只有真的要画图时才下载 echarts
  const echarts = await loadECharts()
  if (disposed || !holder.value) return

  /*
   * 排队初始化：一个页面有多个图表时（用量统计页有 7 个），
   * 同帧一起 init 会造成 100ms+ 的长任务。排队后按帧错开，主线程不再被堵住。
   */
  if (!chart || chart.isDisposed()) {
    chart = await initChartQueued(echarts, el)
    // 排队期间组件可能已卸载或容器已变，需重新确认
    if (disposed || !holder.value) {
      chart.dispose()
      chart = null
      return
    }
  }
  chart.setOption(themedChartOption(props.option, el), true)
  chart.resize()
}

function resize() {
  if (chart && !chart.isDisposed() && holder.value?.clientWidth) chart.resize()
}

watch([()=>ui.accent,()=>theme.isDark],async()=>{await nextTick();void render()})

onMounted(async () => {
  await nextTick()
  void render()
  window.addEventListener("resize", resize)
  if (holder.value && typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(() => {
      // 容器尺寸从 0 恢复（如空状态切走、侧边栏折叠）时补一次渲染
      if (!chart || chart.isDisposed()) void render()
      else resize()
    })
    observer.observe(holder.value)
  }
})

watch(
  () => props.option,
  () => void render(),
  { deep: true }
)

watch(
  () => props.isEmpty,
  async (empty) => {
    if (empty) {
      if (chart && !chart.isDisposed()) chart.dispose()
      chart = null
      return
    }
    // 容器刚由 v-show 恢复显示，需等一帧再测量尺寸
    await nextTick()
    void render()
  }
)

onBeforeUnmount(() => {
  disposed = true
  window.removeEventListener("resize", resize)
  observer?.disconnect()
  observer = null
  if (chart && !chart.isDisposed()) chart.dispose()
  chart = null
})
</script>

<style scoped>
.chart-card {
  border-radius: var(--cg-radius);
}
.chart-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.chart-title {
  font-size: 15px;
  font-weight: 600;
}
.chart-body {
  position: relative;
  width: 100%;
}
.chart-holder {
  width: 100%;
  height: 100%;
}
.empty-block {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--cg-text-muted);
  font-size: 13px;
}
</style>
