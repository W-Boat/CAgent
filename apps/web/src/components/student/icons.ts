/**
 * 学生端图标集。
 *
 * ── 为什么不用 @element-plus/icons-vue ──
 *
 * 学生端总共只需要 16 个图标，而 Element Plus 的图标包是一个整体导出的
 * 模块（293 个图标），虽可 tree-shake，但每个图标都是一份独立的
 * Vue 组件（含 props 定义、渲染函数），单文件体积可观。
 *
 * 这里直接内联 SVG 路径：零依赖、体积极小、且样式完全由 CSS 控制
 * （stroke 一律用 currentColor，颜色跟着文字走，天然适配明暗主题）。
 *
 * ── 为什么统一用描边风格 ──
 *
 * 24×24 网格、2px 描边、圆头圆角。这与「现代扁平中国风」的
 * 「细墨线」气质一致 —— 实心图标在宣纸色底上会显得厚重。
 *
 * ── 用法 ──
 *
 *   import { IconPlus } from "@/components/student/icons"
 *   <IconPlus />
 *
 * 尺寸由 CSS 决定（`.sc-act svg { width: 15px }`），图标本身不写宽高，
 * 这样同一个图标在不同位置可以有不同的尺寸。
 */
import { defineComponent, h, type PropType } from "vue"

/** 所有图标共用的属性：24 网格 + 描边 */
function svg(paths: string[], opts: { fill?: boolean } = {}) {
  return defineComponent({
    name: "ScIcon",
    props: {
      /** 描边粗细，个别位置需要更细/更粗时可按需覆盖 */
      strokeWidth: { type: [Number, String] as PropType<number | string>, default: 2 }
    },
    setup(props) {
      return () =>
        h(
          "svg",
          {
            viewBox: "0 0 24 24",
            xmlns: "http://www.w3.org/2000/svg",
            // 装饰性图标：语义由外层按钮的 aria-label 承担，避免读屏重复播报
            "aria-hidden": "true",
            focusable: "false",
            fill: opts.fill ? "currentColor" : "none",
            stroke: opts.fill ? "none" : "currentColor",
            "stroke-width": opts.fill ? undefined : props.strokeWidth,
            "stroke-linecap": "round",
            "stroke-linejoin": "round"
          },
          paths.map((d) => h("path", { d }))
        )
    }
  })
}

/* ---------- 操作类 ---------- */

export const IconPlus = svg(["M12 5v14", "M5 12h14"])

export const IconSearch = svg([
  "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z",
  "m21 21-4.3-4.3"
])

export const IconTrash = svg([
  "M3 6h18",
  "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",
  "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
  "M10 11v6",
  "M14 11v6"
])

export const IconCopy = svg([
  "M8 8m0 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2Z",
  "M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2"
])

/** 顺时针闭环箭头，比「两个半圆」更像刷新 */
export const IconRefresh = svg([
  "M20.49 9A9 9 0 0 0 5.64 5.64L3 8",
  "M3 3v5h5",
  "M3.51 15a9 9 0 0 0 14.85 3.36L21 16",
  "M21 21v-5h-5"
])

export const IconImage = svg([
  "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z",
  "M9 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z",
  "m21 15-4.5-4.5L6 21"
])

export const IconSend = svg(["m22 2-7 20-4-9-9-4Z", "M22 2 11 13"])

export const IconStop = svg(["M7 7h10v10H7Z"], { fill: true })

/* ---------- 方向类 ---------- */

export const IconDown = svg(["M12 5v14", "m19 12-7 7-7-7"])

export const IconMenu = svg(["M4 6h16", "M4 12h16", "M4 18h16"])

/*
 * 置顶标记用实心图钉而不是 📌 emoji：
 * emoji 由系统字体渲染，在 Windows / macOS / Android 上形态与配色
 * 各不相同，放进这套克制的宣纸配色里会显得跳脱。
 */
export const IconPin = svg(
  [
    "M12 17v5",
    "M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6Z"
  ],
  { fill: true }
)

/* ---------- 反馈类 ---------- */

export const IconThumbUp = svg([
  "M7 10v12",
  "M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"
])

export const IconThumbDown = svg([
  "M17 14V2",
  "M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"
])

/* ---------- 主题与账号 ---------- */

export const IconSun = svg([
  "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  "M12 2v2",
  "M12 20v2",
  "m4.93 4.93 1.41 1.41",
  "m17.66 17.66 1.41 1.41",
  "M2 12h2",
  "M20 12h2",
  "m6.34 17.66-1.41 1.41",
  "m19.07 4.93-1.41 1.41"
])

export const IconMoon = svg(["M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"])

export const IconLogout = svg([
  "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4",
  "m16 17 5-5-5-5",
  "M21 12H9"
])

/* ---------- 界面版本 ---------- */

/** 新版界面入口：四角星火花，语义是「焕新的体验」 */
export const IconSparkle = svg([
  "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z",
  "M19 15l.9 2.4L22 18l-2.1.6L19 21l-.9-2.4L16 18l2.1-.6L19 15Z"
])
