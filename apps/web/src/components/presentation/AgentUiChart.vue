<template>
  <figure class="aui-chart"><figcaption>{{ node.title }}<span v-if="node.unit"> · {{ node.unit }}</span></figcaption>
    <svg viewBox="0 0 600 270" role="img" :aria-label="node.title+'；完整数值见下方数据表'">
      <g v-for="tick in ticks" :key="tick.value"><line x1="54" x2="578" :y1="tick.y" :y2="tick.y" class="aui-chart-grid"/><text x="46" :y="tick.y+4" text-anchor="end" class="aui-chart-label">{{ tick.value }}</text></g>
      <line x1="54" x2="578" :y1="y(0)" :y2="y(0)" class="aui-chart-zero"/>
      <template v-for="(series,si) in node.series" :key="si"><polyline v-if="node.chartType==='line'" :points="series.values.map((v,i)=>x(i)+','+y(v)).join(' ')" fill="none" class="aui-series" :class="'aui-series-'+si" stroke-width="3"/>
        <template v-for="(value,i) in series.values" :key="i"><rect v-if="node.chartType==='bar'" :x="54+i*step+step*.15+si*barWidth" :y="Math.min(y(0),y(value))" :width="Math.max(2,barWidth-2)" :height="Math.max(1,Math.abs(y(value)-y(0)))" rx="2" class="aui-series" :class="'aui-series-'+si"><title>{{ node.labels[i] }} · {{ series.name }}：{{ value }} {{ node.unit }}</title></rect><circle v-else :cx="x(i)" :cy="y(value)" r="4" class="aui-series" :class="'aui-series-'+si"><title>{{ node.labels[i] }} · {{ series.name }}：{{ value }} {{ node.unit }}</title></circle></template>
      </template>
      <text v-for="i in labelIndices" :key="i" :x="x(i)" y="256" text-anchor="middle" class="aui-chart-label">{{ label(node.labels[i]) }}</text>
    </svg>
    <div class="aui-chart-legend"><span v-for="(series,i) in node.series" :key="i"><i :class="'aui-series-'+i"></i>{{ series.name }}</span></div>
    <details><summary>查看完整数据</summary><div class="aui-chart-data" tabindex="0"><table><caption class="aui-chart-caption">{{ node.title }}{{ node.unit?'（'+node.unit+'）':'' }}</caption><thead><tr><th scope="col">项目</th><th v-for="(series,i) in node.series" :key="i" scope="col">{{ series.name }}</th></tr></thead><tbody><tr v-for="(name,i) in node.labels" :key="i"><th scope="row">{{ name }}</th><td v-for="(series,j) in node.series" :key="j">{{ series.values[i] }}</td></tr></tbody></table></div></details>
  </figure>
</template>
<script setup lang="ts">
import {computed} from 'vue'
import type {UiChart} from '@/utils/agent-ui'
const props=defineProps<{node:UiChart}>(),step=computed(()=>524/props.node.labels.length),barWidth=computed(()=>step.value*.7/props.node.series.length)
const range=computed(()=>{const values=props.node.series.flatMap(s=>s.values),scale=Math.max(...values.map(Math.abs))||1,normalized=values.map(v=>v/scale),low=Math.min(0,...normalized),high=Math.max(0,...normalized);return {scale,low,high:high===low?low+1:high}})
function y(value:number){const {low,high,scale}=range.value;return 230-(value/scale-low)/(high-low)*200}
function x(i:number){return 54+(i+.5)*step.value}
const ticks=computed(()=>Array.from({length:5},(_,i)=>{const {low,high,scale}=range.value,v=(low+(high-low)*i/4)*scale;return {value:Number(v.toPrecision(4)),y:y(v)}}))
const labelIndices=computed(()=>{const n=props.node.labels.length;return n<=4?props.node.labels.map((_,i)=>i):Array.from({length:4},(_,i)=>Math.round((n-1)*i/3))})
function label(value:string){return value.length>5?value.slice(0,4)+'…':value}
</script>
<style scoped>
.aui-chart{border:1px solid var(--aui-line);border-radius:18px;background:var(--aui-bg);padding:16px;margin:0}figcaption{font-weight:650}figcaption span{font-weight:400;color:var(--aui-muted);font-size:12px}svg{display:block;width:100%;height:auto;margin:10px 0}.aui-chart-grid{stroke:var(--aui-line)}.aui-chart-zero{stroke:var(--aui-muted);opacity:.4}.aui-chart-label{fill:var(--aui-muted);font-size:11px}.aui-series{fill:var(--aui-accent);stroke:var(--aui-accent)}polyline.aui-series{fill:none}.aui-series-1{fill:var(--aui-text);stroke:var(--aui-text);opacity:.65}.aui-series-2{fill:var(--aui-accent);stroke:var(--aui-accent);opacity:.38}.aui-chart-legend{display:flex;flex-wrap:wrap;gap:16px;font-size:12px;color:var(--aui-muted)}.aui-chart-legend span{display:flex;gap:6px;align-items:center}.aui-chart-legend i{width:10px;height:10px;border-radius:3px;background:var(--aui-accent)}.aui-chart-legend .aui-series-1{background:var(--aui-text)}details{margin-top:14px;font-size:12px}summary{cursor:pointer;color:var(--aui-accent)}.aui-chart-data{overflow-x:auto;margin-top:8px}table{border-collapse:collapse;width:100%}th,td{padding:6px 10px;text-align:left;border-bottom:1px solid var(--aui-line)}.aui-chart-caption{text-align:left;color:var(--aui-muted);padding:6px 10px}
</style>
<style scoped>@media(max-width:600px){.aui-chart-label{font-size:18px}}</style>
