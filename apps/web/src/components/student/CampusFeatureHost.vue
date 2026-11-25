<script setup lang="ts">
import {computed,defineAsyncComponent,ref,watch} from 'vue'
import {useRoute,useRouter} from 'vue-router'
import {get} from '@/api/client'
import {campusFeatureLabels,campusPages,type CampusFeature} from '@/utils/campus-features'
import {useAuthStore} from '@/stores/auth'

defineProps<{narrow?:boolean;mobileMode?:'drawer'|'full'}>()
const emit=defineEmits<{ask:[text:string]}>()
const route=useRoute(),router=useRouter(),auth=useAuthStore()
const CampusGame=defineAsyncComponent(()=>import('./CampusGame.vue'))
const StudentCard=defineAsyncComponent(()=>import('./StudentCard.vue'))
const LecturePanel=defineAsyncComponent(()=>import('@/views/campus/LectureCalendarView.vue'))
const current=ref<CampusFeature>('game'),open=ref(false),busy=ref(false),card=ref<Record<string,unknown>>(),frame=ref(''),frameReady=ref(false)
const title=computed(()=>campusFeatureLabels[current.value])
const width=ref(520),resizing=ref(false)
const widthKey=computed(()=>`cagent.campus-panel-width.${auth.user?.id||'guest'}`)
watch(widthKey,()=>{try{width.value=Math.max(360,Math.min(1100,Number(localStorage.getItem(widthKey.value))||520))}catch{width.value=520}},{immediate:true})
function setWidth(value:number){width.value=Math.max(360,Math.min(Math.max(360,Math.min(1100,window.innerWidth-100)),value))}
function saveWidth(){try{localStorage.setItem(widthKey.value,String(width.value))}catch{}}
let drag:{id:number;left:number;width:number}|undefined
function start(event:PointerEvent){if(event.button!==0)return;drag={id:event.pointerId,left:event.clientX,width:width.value};resizing.value=true;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)}
function move(event:PointerEvent){if(drag?.id===event.pointerId)setWidth(drag.width+drag.left-event.clientX)}
function end(event:PointerEvent){if(drag?.id!==event.pointerId)return;drag=undefined;resizing.value=false;saveWidth()}
function keyResize(event:KeyboardEvent){if(!['ArrowLeft','ArrowRight','Home'].includes(event.key))return;event.preventDefault();setWidth(event.key==='Home'?520:width.value+(event.key==='ArrowLeft'?32:-32));saveWidth()}
let attempt=0

async function show(feature:CampusFeature,data?:Record<string,unknown>){
  const request=++attempt
  current.value=feature;card.value=undefined;busy.value=false;frame.value='';frameReady.value=false;open.value=true
  if(Object.prototype.hasOwnProperty.call(campusPages,feature)){
    const path=campusPages[feature as keyof typeof campusPages]
    const query:Record<string,string>={embed:'1'}
    if(feature==='map'&&Array.isArray(data?.matches)&&data.matches.length===1){
      const [match]=data.matches
      if(typeof match?.campus==='string')query.campus=match.campus
      if(Array.isArray(match?.placeIds)&&typeof match.placeIds[0]==='string')query.place=match.placeIds[0]
    }
    if(feature==='map'&&!query.campus&&typeof data?.campus==='string')query.campus=data.campus
    frame.value=router.resolve({path,query}).href
    return
  }
  if(feature==='game'||feature==='lecture')return
  if(data?.type===feature){card.value=data;return}
  busy.value=true
  try{const result=await get<Record<string,unknown>>('/campus/student-feature/'+feature);if(request===attempt)card.value=result}
  catch{}finally{if(request===attempt)busy.value=false}
}
watch(()=>route.name,()=>{open.value=false})
function ask(value:string){open.value=false;emit('ask',value)}
defineExpose({show})
</script>

<template>
  <el-drawer v-model="open" :title="title" :direction="narrow?'btt':'rtl'" :size="narrow?(mobileMode==='full'?'100dvh':'63dvh'):`min(${width}px, calc(100vw - 76px))`" destroy-on-close class="campus-function-drawer" :class="{'campus-has-frame':frame,'campus-resizing':resizing}">
    <div v-if="!narrow" class="campus-panel-resize" role="separator" aria-label="调整校园功能窗口宽度" aria-orientation="vertical" :aria-valuenow="width" aria-valuemin="360" aria-valuemax="1100" tabindex="0" @pointerdown="start" @pointermove="move" @pointerup="end" @pointercancel="end" @lostpointercapture="end" @keydown="keyResize"/>
    <div class="nx-root campus-panel-content">
      <template v-if="frame">
        <el-skeleton v-if="!frameReady" class="campus-frame-loading" :rows="5" animated/>
        <iframe :key="frame" :src="frame" :title="title" :class="{'is-ready':frameReady}" @load="frameReady=true"/>
      </template>
      <CampusGame v-else-if="current==='game'"/>
      <LecturePanel v-else-if="current==='lecture'" student-mode/>
      <el-skeleton v-else-if="busy" :rows="4" animated/>
      <StudentCard v-else-if="card" :card="card" @ask="ask"/>
      <el-empty v-else description="该校园服务暂未开放"/>
    </div>
  </el-drawer>
</template>

<style>
.campus-function-drawer .el-drawer__header{margin-bottom:0;padding-block:12px;border-bottom:1px solid var(--el-border-color-lighter)}.campus-function-drawer .el-drawer__body{position:relative}.campus-has-frame .el-drawer__body{padding:0;overflow:hidden}.campus-has-frame .campus-panel-content,.campus-has-frame iframe{height:100%;width:100%;border:0;display:block}.campus-panel-resize{position:absolute;left:0;inset-block:0;width:10px;z-index:2;cursor:ew-resize;touch-action:none}.campus-panel-resize::after{content:'';position:absolute;top:46%;left:3px;width:3px;height:34px;border-radius:999px;background:var(--el-border-color)}.campus-panel-resize:is(:hover,:focus-visible)::after{background:var(--el-color-primary)}.campus-resizing iframe{pointer-events:none}
.campus-has-frame iframe{opacity:0;transition:opacity .18s ease}.campus-has-frame iframe.is-ready{opacity:1}.campus-frame-loading{box-sizing:border-box;position:absolute;inset:0;padding:18px;width:100%;pointer-events:none}@media(prefers-reduced-motion:reduce){.campus-has-frame iframe{transition:none}}
</style>
