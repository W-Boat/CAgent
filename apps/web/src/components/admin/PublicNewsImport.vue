<script setup lang="ts">
import { ref } from 'vue'
import { post, errorMessage } from '@/api/client'

type Report = { baseId:string; read:number; newDrafts:number; columns:{name:string;count:number;error?:string}[] }
const emit = defineEmits<{ done:[baseId:string] }>()
const open = ref(false), busy = ref(false), campusNetwork = ref(false), error = ref(''), report = ref<Report>()
const installReport = ref<{baseId:string;added:number;total:number}>()
type DirectoryCount = {baseId:string;read:number;added:number}
const directoryReport=ref<{calendar:DirectoryCount;directory:DirectoryCount;failed:string[]}>()
async function collectDirectory(){
  busy.value=true;error.value='';directoryReport.value=undefined
  try{directoryReport.value=await post('/experience/portal/campus-directory/collect',{campusNetwork:campusNetwork.value})}
  catch(cause){error.value=errorMessage(cause)}finally{busy.value=false}
}
async function collect() {
  busy.value = true
  error.value = ''
  report.value = undefined
  try { report.value = await post<Report>('/experience/portal/official-news/collect',{campusNetwork:campusNetwork.value}) }
  catch (cause) {error.value = errorMessage(cause)}
  finally {busy.value = false}
}
async function install() {
  busy.value = true
  error.value = ''
  installReport.value = undefined
  try {
    installReport.value = await post<{baseId:string;added:number;total:number}>('/experience/portal/navigation/install',{})
  } catch (cause) {error.value = errorMessage(cause)}
  finally {busy.value = false}
}
</script>
<template>
  <el-button @click="open = true">官方门户资料</el-button>
  <el-dialog v-model="open" title="官方门户资料" width="min(540px, 94vw)">
    <p>导入官方门户 A–Z 应用目录。可在「官方门户入口与办理导航」库中增补应用、更新链接或归档条目。学生端随已发布条目更新。</p>
    <el-button :loading="busy" @click="install">导入已核对的门户导航</el-button>
    <p v-if="installReport" role="status">共核对 {{ installReport.total }} 条，本次新增 {{ installReport.added }} 条。
      <el-button text @click="open = false; emit('done', installReport.baseId)">查看知识库</el-button>
    </p>
    <p>读取学校官网的「通知公告」和「要闻」首页，保存为草稿。学生端校园要闻展示审核发布的要闻。可在「社科大官网资讯」库编辑、发布或归档。</p>
    <el-switch v-model="campusNetwork" :disabled="busy" active-text="采集服务器在校园网内，可直连学校域名" />
    <section class="directory-import">
      <p>采集公开校历、教学日期和部门办公座机，分别存入独立知识库。</p>
      <el-button :loading="busy" @click="collectDirectory">采集校历与部门电话</el-button>
      <div v-if="directoryReport" role="status">
        <p>校历读取 {{directoryReport.calendar.read}} 条、电话读取 {{directoryReport.directory.read}} 条。</p>
        <p v-if="directoryReport.failed.length">{{directoryReport.failed.length}} 个来源未能访问，保留已有条目。</p>
        <el-button v-if="directoryReport.calendar.read" text @click="open=false;emit('done',directoryReport.calendar.baseId)">校历知识库</el-button>
        <el-button v-if="directoryReport.directory.read" text @click="open=false;emit('done',directoryReport.directory.baseId)">电话知识库</el-button>
      </div>
    </section>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
    <template v-if="report">
      <p>读取 {{ report.read }} 条，新增草稿 {{ report.newDrafts }} 条。</p>
      <ul><li v-for="column in report.columns" :key="column.name">{{ column.name }} · {{ column.error || column.count + ' 条' }}</li></ul>
    </template>
    <template #footer>
      <el-button v-if="report" @click="open = false; emit('done', report.baseId)">审核条目</el-button>
      <el-button type="primary" :loading="busy" @click="collect">读取公开栏目</el-button>
    </template>
  </el-dialog>
</template>
<style scoped>.directory-import{margin-top:14px;padding:12px 0;border-top:1px solid var(--nx-border)}.directory-import p{margin:0 0 8px}</style>
