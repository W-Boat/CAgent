<template>
  <div class="backup-panel">
    <section>
      <h4 class="admin-section-title">导出部署备份</h4>
      <p>打包知识库、讲座、校园地图、供应商、模型、智能体、技能和系统设置。数据库里保存的密钥随包加密迁移。用户账号、会话、审计记录和服务器环境变量单独管理。</p>
      <form class="backup-controls" @submit.prevent="download">
        <el-input v-model="exportPassword" type="password" show-password autocomplete="new-password" maxlength="256" placeholder="设置 12 位以上的备份口令" aria-label="设置备份口令" :disabled="!!busy"/>
        <el-button native-type="submit" type="primary" :loading="busy==='export'" :disabled="!!busy||exportPassword.length<12">导出加密备份</el-button>
      </form>
    </section>

    <section>
      <h4 class="admin-section-title">导入部署备份</h4>
      <p>先预览新增和覆盖范围。确认后，同一标识的配置会被覆盖，包外条目会保留。校园地图按包整体替换。</p>
      <form class="backup-controls" @submit.prevent="preview">
        <input ref="picker" type="file" accept=".cagent-backup" hidden @change="choose"/>
        <el-button native-type="button" :disabled="!!busy" @click="picker?.click()">选择备份文件</el-button>
        <span class="backup-filename" :title="file?.name">{{ file?.name || '尚未选择' }}</span>
        <el-input v-model="importPassword" type="password" show-password autocomplete="off" maxlength="256" placeholder="输入备份口令" aria-label="输入备份口令" :disabled="!!busy"/>
        <el-button native-type="submit" :loading="busy==='preview'" :disabled="!!busy||!file||importPassword.length<12">预览导入</el-button>
      </form>
      <el-alert v-if="result" type="success" :closable="false" show-icon :title="result"/>
    </section>

    <el-dialog v-model="visible" title="确认覆盖现有配置" width="min(640px, calc(100vw - 32px))" :show-close="!busy" :close-on-click-modal="!busy" :close-on-press-escape="!busy">
      <template v-if="report">
        <p class="backup-details">备份于 {{ new Date(report.exportedAt).toLocaleString() }}。包含 {{ report.lectures.toLocaleString() }} 条讲座、{{ report.savedCredentials }} 项已保存凭据。</p>
        <table class="backup-table">
          <thead><tr><th scope="col">资料与配置</th><th scope="col">新增</th><th scope="col">覆盖</th></tr></thead>
          <tbody><tr v-for="(counts, key) in report.totals" :key="key"><th scope="row">{{ labels[key] || key }}</th><td>{{ counts.added.toLocaleString() }}</td><td>{{ counts.overwritten.toLocaleString() }}</td></tr></tbody>
        </table>
        <p class="backup-details">恢复地图：{{ report.maps.join('、') }}<span v-if="report.replacesMaps.length">。将替换地图中的 {{ report.replacesMaps.join('、') }}</span></p>
        <el-alert type="warning" :closable="false" show-icon title="导入会覆盖上表列出的目标记录。可先导出目标站点的备份，以便恢复。"/>
        <el-checkbox v-model="confirmed" :disabled="!!busy">我确认覆盖这些配置与资料</el-checkbox>
      </template>
      <template #footer>
        <el-button :disabled="!!busy" @click="visible=false">取消</el-button>
        <el-button type="danger" :disabled="!confirmed||!!busy" :loading="busy==='import'" @click="restore">确认覆盖并导入</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { http, request, toastError, toastOk } from '@/api/client'

type Report = { exportedAt: string; totals: Record<string, {added:number;overwritten:number}>; maps:string[]; replacesMaps:string[]; lectures:number; savedCredentials:number; confirmation:string }
const emit = defineEmits<{ imported: [] }>()
const labels:Record<string,string> = { providers:'模型供应商',keys:'供应商密钥',models:'模型配置',skills:'技能',agents:'智能体',bindings:'智能体技能绑定',bases:'知识库与挂载状态',entries:'知识条目',guide:'导览索引（含讲座）',settings:'系统与采集设置',maps:'校园地图' }
const picker = ref<HTMLInputElement>()
const file = ref<File>()
const exportPassword=ref(''), importPassword=ref(''), busy=ref(''), result=ref('')
const visible=ref(false), confirmed=ref(false), report=ref<Report>()
const timeout=180000

function choose(event:Event){
  const input=event.target as HTMLInputElement
  const selected=input.files?.[0]
  input.value=''
  file.value=undefined; report.value=undefined; result.value=''
  if(!selected)return
  if(selected.size>64*1024*1024){toastError(new Error('备份文件最大 64 MB'));return}
  file.value=selected
}

async function download(){
  busy.value='export'
  try{
    const response=await http.post<Blob>('/settings/backup/export',{password:exportPassword.value},{timeout,responseType:'blob'})
    const url=URL.createObjectURL(response.data)
    const link=document.createElement('a')
    link.href=url;link.download=`CAgent-${new Date().toISOString().slice(0,10)}.cagent-backup`;link.click()
    window.setTimeout(()=>URL.revokeObjectURL(url),60000)
    exportPassword.value='';toastOk('备份已下载')
  }catch(error){
    const blob=(error as {response?:{data?:Blob}})?.response?.data
    if(blob instanceof Blob){
      try{toastError(new Error(JSON.parse(await blob.text()).message),'导出失败')}
      catch{toastError(error,'导出失败')}
    }else toastError(error,'导出失败')
  }finally{busy.value=''}
}

function upload(path:string,confirmation?:string){
  const body=new FormData()
  body.append('file',file.value!);body.append('password',importPassword.value)
  if(confirmation)body.append('confirmation',confirmation)
  return request<Report>({url:`/settings/backup/${path}`,method:'POST',data:body,timeout})
}

async function preview(){
  if(!file.value)return
  result.value='';confirmed.value=false;busy.value='preview'
  try{report.value=await upload('preview');visible.value=true}
  catch(error){toastError(error,'预览失败')}
  finally{busy.value=''}
}

async function restore(){
  if(!confirmed.value||!report.value||!file.value)return
  busy.value='import'
  try{
    const restored=await upload('import',report.value.confirmation)
    const totals=Object.values(restored.totals).reduce((sum, row)=>({added:sum.added+row.added,overwritten:sum.overwritten+row.overwritten}),{added:0,overwritten:0})
    visible.value=false;file.value=undefined;importPassword.value='';report.value=undefined
    result.value=`导入完成，新增 ${totals.added.toLocaleString()} 项，覆盖 ${totals.overwritten.toLocaleString()} 项。`
    emit('imported')
  }catch(error){toastError(error,'导入失败');visible.value=false;report.value=undefined}
  finally{busy.value=''}
}
</script>

<style scoped>
.backup-panel{display:grid;gap:24px}.backup-panel section+section{padding-top:20px;border-top:1px solid var(--nx-border,var(--el-border-color))}.backup-panel p,.backup-details{line-height:1.7;color:var(--nx-text-2,var(--el-text-color-secondary))}.backup-controls{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin:12px 0}.backup-controls :deep(.el-input){width:min(100%,260px)}.backup-filename{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;font-size:13px}.backup-table{width:100%;border-collapse:collapse;margin:12px 0}.backup-table :is(th,td){border-bottom:1px solid var(--nx-border,var(--el-border-color));padding:7px;text-align:start;font-variant-numeric:tabular-nums}.backup-table tbody th{font-weight:500}.backup-table :is(th,td):not(:first-child){text-align:end}
</style>
