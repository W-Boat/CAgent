<template>
  <div v-if="effect" class="campus-effect-card"><span>{{emoji}}</span><strong>{{label}}</strong><button type="button" @click="play">再看一次</button></div>
  <Teleport to="body"><div v-if="visible&&effect" class="campus-effect-overlay" :class="effect" role="status" :aria-label="label" @click="close"><button type="button" class="effect-close" aria-label="关闭彩蛋" @click.stop="close">×</button><span class="effect-orbit one"></span><span class="effect-orbit two"></span><span class="effect-orbit three"></span><div class="effect-content"><span class="effect-emoji" aria-hidden="true">{{emoji}}</span><p>{{label}}</p></div></div></Teleport>
</template>
<script setup lang="ts">
import {computed,onBeforeUnmount,ref,watch} from 'vue'
import {claimEffect} from './effect-playback'
const props=defineProps<{card:Record<string,unknown>;autoPlay?:boolean;effectKey?:string}>()
const effect=computed(()=>['tiger','melon','cat'].includes(String(props.card.effect))?String(props.card.effect):'')
const emoji=computed(()=>effect.value==='tiger'?'🐯':effect.value==='melon'?'🍉':'🐱'),label=computed(()=>effect.value==='tiger'?'大老虎来了':effect.value==='melon'?'小辛瓜冒个泡':'喵～')
const visible=ref(false);let played=false,timer:ReturnType<typeof setTimeout>|undefined
function close(){visible.value=false;if(timer)clearTimeout(timer);window.removeEventListener('keydown',onKey)}
function onKey(e:KeyboardEvent){if(e.key==='Escape')close()}
function play(){if(!effect.value)return;close();visible.value=true;window.addEventListener('keydown',onKey);timer=setTimeout(close,1100)}
watch(()=>props.autoPlay,on=>{if(on&&!played){played=true;if(!props.effectKey||claimEffect(props.effectKey+':'+String(props.card.ruleId||effect.value)))play()}},{immediate:true})
onBeforeUnmount(close)
</script>
<style scoped>
.campus-effect-card{display:flex;align-items:center;gap:12px;padding:15px 18px;border:1px solid #e3e9d7;border-radius:15px;background:#fafcf3;color:#4a6147}.campus-effect-card>span{font-size:28px}.campus-effect-card strong{font-size:14px;font-weight:500}.campus-effect-card button{margin-left:auto;font:inherit;font-size:11px;color:#71866a;border:0;background:transparent;cursor:pointer}.campus-effect-overlay{position:fixed;inset:0;z-index:10000;background:radial-gradient(circle at center,#f7f4df 0%,#dbe5cddf 100%);display:grid;place-items:center;overflow:hidden;backdrop-filter:blur(7px);animation:effect-in .18s ease-out;cursor:pointer}.campus-effect-overlay.tiger{background:radial-gradient(circle,#fff1d5,#e9d4b9ed)}.campus-effect-overlay.cat{background:radial-gradient(circle,#fff4ee,#ece0e1ed)}.effect-content{text-align:center;position:relative;z-index:1;animation:effect-bloom .6s cubic-bezier(.2,.8,.2,1)}.effect-emoji{font-size:clamp(120px,27vw,300px);line-height:1.2;display:block;filter:drop-shadow(0 18px 20px #657a3e22)}.effect-content p{font-family:inherit;color:#657b50;font-size:18px;letter-spacing:5px}.effect-close{position:absolute;top:24px;right:24px;border:1px solid #99a48255;border-radius:50%;width:40px;height:40px;color:#7a896d;background:#ffffff80;font-size:24px;cursor:pointer}.effect-orbit{position:absolute;inset:20%;border:1px solid #8ea37622;border-radius:50%}.effect-orbit.two{inset:12%}.effect-orbit.three{inset:4%}@keyframes effect-in{from{opacity:0}to{opacity:1}}@keyframes effect-bloom{from{transform:scale(.82);opacity:0}to{transform:scale(1);opacity:1}}@media(prefers-reduced-motion:reduce){.campus-effect-overlay,.effect-content{animation:none}}
</style>
