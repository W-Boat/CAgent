/**
 * 缓存页面的刷新与图表尺寸处理。
 *
 * `<keep-alive>` 带来两个容易忽略的副作用：
 *
 *   1. **数据不再自动更新**
 *      `onMounted` 只在首次进入时执行，之后切回来看到的是旧数据。
 *      但也不能无脑按 `onActivated` 就重拉 —— 用户来回切几次就会打出一串请求。
 *
 *   2. **图表在隐藏容器里尺寸失真**
 *      组件被缓存后容器 `display:none`，此时 `resize()` 拿到 0×0；
 *      切回来时 canvas 仍是旧尺寸（多为 0），表现为图表空白或错位。
 *
 * 这个 composable 把两件事都收口：
 *   - 按「距上次加载是否超过阈值」决定要不要重拉（默认 30 秒）
 *   - 激活时对图表调用 resize（等一帧，确保容器已有尺寸）
 */
import { onActivated, onDeactivated, ref } from "vue"

export interface UseKeepAliveRefreshOptions {
  /**
   * 数据视为「仍然新鲜」的时长（毫秒）。
   * 在此之内切回来不重新请求，避免快速来回切换时打出一串请求。
   */
  staleAfter?: number
  /** 每次激活都强制刷新（用于实时性要求高的页面） */
  alwaysRefresh?: boolean
}

/**
 * 缓存页面的数据刷新。
 *
 * @param load 加载函数（通常是页面里的 `loadAll` / `load`）
 * @param options 刷新策略
 * @returns `lastLoadedAt` 上次加载时间戳，`refreshIfStale()` 手动触发
 */
export function useKeepAliveRefresh(
  load: () => void | Promise<void>,
  options: UseKeepAliveRefreshOptions = {}
) {
  const { staleAfter = 30_000, alwaysRefresh = false } = options
  const lastLoadedAt = ref(0)

  /** 包一层，记录加载时间 */
  const wrapped = async () => {
    await load()
    lastLoadedAt.value = Date.now()
  }

  onActivated(() => {
    const age = Date.now() - lastLoadedAt.value
    // 首次进入由 onMounted 负责，这里只处理「再次进入」
    if (lastLoadedAt.value === 0) return
    if (alwaysRefresh || age > staleAfter) {
      void wrapped()
    }
  })

  return { lastLoadedAt, refresh: wrapped }
}

/**
 * 缓存页面的图表尺寸修复。
 *
 * @param resize 调整图表尺寸的函数（如 `() => chart?.resize()`）
 * @param options `onActivate` 是否在激活时也 resize（默认 true）
 */
export function useKeepAliveChartResize(
  resize: () => void,
  options: { onActivate?: boolean; onDeactivate?: boolean } = {}
) {
  const { onActivate = true, onDeactivate = false } = options

  if (onActivate) {
    onActivated(() => {
      /*
       * 等两帧再 resize。
       *
       * keep-alive 切回来的同一帧内，容器刚从 display:none 恢复，
       * 布局尚未完成，此刻读到的仍是 0 宽 —— 直接 resize 会把图表压成一条线。
       * 用 rAF 排到下一帧，尺寸才可靠。
       */
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try {
            resize()
          } catch {
            /* 图表可能已销毁，忽略 */
          }
        })
      })
    })
  }

  if (onDeactivate) {
    onDeactivated(() => {
      try {
        resize()
      } catch {
        /* 忽略 */
      }
    })
  }
}
