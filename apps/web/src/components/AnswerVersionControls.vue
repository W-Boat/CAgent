<script setup lang="ts">
import { IconRefresh } from '@/components/student/icons'

withDefaults(defineProps<{
  count?: number
  selected?: number
  disabled?: boolean
  generateDisabled?: boolean
  generateTitle?: string
  error?: string
}>(), {
  count: 1,
  selected: 0,
  generateTitle: '生成新版本（调用模型）；左右切换已有版本不调用模型'
})
const emit = defineEmits<{
  (e: 'select', index: number): void
  (e: 'generate'): void
}>()
</script>

<template>
  <span class="answer-versions">
    <span v-if="count > 1" class="answer-version-pager">
      <button type="button" class="nx-icon-btn" aria-label="上一版回答" title="上一版回答" :disabled="disabled || selected <= 0" @click="emit('select', selected - 1)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m15 18-6-6 6-6"/></svg>
      </button>
      <span class="answer-version-count" aria-label="回答版本" aria-live="polite">{{ selected + 1 }} / {{ count }}</span>
      <button type="button" class="nx-icon-btn" aria-label="下一版回答" title="下一版回答" :disabled="disabled || selected >= count - 1" @click="emit('select', selected + 1)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m9 6 6 6-6 6"/></svg>
      </button>
    </span>
    <button type="button" class="nx-icon-btn" aria-label="重新生成" :title="generateTitle" :disabled="disabled || generateDisabled" @click="emit('generate')"><IconRefresh/></button>
    <small v-if="error" class="answer-version-error" role="alert">{{ error }}</small>
  </span>
</template>

<style scoped>
.answer-versions{display:inline-flex;align-items:center;gap:2px;flex-wrap:wrap;min-width:0;color:var(--nx-text-3);font-size:12px}
.answer-version-pager{display:inline-flex;align-items:center;gap:2px}
.answer-version-count{min-width:36px;text-align:center;font-variant-numeric:tabular-nums;white-space:nowrap}
.nx-icon-btn:disabled{opacity:.4;cursor:not-allowed}
.nx-icon-btn:disabled:hover{color:var(--nx-text-3);background:transparent}
.answer-version-error{color:var(--nx-danger);overflow-wrap:anywhere}
</style>
