<script setup lang="ts">
import {computed,onMounted,ref} from 'vue'
import {get,put,toastError,toastOk} from '@/api/client'
import {useAuthStore} from '@/stores/auth'

type WordList = {words:string[];enabled:boolean}
const auth=useAuthStore(),words=ref<string[]>([]),saved=ref<string[]>([]),enabled=ref(true)
const loading=ref(false),saving=ref(false),error=ref(''),query=ref(''),editing=ref(false),input=ref(''),replace=ref('')
const visible=computed(()=>words.value.filter(word=>word.includes(query.value.trim())).map(word=>({word})))
const dirty=computed(()=>JSON.stringify(words.value)!==JSON.stringify(saved.value))

async function load(){
  loading.value=true;error.value=''
  try{const list=await get<WordList>('/settings/sensitive-words');saved.value=list.words.filter(word=>typeof word==='string');words.value=[...saved.value];enabled.value=list.enabled}
  catch{error.value='无法读取敏感词列表'}finally{loading.value=false}
}
function open(word=''){replace.value=word;input.value=word;editing.value=true}
function apply(){
  const next=input.value.split(/\r?\n/).map(word=>word.trim()).filter(Boolean)
  if (!next.length||next.some(word=>word.length>100)){toastError(new Error('请输入 1–100 字的词条，每行一项'));return}
  const base=words.value.filter(word=>word!==replace.value)
  const result=[...new Set([...base,...next])]
  if(result.length>2000){toastError(new Error('最多保存 2000 个词条'));return}
  words.value=result;editing.value=false
}
async function save(){
  saving.value=true
  try{const list=await put<WordList>('/settings/sensitive-words',{words:words.value});saved.value=list.words;words.value=[...saved.value];toastOk('敏感词已保存')}
  catch(cause){toastError(cause,'保存失败')}finally{saving.value=false}
}
onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div><h2 class="page-title">敏感词管理</h2><p class="page-subtitle">命中词条的消息会标记为待复核，供管理员在消息审计中查看。</p></div>
      <div class="page-actions" v-if="auth.can('setting:write')">
        <el-button :disabled="!dirty||saving" @click="words=[...saved]">撤销未保存修改</el-button>
        <el-button type="primary" :loading="saving" :disabled="!dirty" @click="save">保存词表</el-button>
      </div>
    </header>
    <el-alert v-if="error" :title="error" type="error" :closable="false" class="word-notice"><el-button text @click="load">重试</el-button></el-alert>
    <el-alert v-else-if="!enabled" title="内容审计标记已关闭。开启后才会使用此词表。" type="info" :closable="false" class="word-notice"/>
    <div class="filter-bar">
      <el-input v-model="query" clearable placeholder="搜索词条" aria-label="搜索敏感词"/>
      <span class="word-count">{{visible.length}} / {{words.length}} 条<span v-if="dirty"> · 待保存</span></span>
      <el-button v-if="auth.can('setting:write')" :disabled="loading||saving||!!error" @click="open()">添加词条</el-button>
    </div>
    <el-card shadow="never" class="table-card" v-loading="loading">
      <el-table :data="visible" row-key="word" max-height="540" :empty-text="query?'没有找到匹配词条':'词表为空'">
        <el-table-column prop="word" label="词条" min-width="180"/>
        <el-table-column v-if="auth.can('setting:write')" label="操作" width="148" align="right"><template #default="{row}"><el-button text :disabled="saving" @click="open(row.word)">编辑</el-button><el-button text type="danger" :disabled="saving" @click="words=words.filter(word=>word!==row.word)">移除</el-button></template></el-table-column>
      </el-table>
    </el-card>
    <el-dialog v-model="editing" :title="replace?'编辑词条':'添加词条'" width="min(440px, 92vw)">
      <el-input v-model="input" type="textarea" :rows="5" aria-label="输入敏感词" placeholder="每行输入一个词条"/>
      <template #footer><el-button @click="editing=false">取消</el-button><el-button type="primary" @click="apply">确认</el-button></template>
    </el-dialog>
  </div>
</template>

<style scoped>
.filter-bar .el-input{max-width:300px}.word-count{flex:1;white-space:nowrap;color:var(--nx-text-2);font-size:13px}.word-notice{margin-bottom:var(--admin-card-gap)}
</style>
