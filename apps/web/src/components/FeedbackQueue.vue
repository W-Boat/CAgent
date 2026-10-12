<template>
  <section class="feedback-queue">
    <div class="queue-toolbar"><div><h3>回答纠错</h3><p>核对原始问题，注入正确答案。同一问题再次出现时直接返回固定答案。</p></div>
      <el-select v-model="resolution" @change="reload"><el-option label="待处理" value="OPEN"/><el-option label="已解决" value="RESOLVED"/><el-option label="不采纳" value="DISMISSED"/><el-option label="全部" value=""/></el-select>
    </div>
    <el-table :data="items" v-loading="loading" stripe>
      <el-table-column label="问题与原回答" min-width="250"><template #default="{row}"><strong>{{row.question}}</strong><p class="original-answer">{{row.message?.content}}</p></template></el-table-column>
      <el-table-column label="用户反馈" min-width="200"><template #default="{row}"><el-tag size="small">{{row.reason || '未说明原因'}}</el-tag><p>{{row.correction || '未提供建议答案'}}</p></template></el-table-column>
      <el-table-column label="处理状态" width="110"><template #default="{row}">{{labels[row.resolution] || row.resolution}}</template></el-table-column>
      <el-table-column label="操作" width="190"><template #default="{row}"><el-button v-if="canReview" type="primary" text @click="open(row)">纠正并固定</el-button><el-button v-if="canReview" text @click="dismiss(row)">不采纳</el-button></template></el-table-column>
    </el-table>
    <el-pagination v-model:current-page="page" :total="total" :page-size="20" layout="prev,pager,next,total" @current-change="load"/>
    <el-dialog v-model="visible" title="注入正确答案" width="min(680px,94vw)">
      <el-form label-position="top"><el-form-item label="精确匹配的问题"><el-input v-model="question" type="textarea" :rows="2"/></el-form-item>
        <el-form-item label="正确答案（原样返回，支持 Markdown 和 card 卡片）"><el-input v-model="answer" type="textarea" :rows="8" maxlength="20000" show-word-limit/></el-form-item></el-form>
      <p>发布后立即生效，可在知识库管理中编辑、暂停或查看版本。</p>
      <template #footer><el-button @click="visible=false">取消</el-button><el-button type="primary" :loading="saving" :disabled="!question.trim() || !answer.trim()" @click="save">发布纠错</el-button></template>
    </el-dialog>
  </section>
</template>
<script setup lang="ts">
import {onMounted,ref,computed} from 'vue'
import {knowledgeApi} from '@/api/knowledge'
import {toastError,toastOk} from '@/api/client'
import {useAuthStore} from '@/stores/auth'
const auth=useAuthStore(),canReview=computed(()=>auth.can('learning:review'))
const items=ref<any[]>([]),total=ref(0),page=ref(1),resolution=ref('OPEN'),loading=ref(false),visible=ref(false),saving=ref(false)
const question=ref(''),answer=ref(''),selected=ref<any>(null)
const labels:Record<string,string>={OPEN:'待处理',RESOLVED:'已解决',DISMISSED:'不采纳'}
async function load(){loading.value=true;try{const r=await knowledgeApi.feedback({page:page.value,resolution:resolution.value});items.value=r.items;total.value=r.total}catch(e){toastError(e,'读取反馈失败')}finally{loading.value=false}}
function reload(){page.value=1;void load()}
function open(row:any){selected.value=row;question.value=row.question;answer.value=row.correction || '';visible.value=true}
async function save(){saving.value=true;try{await knowledgeApi.correctFeedback(selected.value.id,question.value,answer.value);visible.value=false;toastOk('纠错已发布');await load()}catch(e){toastError(e,'发布失败')}finally{saving.value=false}}
async function dismiss(row:any){try{await knowledgeApi.resolveFeedback(row.id,'DISMISSED');await load()}catch(e){toastError(e,'处理失败')}}
onMounted(load)
</script>
<style scoped>
.queue-toolbar{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:20px}.queue-toolbar h3{margin:0 0 8px}.queue-toolbar p{margin:0;color:var(--el-text-color-secondary);font-size:13px}.queue-toolbar .el-select{width:150px;flex-shrink:0}.original-answer{max-height:120px;overflow:auto;white-space:pre-wrap;color:var(--el-text-color-secondary);font-size:12px}.el-pagination{margin-top:20px}@media(max-width:600px){.queue-toolbar{align-items:flex-start;flex-direction:column}}
</style>
