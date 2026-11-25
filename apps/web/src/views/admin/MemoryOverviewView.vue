<template>
  <div class="page"><div class="page-header"><div><h2 class="page-title">全站记忆</h2><p class="page-subtitle">{{data?.total??0}} 条生效记忆 · 每位用户展示最近两条摘要</p></div><el-button :loading="busy" @click="load">刷新</el-button></div>
  <el-alert v-if="failure" type="error" :title="failure" :closable="false"/>
  <el-table v-loading="busy" :data="data?.users??[]" row-key="id" empty-text="暂无生效记忆"><el-table-column prop="name" label="用户" min-width="120"/><el-table-column prop="count" label="记忆数量" width="100"/><el-table-column label="最近更新" min-width="240"><template #default="{row}"><div v-for="(item,i) in row.summaries" :key="i" class="summary-line"><el-tag size="small" effect="plain">{{item.category}}</el-tag> {{item.text}}</div></template></el-table-column></el-table>
  <div class="memory-pager"><el-button :disabled="busy||page<=1" @click="page--;load()">上一页</el-button><span>第 {{page}} 页</span><el-button :disabled="busy||!data?.hasNext" @click="page++;load()">下一页</el-button></div></div>
</template>
<script setup lang="ts">
import {onMounted,ref} from 'vue'
import {get,errorMessage} from '@/api/client'
type Overview={total:number;hasNext:boolean;users:{id:string;name:string;count:number;summaries:{category:string;text:string}[]}[]}
const data=ref<Overview>(),page=ref(1),busy=ref(false),failure=ref('')
async function load(){busy.value=true;failure.value='';try{data.value=await get<Overview>('/memory/admin/overview',{page:page.value})}catch(e){failure.value=errorMessage(e)}finally{busy.value=false}}
onMounted(load)
</script>
<style scoped>.summary-line{line-height:1.75;margin:4px 0;overflow-wrap:anywhere}.memory-pager{display:flex;align-items:center;justify-content:flex-end;gap:10px;margin-top:16px}</style>
