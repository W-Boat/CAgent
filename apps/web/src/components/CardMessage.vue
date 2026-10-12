<template>
  <template v-for="(seg,i) in segments" :key="i">
    <MarkdownView v-if="seg.kind==='markdown'" :content="seg.text" :streaming="streaming"/>
    <CardRenderBoundary v-else-if="seg.kind==='card'" v-slot="{ready}" class="card-message-reveal" :identity="seg.card" :disabled="disabled || streaming" :report-key="(effectKey || instanceKey)+':'+i">
      <AgentUiRenderer v-if="isUiDocument(seg.card)" :document="seg.card" :disabled="disabled || streaming" :source-ids="sourceIds" :state-key="effectKey" :report-key="(effectKey || instanceKey)+':'+i" @rendered="ready" @ask="$emit('ask',$event)"/>
      <StudentCard v-else :card="displayCard(seg.card)" :disabled="disabled || streaming" :auto-play="autoPlay ?? liveEffect" :effect-key="effectKey || instanceKey" @vue:mounted="ready" @ask="$emit('ask',$event)" @switch-agent="$emit('switch-agent',$event)" @use-skill="$emit('use-skill',$event)"/>
    </CardRenderBoundary>
    <CardParseFailure v-else-if="seg.kind==='broken'" :disabled="disabled || streaming" :report-key="(effectKey || instanceKey)+':'+i" @retry="renderAttempt++"/>
    <AnswerPending v-else/>
  </template>
</template>
<script setup lang="ts">
import {computed,getCurrentInstance,ref,watch,defineAsyncComponent} from 'vue'
import MarkdownView from './MarkdownView.vue'
import AnswerPending from './presentation/AnswerPending.vue'
import CardRenderBoundary from './presentation/CardRenderBoundary.vue'
import CardParseFailure from './presentation/CardParseFailure.vue'
import StudentCard from './student/StudentCard.vue'
import {formatAnswerPresentation} from '@/utils/answer-presentation'
import {answerSegments} from '@/utils/answer-layout'
import {cardDisplayData} from '@/utils/card-display'
import {isUiDocument} from '@/utils/agent-ui'
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
const AgentUiRenderer=defineAsyncComponent({loader:loadRenderer,onError:(_error,_retry,fail)=>fail()})
const props=defineProps<{content?:string|null;streaming?:boolean;disabled?:boolean;autoPlay?:boolean;effectKey?:string;hasKnowledgeSources?:boolean;knowledgeSources?:{id:string;citationId?:string}[]}>()
const sourceIds=computed(()=>new Set((props.knowledgeSources||[]).flatMap(s=>[s.id,...(s.citationId?[s.citationId]:[])])))
const displayCard=(card:Record<string,unknown>)=>cardDisplayData(card,sourceIds.value)
const renderAttempt=ref(0)
const segments=computed(()=>{void renderAttempt.value;return answerSegments(props.streaming?props.content||'':formatAnswerPresentation(props.content||'','adaptive',sourceIds.value),{streaming:!!props.streaming,hasKnowledgeSources:props.hasKnowledgeSources})})
const liveEffect=ref(false),instanceKey='answer-'+getCurrentInstance()!.uid
watch(()=>props.streaming,value=>{if(value)liveEffect.value=true},{immediate:true})
defineEmits<{(e:'ask',text:string):void;(e:'switch-agent',id:string):void;(e:'use-skill',key:string):void}>()
</script>
<style scoped>.card-message-reveal{animation:card-reveal .22s cubic-bezier(.2,.7,.2,1) both}@keyframes card-reveal{from{opacity:.35;transform:translateY(3px)}to{opacity:1;transform:translateY(0)}}@media(prefers-reduced-motion:reduce){.card-message-reveal{animation:none}}</style>
