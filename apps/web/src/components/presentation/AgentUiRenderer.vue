<template>
  <section v-if="validated.page" class="agent-ui" :data-ui-version="validated.page.version" :data-ui-id="validated.page.id" aria-label="结构化回答">
    <div class="aui-layout" :class="'aui-'+validated.page.layout"><AgentUiNode v-for="node in displayPage!.children" :key="node.id" :node="node" :disabled="disabled" :scope="scope" :state-key="stateKey" @ask="$emit('ask',$event)"/></div>
  </section>
  <div v-else class="card-render-failure aui-fallback" data-ui-fallback role="note"><MarkdownView :content="fallback"/><button type="button" :disabled="disabled" @click="attempt++">重新渲染</button><small>{{attempt?'已重新校验；若仍无法显示，请重新生成回答。':'仅重新校验和显示已有回答，不调用模型。'}}</small></div>
</template>
<script setup lang="ts">
import {computed,getCurrentInstance,ref,watch,nextTick,onMounted} from 'vue'
import {reportRender} from '@/utils/presentation-errors'
import MarkdownView from '../MarkdownView.vue'
import {validateUiDocument,normalizeUiDocument,uiFallback} from '@/utils/agent-ui'
import AgentUiNode from './AgentUiNode.vue'
import {cardDisplayData} from '@/utils/card-display'
const props=defineProps<{document:unknown;disabled?:boolean;sourceIds?:ReadonlySet<string>;stateKey?:string;reportKey?:string}>()
const emit=defineEmits<{(e:'ask',message:string):void;(e:'rendered'):void}>()
const attempt=ref(0)
const validated=computed(()=>{void attempt.value;return validateUiDocument(props.document,{sourceIds:props.sourceIds})}),displayPage=computed(()=>validated.value.page?cardDisplayData(validated.value.page,props.sourceIds||new Set()):undefined),fallback=computed(()=>uiFallback(cardDisplayData(normalizeUiDocument(props.document),props.sourceIds||new Set())))
const scope='aui-'+getCurrentInstance()!.uid
let autoUsed=false
watch(()=>[validated.value,props.disabled] as const,([result,disabled])=>{
 if(disabled)return
 if(result.ok){if(attempt.value)reportRender({component:'agent-ui',errorType:'schema',retryMode:attempt.value===1?'automatic':'manual',attempt:attempt.value,messageId:props.reportKey||scope,recovered:true});return}
 reportRender({component:'agent-ui',errorType:'schema',retryMode:attempt.value===0?'initial':attempt.value===1?'automatic':'manual',attempt:attempt.value,messageId:props.reportKey||scope})
 if(!autoUsed){autoUsed=true;void nextTick(()=>attempt.value++)}
},{immediate:true})
onMounted(()=>emit('rendered'))
</script>
<style>
.agent-ui{--aui-bg:var(--nx-surface,var(--el-bg-color));--aui-soft:var(--nx-surface-2,var(--el-fill-color-light));--aui-text:var(--nx-text,var(--el-text-color-primary));--aui-muted:var(--nx-text-2,var(--el-text-color-secondary));--aui-line:var(--nx-border,var(--el-border-color));--aui-accent:var(--nx-accent,var(--el-color-primary));--aui-accent-soft:var(--nx-accent-soft,var(--el-color-primary-light-9));color:var(--aui-text);width:100%;margin:14px 0;font-size:14px;line-height:1.65}
.aui-layout{display:grid;gap:14px;min-width:0}.aui-grid{grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))}.aui-stack{grid-template-columns:minmax(0,1fr)}
.aui-fallback{white-space:pre-wrap;overflow-wrap:anywhere;color:var(--nx-text,var(--el-text-color-primary));line-height:1.8}
.agent-ui *{box-sizing:border-box}.agent-ui button,.agent-ui input,.agent-ui select{font:inherit}.agent-ui button,.agent-ui a{transition:background .15s,border-color .15s}.agent-ui :is(button,input,select,a):focus-visible{outline:3px solid var(--nx-focus-ring,var(--aui-accent));outline-offset:3px}
.agent-ui button:disabled{opacity:.5;cursor:default}.agent-ui button{cursor:pointer}.agent-ui :is(h3,h4,p,figure){margin:0}.agent-ui .aui-node{min-width:0;overflow-wrap:anywhere}
@media(prefers-reduced-motion:reduce){.agent-ui *{transition:none!important}}
</style>
