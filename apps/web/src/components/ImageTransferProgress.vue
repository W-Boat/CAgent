<script setup lang="ts">
import type {ImageTransferState} from '@/composables/useImageAttachments'
defineProps<{state?:ImageTransferState}>()
</script>
<template>
 <div v-if="state" class="image-transfer" :class="{'is-error':state.failed}" role="status">
  <div class="image-transfer-label"><span>{{state.label}}</span><span v-if="state.percent!==undefined">{{state.percent}}%</span></div>
  <div v-if="!state.failed" class="image-transfer-track" role="progressbar" :aria-label="state.label" :aria-valuemin="0" :aria-valuemax="100" :aria-valuenow="state.percent"><span :class="{'is-pending':state.percent===undefined}" :style="{width:state.percent===undefined?'35%':state.percent+'%'}"/></div>
  <small v-if="state.note">{{state.note}}</small>
 </div>
</template>
<style scoped>
.image-transfer{padding:8px 12px;margin:8px 0;border:1px solid var(--nx-border);border-radius:var(--nx-radius-sm);color:var(--nx-text-2);background:var(--nx-surface-2);font-size:12px}
.image-transfer-label{display:flex;justify-content:space-between;gap:12px;font-variant-numeric:tabular-nums}.image-transfer-track{height:3px;overflow:hidden;border-radius:3px;margin:6px 0;background:var(--nx-border)}.image-transfer-track span{display:block;height:100%;background:var(--nx-accent);transition:width .15s ease}.is-pending{animation:image-prepare 1.4s ease-in-out infinite}.image-transfer small{color:var(--nx-text-3)}.is-error{color:var(--nx-danger)}@keyframes image-prepare{from{transform:translateX(-110%)}to{transform:translateX(300%)}}@media(prefers-reduced-motion:reduce){.is-pending{animation:none}.image-transfer-track span{transition:none}}
</style>
