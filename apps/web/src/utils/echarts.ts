/**
 * ECharts 按需加载 + 按需引入。
 *
 * 两个层面的优化：
 *  1. 按需注册：只 use 折线/柱状/饼图与用到的组件，
 *     全量 import 约 1MB，这里可砍掉一半以上。
 *  2. 动态 import：图表只出现在工作台/统计页，登录页与聊天页根本用不到。
 *     用 loadECharts() 惰性加载，首屏不必为图表买单。
 *
 * 新增图表类型时在 use() 里补一行即可。
 */
import type { ECharts, EChartsCoreOption } from "echarts/core"

export type { ECharts }
export type EChartsOption = EChartsCoreOption

type EChartsModule = typeof import("echarts/core") & {
  graphic: typeof import("echarts/core").graphic
}

let loading: Promise<EChartsModule> | null = null

/**
 * 加载 echarts（含渲染器与图表类型注册），同一会话内只真正执行一次。
 */
export function loadECharts(): Promise<EChartsModule> {
  if (loading) return loading

  loading = (async () => {
    const [core, charts, components, renderers] = await Promise.all([
      import("echarts/core"),
      import("echarts/charts"),
      import("echarts/components"),
      import("echarts/renderers")
    ])

    core.use([
      charts.LineChart,
      charts.BarChart,
      charts.PieChart,
      components.GridComponent,
      components.TooltipComponent,
      components.LegendComponent,
      components.TitleComponent,
      renderers.CanvasRenderer
    ])

    return core as EChartsModule
  })()

  return loading
}

/**
 * 图表初始化排队。
 *
 * 一页有多个图表时（用量统计页有 7 个），它们会在同一帧里一起 init，
 * 每个都要创建 canvas、解析配置、跑一次布局 —— 实测造成 100ms+ 的长任务，
 * 用户能明显感到卡顿。
 *
 * 这里把 init 摊到多帧：每帧最多处理 2 个，其余排队等下一帧。
 * 首屏总时间几乎不变，但主线程不再被单个长任务堵住。
 */
const initQueue: (() => void)[] = []
/** 每帧最多初始化几个图表：实测 2 个不会产生超过 33ms 的长任务 */
const MAX_INIT_PER_FRAME = 2
let draining = false

function drainQueue() {
  // 每帧只处理配额内的数量，剩下的留给下一帧
  for (let i = 0; i < MAX_INIT_PER_FRAME && initQueue.length > 0; i++) {
    const task = initQueue.shift()!
    task()
  }

  if (initQueue.length > 0) {
    requestAnimationFrame(drainQueue)
  } else {
    draining = false
  }
}

/**
 * 排队初始化一个 ECharts 实例。
 *
 * 与直接 `echarts.init(el)` 的区别：多个图表同时挂载时自动错帧，
 * 避免一页 7 个图表把主线程堵出 100ms+ 的长任务。
 *
 * 注意用 rAF 而非 setTimeout：rAF 在浏览器「下一帧绘制前」执行，
 * 此时上一帧已画完，不会与渲染抢时间；且后台标签页会自动暂停，
 * 不会在用户没看的时候偷偷干活。
 *
 * @param echarts loadECharts() 返回的模块
 * @param el 容器元素
 */
export function initChartQueued(echarts: EChartsModule, el: HTMLElement): Promise<ECharts> {
  return new Promise<ECharts>((resolve, reject) => {
    initQueue.push(() => {
      try {
        resolve(echarts.init(el))
      } catch (err) {
        reject(err)
      }
    })

    if (!draining) {
      draining = true
      requestAnimationFrame(drainQueue)
    }
  })
}
