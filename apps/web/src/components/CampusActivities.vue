<template>
 <section class="campus-activities">
  <div class="filter-bar"><el-input v-model="filters.keyword" placeholder="查询词、资料名、链接" clearable @keyup.enter="search"/><el-select v-model="filters.eventType" clearable placeholder="全部行为" @change="search"><el-option v-for="(name,key) in eventLabels" :key="key" :label="name" :value="key"/></el-select><el-select v-model="filters.origin" clearable placeholder="全部来源" @change="search"><el-option v-for="(name,key) in originLabels" :key="key" :label="name" :value="key"/></el-select><el-button @click="search" :loading="loading">查询</el-button><span>共 {{total}} 条</span></div>
  <el-table :data="rows" v-loading="loading"><el-table-column label="行为" width="125"><template #default="{row}">{{eventLabels[row.eventType]||row.eventType}}</template></el-table-column><el-table-column label="来源" width="130"><template #default="{row}">{{originLabels[row.origin]||row.origin}}</template></el-table-column><el-table-column label="查询 / 资料" min-width="240"><template #default="{row}"><strong>{{row.query||row.title||'校园地图'}}</strong><p class="sub">{{row.collection}}<span v-if="row.eventType==='QUERY'"> · {{row.resultCount}} 条上下文来源</span></p><a v-if="row.url" :href="row.url" target="_blank" rel="noopener noreferrer">{{row.url}}</a></template></el-table-column><el-table-column label="用户" width="170"><template #default="{row}">{{row.user?.name||'匿名访客'}}<p class="sub">{{row.user?.email||''}}</p></template></el-table-column><el-table-column label="时间" width="185"><template #default="{row}">{{formatDateTime(row.createdAt)}}</template></el-table-column><el-table-column label="详情" width="90"><template #default="{row}"><el-button link type="primary" @click="selected=row">查看</el-button></template></el-table-column></el-table>
  <el-pagination v-model:current-page="page" :page-size="20" :total="total" layout="total,prev,pager,next" @current-change="load"/>
  <el-dialog :model-value="!!selected" title="知识使用详情" width="min(850px,94vw)" @close="selected=null"><template v-if="selected"><p>{{eventLabels[selected.eventType]}} · {{originLabels[selected.origin]}}</p><p>{{selected.query||selected.title}}</p><p v-if="selected.eventType==='LINK_CLICK'">此记录表示点击跳转，不代表外部网站访问成功。</p><dl v-if="selected.eventType.startsWith('RENDER_')"><template v-for="(r,i) in selected.references||[]" :key="i"><dt>组件</dt><dd>{{r.component}}</dd><dt>错误类型</dt><dd>{{errorLabels[r.errorType||'']||r.errorType}}</dd><dt>重渲方式 / 次数</dt><dd>{{retryLabels[r.retryMode||'']||r.retryMode}} / {{r.attempt}}</dd><dt>回答标识</dt><dd>{{r.messageId||'预览组件'}}</dd></template></dl><ul v-else-if="selected.references?.length"><li v-for="r in selected.references" :key="r.id">{{r.title}} · {{r.collection}} · {{r.used?'回答已引用':'检索参考'}}</li></ul><p v-else>本次行为没有检索来源。</p></template></el-dialog>
 </section>
</template>
<script setup lang="ts">
import {onMounted,reactive,ref} from 'vue'
import {campusApi} from '@/api'
import {toastError} from '@/api/client'
import {formatDateTime} from '@/utils/format'
import {eventLabels,originLabels} from '@/utils/campus-labels'
import type {CampusActivity} from '@/api/types'
const errorLabels:Record<string,string>={syntax:'JSON 未完整',schema:'结构校验失败',component:'组件运行错误',module:'组件加载失败'},retryLabels:Record<string,string>={initial:'首次失败',automatic:'首次自动重渲',manual:'用户手动重渲'}
const rows=ref<CampusActivity[]>([]),total=ref(0),page=ref(1),loading=ref(false),selected=ref<CampusActivity|null>(null),filters=reactive({keyword:'',eventType:'',origin:''})
async function load(){loading.value=true;try{const data=await campusApi.activities({...filters,page:page.value,pageSize:20});rows.value=data.items;total.value=data.total}catch(e){toastError(e,'使用记录加载失败')}finally{loading.value=false}}
function search(){page.value=1;void load()}
defineExpose({load})
onMounted(load)
</script>
<style scoped>.filter-bar{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0}.filter-bar .el-input{width:260px}.filter-bar .el-select{width:150px}.filter-bar>span{font-size:12px;align-self:center;color:var(--el-text-color-secondary)}.sub{font-size:11px;margin:4px 0;color:var(--el-text-color-secondary)}a{color:var(--el-color-primary);font-size:11px;overflow-wrap:anywhere}.el-pagination{margin-top:16px}li{line-height:1.9}</style>
