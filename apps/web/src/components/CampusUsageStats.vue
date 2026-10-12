<template>
 <section class="usage-stats">
  <h3>知识库与前端使用</h3>
  <p class="usage-note">{{data?.startedAt?'新统计自 '+formatDateTime(data.startedAt)+' 开始记录':'新统计上线后开始记录'}}。查询由后端记录；跳转为实际点击量，不代表外部网站访问成功。匿名访客不计入登录用户数。</p>
  <el-row :gutter="14"><el-col v-for="tile in tiles" :key="tile.label" :xs="12" :sm="8" :lg="4"><StatTile :label="tile.label" :value="tile.value" :hint="tile.hint" icon="Compass"/></el-col></el-row>
  <ChartPanel title="知识使用与跳转趋势（北京时间）" :option="trend" :height="300" :is-empty="!data?.trend.some(r=>r.QUERY+r.CONTENT_VIEW+r.LINK_CLICK+r.MAP_VIEW+(r.RENDER_ERROR||0)+(r.RENDER_RECOVERED||0))"/>
  <div class="usage-tables">
   <div class="table-card"><h4>前端来源</h4><el-table :data="origins" v-loading="loading"><el-table-column prop="name" label="界面" min-width="120"/><el-table-column prop="QUERY" label="调用" width="80"/><el-table-column prop="CONTENT_VIEW" label="阅读" width="80"/><el-table-column prop="LINK_CLICK" label="跳转" width="80"/><el-table-column prop="MAP_VIEW" label="地图" width="80"/></el-table></div>
   <div class="table-card"><h4>参与回答的知识分类</h4><el-table :data="data?.byCollection||[]"><el-table-column prop="collection" label="知识分类" min-width="180"/><el-table-column prop="matches" label="上下文来源次数" width="145"/><el-table-column prop="used" label="回答引用次数" width="130"/></el-table></div>
  </div>
  <div class="table-card"><h4>资料与卡片使用排行</h4><el-table :data="data?.topItems||[]"><el-table-column prop="title" label="资料" min-width="260"/><el-table-column prop="collection" label="知识分类" min-width="140"/><el-table-column prop="views" label="阅读" width="95"/><el-table-column prop="clicks" label="链接跳转" width="115"/><el-table-column prop="maps" label="地图查看" width="115"/></el-table></div>
 </section>
</template>
<script setup lang="ts">
import {computed,ref,watch} from 'vue'
import {campusApi} from '@/api'
import {toastError} from '@/api/client'
import {formatDateTime} from '@/utils/format'
import {eventLabels,originLabels} from '@/utils/campus-labels'
import type {CampusActivityStats} from '@/api/types'
import type {EChartsOption} from '@/utils/echarts'
import ChartPanel from './ChartPanel.vue'
import StatTile from './StatTile.vue'
const props=defineProps<{days:number;refreshKey?:number}>(),data=ref<CampusActivityStats|null>(null),loading=ref(false)
const tiles=computed(()=>[{label:'知识库调用',value:data.value?.queries||0,hint:'聊天与导览检索请求'},{label:'资料阅读',value:data.value?.contentViews||0,hint:'成功加载知识正文'},{label:'链接卡片跳转',value:data.value?.linkClicks||0,hint:'入口 / 来源链接点击'},{label:'地图展示与查看',value:data.value?.mapViews||0,hint:'展示、切换与地点选择'},{label:'卡片渲染失败',value:data.value?.renderErrors||0,hint:'独立诊断，不计知识调用'},{label:'卡片重渲成功',value:data.value?.renderRecovered||0,hint:'自动或手动恢复显示'},{label:'登录使用人数',value:data.value?.users||0,hint:'期间去重，不含匿名访客'}])
const origins=computed(()=>Object.entries(originLabels).map(([key,name])=>({name,...Object.fromEntries(Object.keys(eventLabels).map(type=>[type,data.value?.byOrigin.find(r=>r.origin===key&&r.eventType===type)?.count||0]))})))
const trend=computed<EChartsOption>(()=>({tooltip:{trigger:'axis'},legend:{top:0},grid:{left:42,right:20,top:45,bottom:30},xAxis:{type:'category',data:data.value?.trend.map(r=>r.date.slice(5))||[]},yAxis:{type:'value',minInterval:1},series:Object.entries(eventLabels).map(([key,name])=>({name,type:'line',data:data.value?.trend.map(r=>r[key as 'QUERY'])||[],smooth:true,symbolSize:5}))}))
let generation=0
watch(()=>[props.days,props.refreshKey],async()=>{const id=++generation;loading.value=true;try{const result=await campusApi.activityStats(props.days);if(id===generation)data.value=result}catch(e){toastError(e,'知识使用统计加载失败')}finally{if(id===generation)loading.value=false}},{immediate:true})
</script>
<style scoped>.usage-stats{margin-bottom:28px}.usage-note{font-size:12px;line-height:1.8;color:var(--el-text-color-secondary)}h3{font-size:17px;margin:0 0 10px}h4{font-size:14px;font-weight:600;margin:0 0 14px}.usage-stats .el-col{margin-bottom:14px}.usage-tables{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:14px 0}.table-card{padding:18px;min-width:0}@media(max-width:1100px){.usage-tables{grid-template-columns:1fr}}</style>
