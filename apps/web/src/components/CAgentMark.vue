<template>
  <!-- CAgent 品牌图标：纯色「对话 + 智能核心」造型，无渐变，跟随 currentColor -->
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 64 64"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="CAgent"
    class="cagent-mark"
  >
    <!-- 对话气泡底 -->
    <path
      d="M32 8c-13.8 0-25 9.6-25 21.4 0 6.9 3.8 13 9.7 16.9-.4 3.1-1.7 6-3.9 8.4a1.2 1.2 0 0 0 1 2c4.7-.4 8.9-2.2 12.1-4.7 2 .4 4 .6 6.1.6 13.8 0 25-9.6 25-21.4S45.8 8 32 8Z"
      :fill="bubble"
    />
    <!-- 智能核心：圆点 + 环 -->
    <circle cx="32" cy="29.4" r="8.6" fill="none" :stroke="core" stroke-width="4.2" />
    <circle cx="32" cy="29.4" r="3" :fill="core" />
    <!-- 两侧对称圆点：呼应「多智能体协作」 -->
    <circle cx="17.5" cy="29.4" r="2.6" :fill="core" opacity="0.55" />
    <circle cx="46.5" cy="29.4" r="2.6" :fill="core" opacity="0.55" />
  </svg>
</template>

<script setup lang="ts">
import { computed } from "vue"

const props = withDefaults(
  defineProps<{
    /** 直接给颜色（如 #2563eb）；不传则继承 currentColor */
    color?: string | null
    /** 底色气泡；默认继承 currentColor，透明度内置 */
    bubbleColor?: string | null
    size?: number
  }>(),
  { color: null, bubbleColor: null, size: 32 }
)

const core = computed(() => props.color || "currentColor")
const bubble = computed(() => props.bubbleColor || props.color || "currentColor")
</script>

<style scoped>
.cagent-mark {
  display: block;
  flex: 0 0 auto;
}
</style>
