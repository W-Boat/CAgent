<template>
  <div v-if="failed" key="failed" class="card-render-failure" role="status">
    <strong>这张卡片暂时无法显示</strong><p>回答已保留，可以重新加载卡片组件。</p>
    <button type="button" :disabled="disabled || recovering" @click="retry(false)">{{recovering?'正在自动重渲…':'重新渲染'}}</button><small>{{recovering?'首次失败自动重渲一次。':'后续重渲由你确认，不调用模型；诊断已上报。'}}</small>
  </div>
  <div v-else :key="'content-'+attempt"><slot :ready="ready"/></div>
</template>
<script setup lang="ts">
import {onErrorCaptured,nextTick,ref,watch,onBeforeUnmount} from 'vue'
import {reportRender,type RenderErrorType} from '@/utils/presentation-errors'
const props=defineProps<{identity:unknown;disabled?:boolean;reportKey?:string}>(),failed=ref(false),attempt=ref(0),recovering=ref(false)
let autoUsed=false,active=true,errorType:RenderErrorType='component',retryMode:'initial'|'automatic'|'manual'='initial'
onBeforeUnmount(()=>active=false)
function automatic(){if(autoUsed||props.disabled||!active)return;autoUsed=true;recovering.value=true;void nextTick(()=>retry(true))}
onErrorCaptured(error=>{errorType=/import|load|fetch/i.test(String(error))?'module':'component';reportRender({component:'card-renderer',errorType,retryMode,attempt:attempt.value,messageId:props.reportKey});void nextTick(()=>{if(!active)return;failed.value=true;recovering.value=false;automatic()});return false})
function retry(automatic:boolean){if(!active)return;retryMode=automatic?'automatic':'manual';attempt.value++;failed.value=false}
function ready(){if(!attempt.value||failed.value||!active)return;recovering.value=false;reportRender({component:'card-renderer',errorType,retryMode,attempt:attempt.value,messageId:props.reportKey,recovered:true})}
watch(()=>props.disabled,disabled=>{if(!disabled&&failed.value)automatic()})
watch(()=>JSON.stringify(props.identity),()=>{failed.value=false;attempt.value=0;autoUsed=false;retryMode='initial'})
</script>
<style>
.card-render-failure{padding:18px;margin:12px 0;border:1px solid var(--nx-border,var(--el-border-color));border-radius:16px;background:var(--nx-surface,var(--el-bg-color));color:var(--nx-text,var(--el-text-color-primary));line-height:1.7}.card-render-failure p{margin:7px 0;color:var(--nx-text-2,var(--el-text-color-secondary))}.card-render-failure button{border:1px solid var(--nx-border,var(--el-border-color));background:var(--nx-accent-soft,var(--el-fill-color-light));color:var(--nx-accent,var(--el-color-primary));padding:7px 13px;border-radius:9px;cursor:pointer;font:inherit}.card-render-failure button:disabled{opacity:.5;cursor:default}.card-render-failure small{display:block;margin-top:7px;color:var(--nx-text-2,var(--el-text-color-secondary))}
</style>
