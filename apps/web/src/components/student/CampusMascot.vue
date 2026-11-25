<template>
  <aside class="campus-pet" :class="{'is-busy':busy,'is-reacting':reacting}">
    <Transition name="pet-bubble"><output v-if="message" class="campus-pet-bubble" role="status">{{message}}</output></Transition>
    <button type="button" class="campus-pet-button" :aria-label="`${name}，点按互动，双击或长按隐藏`" :title="`${name} · 双击隐藏`" @click="greet" @dblclick="$emit('hide')" @pointerdown="startHold" @pointerup="cancelHold" @pointerleave="cancelHold" @pointercancel="cancelHold" @keydown.delete.prevent="$emit('hide')">
      <MascotImage :motion="busy ? phase==='tools'?'waiting':'thinking' : reacting?'tap':'idle'"/>
    </button>
  </aside>
</template>
<script setup lang="ts">
import {computed,onBeforeUnmount,ref,watch} from 'vue'
import {useAuthStore} from '@/stores/auth'
import MascotImage from '@/components/experience/MascotImage.vue'
const props=defineProps<{busy:boolean;phase?:string}>(),emit=defineEmits<{hide:[]}>(),auth=useAuthStore()
const reaction=ref(''),reacting=ref(false)
const name=computed(()=>auth.settings?.mascot_name||'辛瓜小助')
const message=computed(()=>props.busy?(props.phase==='tools'?'正在查资料。':props.phase==='finalizing'?'回答快整理好了。':'我陪你等一会儿。'):reaction.value)
const greetings=['在呢，随时可以问我。','碰个瓜！','课间记得歇一下。']
let index=0,hold:ReturnType<typeof setTimeout>|undefined,timer:ReturnType<typeof setTimeout>|undefined,held=false
function greet(){if(held||props.busy)return;reaction.value=greetings[index++%greetings.length];reacting.value=true;clearTimeout(timer);timer=setTimeout(()=>{reaction.value='';reacting.value=false},2600)}
function startHold(){held=false;hold=setTimeout(()=>{held=true;emit('hide')},650)}
function cancelHold(){clearTimeout(hold)}
watch(()=>props.busy,value=>{if(value)reaction.value=''})
onBeforeUnmount(()=>{cancelHold();clearTimeout(timer)})
</script>
<style scoped>
.campus-pet{position:absolute;z-index:4;right:clamp(11px,2vw,32px);bottom:12px;width:78px;display:grid;justify-items:center;pointer-events:none}.campus-pet-button{pointer-events:auto;width:100%;aspect-ratio:1;border:0;background:transparent;padding:0;cursor:pointer;touch-action:manipulation;-webkit-touch-callout:none}.campus-pet-button img{width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 3px 5px #0002)}.campus-pet-bubble{position:absolute;right:3px;bottom:100%;width:max-content;max-width:155px;border:1px solid var(--nx-border);border-radius:12px 12px 3px 12px;background:var(--nx-surface);color:var(--nx-text);box-shadow:0 4px 15px #0001;padding:7px 10px;font-size:12px}@media(max-width:650px){.campus-pet{width:56px;bottom:9px}}.pet-bubble-enter-active,.pet-bubble-leave-active{transition:opacity .16s ease,transform .22s cubic-bezier(.2,.7,.3,1)}.pet-bubble-enter-from,.pet-bubble-leave-to{opacity:0;transform:translateY(4px) scale(.98)}@media(prefers-reduced-motion:reduce){.pet-bubble-enter-active,.pet-bubble-leave-active{transition:none}}
</style>
