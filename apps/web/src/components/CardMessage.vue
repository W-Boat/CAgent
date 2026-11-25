<template>
  <AnswerPending v-if="streaming && !content?.trim()" compact :phase="progress?.stage || 'preparing'"/>
  <template v-for="(seg,i) in segments" :key="i">
    <MarkdownView v-if="seg.kind==='markdown'" :content="seg.text" :streaming="streaming"/>
    <button v-else-if="seg.kind==='card'&&panelFeatures&&featureFromCard(seg.card)" class="nx-btn nx-btn-secondary feature-reopen" type="button" :disabled="streaming" @click="emit('feature',displayCard(seg.card))"><el-icon><Grid/></el-icon><span>打开{{seg.card.title||'校园服务'}}</span><el-icon><ArrowRight/></el-icon></button>
    <span v-else-if="seg.kind==='card'&&seg.card.type==='campus-feature'">{{seg.card.title}}</span>
    <CardRenderBoundary v-else-if="seg.kind==='card'" class="card-message-reveal" :identity="seg.card" :fallback="uiContentText(displayCard(seg.card))" :disabled="disabled || streaming" :report-key="(effectKey || instanceKey)+':'+i">
      <template #default="{ready}">
        <AgentUiRenderer v-if="isUiDocument(seg.card)" :document="seg.card" :disabled="disabled || streaming" :source-ids="sourceIds" :state-key="effectKey" :report-key="(effectKey || instanceKey)+':'+i" @rendered="ready" @ask="askInLayout"/>
        <StudentCard v-else :card="displayCard(seg.card)" :disabled="disabled || streaming" :auto-play="autoPlay ?? liveEffect" :effect-key="effectKey || instanceKey" @vue:mounted="ready" @ask="$emit('ask',$event)" @switch-agent="$emit('switch-agent',$event)" @use-skill="$emit('use-skill',$event)"/>
      </template>
      <template #fallback>
        <div :class="{ 'fixed-recovery': isUiDocument(seg.card) && auth.settings?.presentation_fallback === 'fixed' }">
          <MarkdownView :content="uiContentText(displayCard(seg.card))" />
        </div>
      </template>
    </CardRenderBoundary>
    <CardParseFailure v-else-if="seg.kind==='broken'" :disabled="disabled || streaming" :report-key="(effectKey || instanceKey)+':'+i" @retry="renderAttempt++"/>
    <AnswerPending v-else/>
  </template>
  <el-skeleton v-if="streaming&&content?.trim()&&progress?.stage==='finalizing'&&!segments.some(s=>s.kind==='pending'||s.kind==='card')" class="layout-pending" :rows="3" animated aria-label="正在编排卡片"/>
</template>
<script setup lang="ts">
import {computed,getCurrentInstance,ref,watch,defineAsyncComponent} from 'vue'
import {ArrowRight,Grid} from '@element-plus/icons-vue'
import MarkdownView from './MarkdownView.vue'
import AnswerPending from './presentation/AnswerPending.vue'
import CardRenderBoundary from './presentation/CardRenderBoundary.vue'
import CardParseFailure from './presentation/CardParseFailure.vue'
import StudentCard from './student/StudentCard.vue'
import {createAnswerProjector} from '@/utils/answer-projector'
import {cardDisplayData} from '@/utils/card-display'
import {isUiDocument,uiContentText} from '@/utils/agent-ui'
import {useAuthStore} from '@/stores/auth'
import {featureFromCard} from '@/utils/campus-features'
const auth = useAuthStore()
let retryModuleUrl='',loadAttempt=0
async function loadRenderer(){
  try{
    if(retryModuleUrl){const url=new URL(retryModuleUrl);url.searchParams.set('card_retry',String(++loadAttempt));return await import(/* @vite-ignore */url.href)}
    return await import('./presentation/AgentUiRenderer.vue')
  }catch(error){
    const candidate=String((error as Error)?.message).match(/https?:\/\/[^\s"']+\/assets\/AgentUiRenderer-[^\s"']+\.js(?:\?[^\s"']*)?/)?.[0]
    if(candidate){const url=new URL(candidate);if(url.origin===window.location.origin)retryModuleUrl=url.href}
    throw error
  }
}
const AgentUiRenderer=defineAsyncComponent({loader:loadRenderer,loadingComponent:AnswerPending,delay:0,onError:(_error,_retry,fail)=>fail()})
const props=defineProps<{content?:string|null;streaming?:boolean;disabled?:boolean;autoPlay?:boolean;effectKey?:string;hasKnowledgeSources?:boolean;knowledgeSources?:{id:string;citationId?:string}[];progress?:{stage:string};confirmAsk?:boolean;panelFeatures?:boolean}>()
const sourceIds=computed<Set<string>>(previous=>{const ids=new Set((props.knowledgeSources||[]).flatMap(s=>[s.id,...(s.citationId?[s.citationId]:[])]));return previous&&previous.size===ids.size&&[...ids].every(id=>previous.has(id))?previous:ids})
const displayCache=new WeakMap<object,{sources:ReadonlySet<string>;card:Record<string,unknown>}>()
const displayCard=(card:Record<string,unknown>)=>{const cached=displayCache.get(card);if(cached?.sources===sourceIds.value)return cached.card;const clean=cardDisplayData(card,sourceIds.value);displayCache.set(card,{sources:sourceIds.value,card:clean});return clean}
const renderAttempt=ref(0)
let projector=createAnswerProjector()
const segments=computed(()=>{
 void renderAttempt.value
 return projector.project(props.content||'',!!props.streaming,sourceIds.value,props.hasKnowledgeSources)
})
watch(renderAttempt,()=>{projector=createAnswerProjector()},{flush:'sync'})
const liveEffect=ref(false),instanceKey='answer-'+getCurrentInstance()!.uid
watch(()=>props.streaming,value=>{if(value)liveEffect.value=true},{immediate:true})
const emit=defineEmits<{ask:[text:string];'draft-ask':[text:string];'switch-agent':[id:string];'use-skill':[key:string];feature:[card:Record<string,unknown>]}>()
let opened=false
watch([segments,()=>props.streaming,()=>props.autoPlay],()=>{
 if(opened||!props.panelFeatures||props.streaming||!(props.autoPlay??liveEffect.value))return
 const first=segments.value.find(s=>s.kind==='card'&&featureFromCard(s.card))
 if(first?.kind==='card'){opened=true;emit('feature',displayCard(first.card))}
},{immediate:true,flush:'post'})
function askInLayout(text: string) {
 if (props.confirmAsk) emit('draft-ask',text)
 else emit('ask',text)
}
</script>
<style scoped>.feature-reopen{margin:5px 0;min-height:34px;gap:7px;border:1px solid var(--nx-accent-border);border-radius:10px;background:var(--nx-accent-soft);color:var(--nx-accent);font-weight:600}.feature-reopen:hover{border-color:var(--nx-accent);background:var(--nx-surface)}.feature-reopen .el-icon:last-child{margin-left:2px}.layout-pending{padding:14px;border:1px solid var(--nx-border);border-radius:12px;margin-block:12px;background:var(--nx-surface)}</style>
<style scoped>.card-message-reveal{animation:card-reveal .22s cubic-bezier(.2,.7,.2,1) both}.fixed-recovery{border-left:3px solid var(--nx-accent);border-radius:8px;padding:8px 12px;background:var(--nx-surface-2);white-space:pre-wrap}@keyframes card-reveal{from{opacity:.35;transform:translateY(3px)}to{opacity:1;transform:translateY(0)}}@media(prefers-reduced-motion:reduce){.card-message-reveal{animation:none}}</style>
