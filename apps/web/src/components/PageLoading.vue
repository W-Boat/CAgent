<script setup lang="ts">
withDefaults(defineProps<{ label?: string; rows?: number }>(), {
  label: '正在加载页面',
  rows: 4,
})
</script>

<template>
  <div class="page-loading" :class="{ 'has-skeleton': rows > 0 }">
    <div class="page-loading-progress" role="progressbar" :aria-label="label"></div>
    <el-skeleton v-if="rows > 0" animated :rows="rows" aria-hidden="true"/>
  </div>
</template>

<style scoped>
.page-loading {
  display: grid;
  gap: 16px;
  min-width: 0;
  margin-block: 12px;
}
.page-loading.has-skeleton > * {
  width: min(100%, 34rem);
  margin-inline: auto;
}
.page-loading :deep(.el-skeleton__paragraph) { width: 86%; }
.page-loading :deep(.el-skeleton__paragraph:nth-child(3n)) { width: 64%; }
.page-loading :deep(.el-skeleton__paragraph:last-child) { width: 42%; }
.page-loading-progress {
  position: relative;
  height: 3px;
  border-radius: 999px;
  overflow: hidden;
  background: var(--nx-border, var(--el-fill-color));
}
.page-loading-progress::before {
  content: '';
  position: absolute;
  inset-block: 0;
  width: 32%;
  border-radius: inherit;
  background: var(--nx-accent, var(--el-color-primary));
  animation: page-loading-slide 1.25s ease-in-out infinite;
}
@keyframes page-loading-slide {
  from { transform: translateX(-100%); }
  to { transform: translateX(315%); }
}
@media (prefers-reduced-motion: reduce) {
  .page-loading-progress::before { animation: none; left: 34%; }
  .page-loading :deep(.el-skeleton__item) { animation: none; }
}
</style>
