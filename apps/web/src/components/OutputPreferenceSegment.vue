<script setup lang="ts">
import {computed} from 'vue'
import {OUTPUT_PREFERENCES,useOutputPreference} from '@/composables/useOutputPreference'

const {outputPreference}=useOutputPreference()
const position=computed(()=>OUTPUT_PREFERENCES.findIndex(option=>option.value===outputPreference.value))
</script>

<template>
  <div class="output-segment" role="group" aria-label="输出偏好" :style="{'--position':position}">
    <span class="output-thumb" aria-hidden="true"/>
    <button v-for="option in OUTPUT_PREFERENCES" :key="option.value" type="button" :aria-pressed="outputPreference===option.value" :title="option.benefit" @click="outputPreference=option.value">{{option.label}}</button>
  </div>
</template>

<style scoped>
.output-segment{position:relative;isolation:isolate;display:grid;grid-template-columns:repeat(3,1fr);flex:none;box-sizing:border-box;height:29px;overflow:hidden;padding:2px;border:1px solid var(--nx-border);border-radius:999px;background:var(--nx-surface-2)}
.output-thumb{position:absolute;z-index:-1;top:2px;bottom:2px;left:2px;width:calc((100% - 4px)/3);border-radius:999px;background:var(--nx-accent);transform:translateX(calc(var(--position)*100%));transition:transform .27s cubic-bezier(.2,.8,.2,1),background .18s ease}
.output-segment button{white-space:nowrap;border:0;border-radius:999px;background:none;padding:0 8px;color:var(--nx-text-2);font:inherit;font-size:11px;cursor:pointer;transition:color .18s ease}.output-segment button[aria-pressed=true]{color:var(--nx-text-invert);font-weight:650}.output-segment button:focus-visible{outline:2px solid var(--nx-accent);outline-offset:-2px}
@media(prefers-reduced-motion:reduce){.output-thumb,.output-segment button{transition:none}}
</style>
