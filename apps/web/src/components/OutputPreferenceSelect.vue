<template><section class="output-pref"><label :for="id">输出偏好</label><select :id="id" v-model="outputPreference" aria-label="输出偏好"><option v-for="o in OUTPUT_PREFERENCES" :key="o.value" :value="o.value">{{ o.label }}</option></select><p>{{ benefit }}</p><small>随时切换，对下一轮回答生效。</small></section></template>
<script setup lang="ts">
import {computed,useId} from 'vue'
import {useOutputPreference,OUTPUT_PREFERENCES} from '@/composables/useOutputPreference'
const {outputPreference}=useOutputPreference(),id=useId(),benefit=computed(()=>OUTPUT_PREFERENCES.find(o=>o.value===outputPreference.value)!.benefit)
</script>
<style scoped>.output-pref{margin:8px 16px 12px;padding:12px;border:1px solid var(--nx-border);border-radius:12px;flex-shrink:0;background:var(--nx-surface)}.output-pref label{font-size:12px;font-weight:600;display:block;margin-bottom:7px;color:var(--nx-text)}.output-pref select{width:100%;padding:7px 9px;border-radius:8px;border:1px solid var(--nx-border);color:var(--nx-text);background:var(--nx-surface-2);font:inherit;font-size:12px}.output-pref p{font-size:11px;line-height:1.65;color:var(--nx-text-2);margin:8px 0 3px}.output-pref small{font-size:10px;color:var(--nx-text-3)}.output-pref select:focus-visible{outline:3px solid var(--nx-focus-ring)}</style>
