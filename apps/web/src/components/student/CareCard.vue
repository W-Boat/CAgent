<template>
  <section class="care-card" aria-label="关怀与陪伴">
    <header><span class="care-heart" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 20S4 15 4 9.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 15 12 20 12 20Z"/></svg></span><h3>{{text(card.title) || '我在这里，慢慢说'}}</h3></header>
    <MarkdownView :content="text(card.body) || '你可以先说说最让你难受的事情，我们一起理一理。'"/>
    <div v-if="actions.length" class="care-actions"><button v-for="(action,i) in actions" :key="i" type="button" :disabled="disabled || sent" @click="choose(action)">{{action.label}}<span aria-hidden="true">↗</span></button></div>
    <p v-if="sent" class="care-sent" role="status">已经告诉我了，我们继续聊。</p>
  </section>
</template>
<script setup lang="ts">
import {computed,ref} from 'vue'
import MarkdownView from '../MarkdownView.vue'
const props=defineProps<{card:Record<string,unknown>;disabled?:boolean}>(),emit=defineEmits<{(e:'ask',text:string):void}>(),sent=ref(false)
const text=(v:unknown)=>typeof v==='string'?v:''
const actions=computed(()=>Array.isArray(props.card.actions)?props.card.actions.filter(a=>a&&typeof a==='object').map(a=>({label:text(a.label),action:text(a.action)})).filter(a=>a.label&&a.action):[])
function choose(action:{action:string}){if(props.disabled||sent.value)return;sent.value=true;emit('ask',action.action)}
</script>
<style scoped>
.care-card{--care-accent:var(--nx-accent,var(--el-color-primary));border:1px solid color-mix(in srgb,var(--care-accent) 24%,var(--nx-border,var(--el-border-color)));border-radius:18px;padding:22px;background:linear-gradient(135deg,color-mix(in srgb,var(--care-accent) 7%,var(--nx-surface,var(--el-bg-color))),var(--nx-surface,var(--el-bg-color)) 75%);color:var(--nx-text,var(--el-text-color-primary));min-width:0}header{display:flex;align-items:center;gap:12px;margin-bottom:12px}.care-heart{display:grid;place-items:center;width:36px;height:36px;border-radius:12px;color:var(--care-accent);background:color-mix(in srgb,var(--care-accent) 10%,transparent);flex-shrink:0}.care-heart svg{width:24px;height:24px}h3{font-size:16px;line-height:1.7;margin:0;font-weight:600}.care-card :deep(.markdown-body){font-size:14px;line-height:1.9}.care-card :deep(.markdown-body>p:first-child){margin-top:0}.care-card :deep(.markdown-body>p:last-child){margin-bottom:0}.care-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}.care-actions button{display:flex;align-items:center;gap:12px;border:1px solid color-mix(in srgb,var(--care-accent) 20%,var(--nx-border,var(--el-border-color)));border-radius:24px;padding:9px 14px;background:var(--nx-surface,var(--el-bg-color));font:inherit;font-size:12px;color:var(--nx-text,var(--el-text-color-primary));cursor:pointer;text-align:left}.care-actions button span{color:var(--care-accent)}.care-actions button:disabled{cursor:default;opacity:.55}.care-actions button:focus-visible{outline:2px solid var(--care-accent);outline-offset:2px}.care-sent{font-size:12px;color:var(--nx-text-2,var(--el-text-color-secondary));margin:12px 0 0}@media(max-width:600px){.care-card{padding:18px}}
</style>
