<script setup lang="ts">
import {ref} from 'vue'
import {knowledgeApi} from '@/api/knowledge'
import {errorMessage,toastOk} from '@/api/client'
import {notifyKnowledgeChanged} from '@/utils/knowledge-shortcuts'
const emit=defineEmits<{done:[]}>(),visible=ref(false),busy=ref(false),error=ref(''),data=ref<any>(null),filename=ref('')
async function choose(event:Event){const input=event.target as HTMLInputElement,file=input.files?.[0];input.value='';if(!file)return;error.value='';data.value=null;try{if(file.size>1900000)throw new Error('课表文件超过 1.9 MB，请检查文件是否重复或异常');const value=JSON.parse(await file.text());if(value.complete!==true||typeof value.semester!=='string'||!Array.isArray(value.records)||!value.records.length||!value.sourcePage||!value.capturedAt)throw new Error('请上传 HTTP 采集脚本生成的全校课表 JSON');data.value=value;filename.value=file.name}catch(e){error.value=errorMessage(e)}}
async function save(){if(busy.value||!data.value)return;busy.value=true;error.value='';try{const result=await knowledgeApi.importCollective(data.value);toastOk(`已导入 ${result.indexed} 条知识条目，知识库${result.mounted?'已挂载':'保持关闭'}`);notifyKnowledgeChanged();data.value=null;visible.value=false;emit('done')}catch(e){error.value=errorMessage(e)}finally{busy.value=false}}
</script>
<template>
 <el-button @click="visible=true">上传集体课表</el-button>
 <el-dialog v-model="visible" title="导入全校课程安排" width="min(560px, 94vw)" :close-on-click-modal="!busy" :show-close="!busy">
  <p>将全校课表建立为独立知识库。无需教务账号或浏览器操控，按学期、院系、课程与时间查询。</p>
  <label class="catalog-file">选择 JSON 文件<input type="file" accept=".json,application/json" :disabled="busy" @change="choose"/></label>
  <div v-if="data" class="catalog-summary"><strong>{{data.semester}}</strong><p>{{filename}} · {{data.records.length}} 条课程安排</p><p>采集时间：{{data.capturedAt}}</p><p>来源：{{data.sourcePage}}</p></div>
  <p class="catalog-note">已有同学期资料将更新，保留知识库开关和自定义快捷按钮。集体课表不代表任何用户的个人选课；老师工号和学生名单不进入知识库。</p>
  <el-alert v-if="error" :title="error" type="error" :closable="false"/>
  <template #footer><el-button :disabled="busy" @click="visible=false">取消</el-button><el-button type="primary" :loading="busy" :disabled="!data" @click="save">确认导入知识库</el-button></template>
 </el-dialog>
</template>
<style scoped>
p{line-height:1.7;color:var(--el-text-color-secondary)}.catalog-file{display:grid;gap:12px;margin:20px 0;color:var(--el-text-color-primary)}.catalog-summary{padding:16px;background:var(--el-fill-color-light);border:1px solid var(--el-border-color-light);border-radius:12px;overflow-wrap:anywhere}.catalog-summary p{font-size:13px;margin:8px 0 0}.catalog-note{font-size:12px}
</style>
