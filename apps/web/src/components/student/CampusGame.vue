<script setup lang="ts">
import {onBeforeUnmount,ref} from 'vue'
import MascotImage from '@/components/experience/MascotImage.vue'

const remaining=ref(20),score=ref(0),target=ref(-1),playing=ref(false),played=ref(false),best=ref(0)
let end=0,tick:ReturnType<typeof setInterval>|undefined,move:ReturnType<typeof setTimeout>|undefined
try{best.value=Number(localStorage.getItem('cagent.campus-game.best'))||0}catch{}

function next(){
  const previous=target.value
  target.value=previous<0?Math.floor(Math.random()*9):(previous+1+Math.floor(Math.random()*8))%9
  clearTimeout(move);move=setTimeout(next,1150)
}
function stop(){
  clearInterval(tick);clearTimeout(move);target.value=-1;playing.value=false
  if(score.value>best.value){best.value=score.value;try{localStorage.setItem('cagent.campus-game.best',String(best.value))}catch{}}
}
function start(){
  score.value=0;remaining.value=20;played.value=true;playing.value=true;end=Date.now()+20_000
  next();tick=setInterval(()=>{remaining.value=Math.max(0,Math.ceil((end-Date.now())/1000));if(!remaining.value)stop()},160)
}
function catchMelon(cell:number){if(!playing.value||cell!==target.value)return;score.value++;next()}
function keyCatch(event:KeyboardEvent){const row=Number(event.key);if(row>=1&&row<=9){event.preventDefault();catchMelon(row-1)}}
onBeforeUnmount(()=>{clearInterval(tick);clearTimeout(move)})
</script>

<template>
  <section class="melon-game" @keydown="keyCatch">
    <p class="game-rules">20 秒内尽量多点到校园助手。也可以按数字 1–9。</p>
    <div class="game-score"><span>剩余 <strong>{{remaining}} 秒</strong></span><span>得分 <strong>{{score}}</strong></span><span>最高 <strong>{{best}}</strong></span></div>
    <div class="game-board">
      <button v-for="cell in 9" :key="cell" type="button" :aria-label="`第 ${cell} 格${target===cell-1?'，校园助手':''}`" :aria-disabled="!playing" @click="catchMelon(cell-1)">
        <span>{{cell}}</span><MascotImage v-if="target===cell-1" motion="tap"/>
      </button>
    </div>
    <div class="game-actions"><el-button type="primary" v-if="!playing" @click="start">{{played?'再玩一次':'开始游戏'}}</el-button><el-button v-else @click="stop">结束本轮</el-button><span v-if="played&&!playing" role="status">本轮 {{score}} 分</span></div>
  </section>
</template>

<style scoped>
.melon-game{color:var(--nx-text)}.game-rules{margin:0 0 12px;color:var(--nx-text-2);font-size:13px}.game-score{display:flex;gap:18px;justify-content:space-between;padding:8px 0 12px;font-size:13px}.game-score strong{font-variant-numeric:tabular-nums}.game-board{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.game-board button{position:relative;display:grid;place-items:center;min-height:68px;border:1px solid var(--nx-border);background:var(--nx-surface-2);color:var(--nx-text-2);border-radius:11px;transition:background .16s ease,transform .12s ease;aspect-ratio:1.4;cursor:pointer}.game-board button[aria-disabled=true]{cursor:default}.game-board button:active{transform:scale(.97)}.game-board button:has(img){background:var(--nx-accent-soft);border-color:var(--nx-accent-border)}.game-board button span{position:absolute;left:7px;top:5px;font-size:10px}.game-board img{width:clamp(42px,12vw,64px);height:clamp(42px,12vw,64px)}.game-actions{display:flex;align-items:center;gap:10px;margin-top:14px;font-size:13px}@media(prefers-reduced-motion:reduce){.game-board button{transition:none}}
</style>
