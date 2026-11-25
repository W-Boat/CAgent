<script setup lang="ts">
import {computed,ref} from 'vue'

withDefaults(defineProps<{motion?:'idle'|'waiting'|'thinking'|'success'|'tap'|'miss';label?:string;lazy?:boolean}>(),{motion:'idle',label:''})
const failed=ref(false)
const image=computed(()=>failed.value?'/mascot/assistant-placeholder.png':`${(import.meta.env.VITE_API_BASE||'/api').replace(/\/$/,'')}/experience/mascot`)
</script>

<template><img class="mascot-image" :class="`mascot-${motion}`" :src="image" :alt="label" :loading="lazy?'lazy':undefined" draggable="false" @error="failed=true"/></template>

<style scoped>
.mascot-image{display:block;object-fit:contain;transform-origin:50% 86%}
.mascot-waiting{animation:mascot-wait 2.6s ease-in-out infinite}
.mascot-thinking{animation:mascot-think 2s ease-in-out infinite}
.mascot-success,.mascot-tap{animation:mascot-hop .38s both}
.mascot-miss{animation:mascot-miss .32s both}
@keyframes mascot-wait{45%{transform:translateY(-4px)}80%{transform:translateY(0)}}
@keyframes mascot-think{34%{transform:translateY(-3px) rotate(-5deg)}67%{transform:rotate(3deg)}}
@keyframes mascot-hop{20%{transform:scale(1.06,.94)}52%{transform:translateY(-7px) rotate(-4deg) scale(.98,1.03)}78%{transform:scale(1.03,.97)}}
@keyframes mascot-miss{27%{transform:rotate(-7deg)}64%{transform:rotate(5deg)}}
@media(prefers-reduced-motion:reduce){.mascot-image{animation:none}}
</style>
