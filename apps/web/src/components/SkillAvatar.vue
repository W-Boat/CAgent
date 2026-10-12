<template>
  <div class="skill-avatar" :style="style" :title="label">
    <!-- 1) Element Plus 图标名（如 "Search"）→ 渲染成矢量图标 -->
    <el-icon v-if="iconComponent" :size="iconSize">
      <component :is="iconComponent" />
    </el-icon>

    <!-- 2) 表情符号或单个字符 → 直接显示 -->
    <span v-else-if="glyph" class="glyph" :style="{ fontSize: glyphSize }">
      {{ glyph }}
    </span>

    <!-- 3) 什么都没有 → 用名称自动生成占位头像（首字 + 稳定配色） -->
    <span v-else class="glyph" :style="{ fontSize: glyphSize }">{{ initial }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import * as ElementPlusIcons from "@element-plus/icons-vue"

const props = withDefaults(
  defineProps<{
    /** 技能/智能体上存的 icon 字段：可能是图标名、emoji，也可能为空 */
    icon?: string | null
    /** 自动生成占位头像时取首字用 */
    name?: string | null
    /** 兜底种子，通常传 key，保证同一技能每次颜色一致 */
    seed?: string | null
    size?: number
  }>(),
  { size: 40 }
)

const iconNames = new Set(Object.keys(ElementPlusIcons))

/**
 * 判断 icon 字段到底是「图标名」「emoji」还是「脏数据」。
 *
 * 历史原因：seed 里存的是 Element Plus 图标名（"Document"、"Search"），
 * 而早期界面直接把它当文本渲染，于是卡片上出现一行小字 "Document"。
 * 这里统一解释成图标，同时兼容管理员手填 emoji 的情况。
 */
const kind = computed<"component" | "glyph" | "auto">(() => {
  const raw = (props.icon || "").trim()
  if (!raw) return "auto"
  if (iconNames.has(raw)) return "component"
  // ASCII 字母组成的词多半是「写错的图标名」，交给自动头像处理更稳妥
  if (/^[A-Za-z][A-Za-z0-9_-]*$/.test(raw)) return "auto"
  return "glyph"
})

const iconComponent = computed(() =>
  kind.value === "component" ? ((props.icon || "").trim() as never) : null
)
const glyph = computed(() => (kind.value === "glyph" ? (props.icon || "").trim() : ""))

const initial = computed(() => {
  const source = (props.name || props.seed || "?").trim()
  // 中文取首字；英文取首字母大写
  return source.slice(0, 1).toUpperCase() || "?"
})

/** 调色板：低饱和纯色、彼此可区分，配白字对比度足够 */
const PALETTE = [
  "#3b82f6",
  "#0ea5e9",
  "#8b5cf6",
  "#ec4899",
  "#f59e0b",
  "#10b981",
  "#14b8a6",
  "#ef4444",
  "#64748b",
  "#a855f7"
]

/** 简单字符串哈希：同一个 key 永远得到同一组颜色 */
function hash(text: string): number {
  let h = 0
  for (let i = 0; i < text.length; i++) {
    h = (h << 5) - h + text.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

const style = computed(() => {
  const size = `${props.size}px`
  const base = {
    width: size,
    height: size,
    borderRadius: `${Math.round(props.size * 0.26)}px`,
    fontSize: `${Math.round(props.size * 0.5)}px`
  }

  // 有真图标/emoji 时用中性底色，避免花哨配色抢戏
  if (kind.value !== "auto") {
    return { ...base, background: "var(--cg-brand-soft)", color: "var(--cg-brand)" }
  }

  const color = PALETTE[hash(props.seed || props.name || "?") % PALETTE.length]
  return {
    ...base,
    background: color,
    color: "#fff"
  }
})

const iconSize = computed(() => Math.round(props.size * 0.5))
const glyphSize = computed(() => `${Math.round(props.size * 0.46)}px`)
const label = computed(() => props.name || props.seed || "")
</script>

<style scoped>
.skill-avatar {
  display: flex;
  flex: 0 0 auto;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  font-weight: 600;
  line-height: 1;
  user-select: none;
  min-width: 32px;
  min-height: 32px;
  aspect-ratio: 1 / 1;
}

.glyph {
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 中文字形基线天然偏下，整体上抬一点让视觉重心居中 */
  transform: translateY(-0.04em);
}
</style>
