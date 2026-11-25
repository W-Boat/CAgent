<script setup lang="ts">
import {computed,ref,watch} from 'vue'
import {useRoute} from 'vue-router'
import {Search,Phone} from '@element-plus/icons-vue'
import {errorMessage,get} from '@/api/client'
import StudentTopbar from '@/components/student/StudentTopbar.vue'
import PageLoading from '@/components/PageLoading.vue'

type Entry={id:string;title:string;content:string;url:string;source:string;aliases?:string[];date?:string|null;phones?:string[];group?:string}
type Directory={sourceUrl:string;items:Entry[]}
const route=useRoute(),kind=computed(()=>route.name==='student-phones'?'directory':'academic-calendar')
const calendar=computed(()=>kind.value==='academic-calendar'),heading=computed(()=>calendar.value?'学年校历':'部门电话')
const query=ref(''),group=ref(''),content=ref<Directory>(),loading=ref(false),failure=ref('')
const groups=computed(()=>[...new Set((content.value?.items||[]).flatMap(row=>row.group?[row.group]:[]))])
const rows=computed(()=>{
  const term=query.value.trim().toLowerCase()
  return (content.value?.items||[]).filter(row=>(!group.value||row.group===group.value)&&[row.title,row.content,row.source,...(row.aliases||[])].join(' ').toLowerCase().includes(term))
})
const dated=computed(()=>rows.value.filter(row=>row.date).sort((a,b)=>String(b.date).localeCompare(String(a.date))))
const archives=computed(()=>rows.value.filter(row=>!row.date).sort((a,b)=>b.title.localeCompare(a.title,'zh-CN')))
let current=0
async function load(){
  const id=++current;loading.value=true;failure.value=''
  try{const value=await get<Directory>('/experience/portal/'+kind.value);if(id===current)content.value=value}
  catch(cause){if(id===current)failure.value=errorMessage(cause)}finally{if(id===current)loading.value=false}
}
watch(kind,()=>{query.value='';group.value='';content.value=undefined;void load()},{immediate:true})
</script>

<template>
  <div class="nx-root directory-page">
    <StudentTopbar v-if="route.query.embed!=='1'" :title="heading"/>
    <main class="directory-content">
      <header class="directory-head"><div><h1>{{heading}}</h1><p>{{calendar?'查阅公开教学日期与历年校历。完整安排可查看学校发布的校历。':'搜索学校公开办公座机，点击号码可拨打。'}}</p></div>
        <a v-if="content" class="nx-btn nx-btn-secondary" :href="content.sourceUrl" target="_blank" rel="noopener noreferrer">{{calendar?'查看官方校历':'学校组织机构'}} ↗</a>
      </header>
      <div class="directory-filter"><el-input v-model="query" :prefix-icon="Search" clearable :aria-label="calendar?'搜索学年校历':'搜索部门电话'" :placeholder="calendar?'搜索学年、日期或教学安排':'搜索部门、办事事项或电话号码'"/>
        <el-select v-if="!calendar" v-model="group" aria-label="筛选部门"><el-option label="全部部门" value=""/><el-option v-for="label in groups" :key="label" :value="label"/></el-select>
      </div>
      <el-alert v-if="failure" :title="failure" type="error" :closable="false"><el-button text @click="load">重新读取</el-button></el-alert>
      <PageLoading v-else-if="loading" :rows="5" :label="'正在读取'+heading"/>
      <el-empty v-else-if="!rows.length" :description="query||group?'没有找到匹配条目':'此知识库暂无已发布条目'"/>
      <div v-else-if="calendar" class="calendar-results">
        <section v-if="dated.length"><h2>公开教学日期</h2><article v-for="entry in dated" :key="entry.id" class="directory-row"><time :datetime="entry.date||undefined">{{entry.date}}</time><div><h3>{{entry.title}}</h3><p>{{entry.content.replace(/^日期：[^\n]*\s*/,'')}}</p></div><a v-if="entry.url" :href="entry.url" target="_blank" rel="noopener noreferrer">原文 ↗</a></article></section>
        <section v-if="archives.length"><h2>历年校历档案</h2><article v-for="entry in archives" :key="entry.id" class="directory-row"><div><h3>{{entry.title}}</h3><p>{{entry.source}}</p></div><a v-if="entry.url" :href="entry.url" target="_blank" rel="noopener noreferrer">原文 ↗</a></article></section>
      </div>
      <div v-else class="phone-results"><article v-for="entry in rows" :key="entry.id" class="directory-row"><div><h3>{{entry.title}}</h3><div class="phone-links"><a v-for="phone in entry.phones" :key="phone" :href="'tel:'+phone"><el-icon><Phone/></el-icon>{{phone}}</a></div><p v-if="!entry.phones?.length">{{entry.content}}</p></div><a v-if="entry.url" :href="entry.url" target="_blank" rel="noopener noreferrer">官方来源 ↗</a></article></div>
    </main>
  </div>
</template>

<style scoped>
.directory-page{min-height:100dvh;background:var(--nx-bg);color:var(--nx-text)}.directory-content{box-sizing:border-box;max-width:1024px;margin:auto;padding:clamp(20px,4vw,44px) clamp(14px,4vw,32px)}.directory-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px 18px;flex-wrap:wrap;margin-bottom:20px}.directory-head h1{font-size:clamp(24px,3vw,32px);margin:0}.directory-head p{font-size:13px;line-height:1.65;color:var(--nx-text-2);margin:6px 0 0}.directory-filter{display:flex;gap:10px;margin-bottom:18px}.directory-filter .el-input{max-width:400px}.directory-filter .el-select{width:140px;flex:none}.calendar-results h2{font-size:16px;margin:20px 0 9px}.directory-row{display:flex;align-items:baseline;gap:8px 16px;border:1px solid var(--nx-border);background:var(--nx-surface);border-radius:12px;padding:13px 15px;margin-bottom:8px}.directory-row>div{flex:1;min-width:0}.directory-row h3{font-size:14px;margin:0;overflow-wrap:anywhere}.directory-row p{margin:5px 0 0;font-size:13px;color:var(--nx-text-2);line-height:1.65;white-space:pre-wrap}.directory-row time{font-variant-numeric:tabular-nums;font-size:12px;color:var(--nx-text-2)}.directory-row a{color:var(--nx-accent);font-size:12px;white-space:nowrap}.phone-links{display:flex;gap:7px;flex-wrap:wrap;margin-top:7px}.phone-links a{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--nx-border);border-radius:7px;padding:5px 8px;text-decoration:none;font-variant-numeric:tabular-nums}.phone-links a:hover{background:var(--nx-accent-soft)}@media(max-width:520px){.directory-row:has(time){flex-wrap:wrap}.directory-row:has(time)>div{flex-basis:68%}.directory-filter .el-select{width:108px}}
</style>
