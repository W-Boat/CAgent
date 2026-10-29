<template>
  <article class="aui-service" :data-service-mode="node.mode">
    <header class="aui-service-head">
      <span class="aui-service-icon" aria-hidden="true"><component :is="node.mode === 'online' ? Monitor : Location" /></span>
      <div class="aui-service-identity"><span class="aui-service-mode">{{ node.mode === 'online' ? '线上办理' : '线下窗口' }}</span><h4>{{ node.title }}</h4></div>
    </header>
    <p v-if="node.summary" class="aui-service-summary">{{ node.summary }}</p>
    <dl v-if="node.location || node.contact" class="aui-service-details">
      <div v-if="node.location"><dt>地点</dt><dd>{{ node.location }}</dd></div>
      <div v-if="node.contact"><dt>联系</dt><dd>{{ node.contact }}</dd></div>
    </dl>
    <a v-if="node.action?.kind === 'link' && !disabled" class="aui-service-action" :href="node.action.url" target="_blank" rel="noopener noreferrer">{{ node.actionLabel }}<TopRight aria-hidden="true" /></a>
    <button v-else-if="node.action" type="button" class="aui-service-action" :disabled="disabled" @click="ask">{{ node.actionLabel }}<ArrowRight aria-hidden="true" /></button>
  </article>
</template>
<script setup lang="ts">
import {Monitor,Location,TopRight,ArrowRight} from '@element-plus/icons-vue'
import type {UiService} from '@/utils/agent-ui'
const props=defineProps<{node:UiService;disabled?:boolean}>()
const emit=defineEmits<{(event:'ask',message:string):void}>()
function ask(){if(!props.disabled&&props.node.action?.kind==='ask')emit('ask',props.node.action.message)}
</script>
<style scoped>
.aui-service{display:flex;flex-direction:column;height:100%;gap:16px;padding:20px;border:1px solid var(--aui-line);border-radius:16px;background:var(--aui-bg)}
.aui-service-head{display:flex;align-items:center;gap:12px}.aui-service-icon{display:grid;place-items:center;flex:0 0 42px;height:42px;border-radius:12px;color:var(--aui-accent);background:var(--aui-accent-soft)}.aui-service-icon svg{width:21px;height:21px}
.aui-service[data-service-mode=offline] .aui-service-icon{color:var(--aui-muted);background:var(--aui-soft);border:1px solid var(--aui-line)}
.aui-service-identity{min-width:0}.aui-service-mode{display:block;font-size:12px;line-height:1.5;color:var(--aui-muted);margin-bottom:3px}.aui-service h4{font-size:16px;line-height:1.5;font-weight:650;margin:0}.aui-service-summary{margin:0;color:var(--aui-muted);white-space:pre-wrap;line-height:1.75}
.aui-service-details{display:grid;gap:9px;margin:0}.aui-service-details>div{display:grid;grid-template-columns:2.5em minmax(0,1fr);gap:12px}.aui-service-details dt{color:var(--aui-muted);font-size:13px}.aui-service-details dd{margin:0;white-space:pre-wrap;font-variant-numeric:tabular-nums}
.aui-service-action{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:44px;margin-top:auto;padding:12px 0 0;border:0;border-top:1px solid var(--aui-line);background:transparent;color:var(--aui-accent);font:inherit;font-weight:600;text-decoration:none;text-align:left;cursor:pointer}.aui-service-action svg{flex:0 0 17px;width:17px;height:17px}.aui-service-action:disabled{opacity:.5;cursor:default}.aui-service-action:hover:not(:disabled){text-decoration:underline;text-underline-offset:4px}
@media(max-width:600px){.aui-service{padding:16px;gap:14px}}
</style>
