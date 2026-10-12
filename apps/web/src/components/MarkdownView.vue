<template>
  <div
    ref="root"
    class="markdown-body"
    :class="{ 'is-streaming': streaming }"
    v-html="html"
    @click="onClick"
  ></div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue"
import { renderMarkdown } from "@/utils/markdown"

const props = withDefaults(
  defineProps<{
    content?: string | null
    /** 正在流式输出：跳过语法高亮，等结束后再补一次完整渲染 */
    streaming?: boolean
  }>(),
  { streaming: false }
)

const root = ref<HTMLElement | null>(null)

const html = computed(() =>
  renderMarkdown(props.content, { highlight: !props.streaming })
)

/** 代码块「复制」：从按钮所在代码块里取原文 */
async function onClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  const button = target?.closest?.(".md-copy") as HTMLButtonElement | null
  if (!button) return

  const code = button.closest(".md-code")?.querySelector("code")?.textContent ?? ""
  if (!code) return

  const original = button.textContent
  try {
    await navigator.clipboard.writeText(code)
    button.textContent = "已复制"
  } catch {
    // 非安全上下文（http 局域网访问）下 clipboard 不可用，退回 execCommand
    const area = document.createElement("textarea")
    area.value = code
    area.style.position = "fixed"
    area.style.opacity = "0"
    document.body.appendChild(area)
    area.select()
    try {
      document.execCommand("copy")
      button.textContent = "已复制"
    } catch {
      button.textContent = "复制失败"
    }
    document.body.removeChild(area)
  }
  window.setTimeout(() => {
    button.textContent = original || "复制"
  }, 1400)
}
</script>
