<template>
  <div class="page admin-settings-page">
    <div class="page-header">
      <div>
        <h2 class="page-title">平台设置</h2>
        <p class="page-subtitle">管理站点外观、对话行为、知识检索和运维配置。</p>
      </div>
      <div class="page-actions">
        <el-button v-permission="'setting:write'" type="primary" :loading="saving" @click="save">
          <el-icon><Check /></el-icon> 保存全部修改
        </el-button>
        <el-button :disabled="loading || saving" @click="reload">
          <el-icon><Refresh /></el-icon> 重新载入
        </el-button>
      </div>
    </div>

    <el-alert
      v-if="dirtyKeys.length"
      :title="`有 ${dirtyKeys.length} 项修改尚未保存`"
      type="warning"
      show-icon
      :closable="false"
      class="dirty-alert"
    >
      <template #default>
        <div class="dirty-body">
          <span>涉及：{{ dirtyKeys.map((k) => labelOf(k)).join("、") }}</span>
          <el-button text type="primary" size="small" @click="resetAll">撤销全部</el-button>
        </div>
      </template>
    </el-alert>

    <div class="settings-layout">
      <nav class="settings-nav" aria-label="设置分类">
        <section v-for="section in sections" :key="section.label" class="settings-nav-section" :aria-label="section.label">
          <h3><el-icon aria-hidden="true"><component :is="section.icon"/></el-icon>{{section.label}}</h3>
          <button v-for="group in section.groups" :key="group.key" type="button"
            :aria-current="activeGroup === group.key ? 'true' : undefined" @click="activeGroup = group.key">{{group.label}}</button>
        </section>
      </nav>
      <div class="settings-panels" :aria-busy="loading">
        <PageLoading v-if="loading" :rows="loaded ? 0 : 5" label="正在读取平台设置"/>
        <el-card v-for="group in GROUP_ORDER" v-show="activeGroup === group.key && (loaded || !loading)" :key="group.key" :inert="loading" shadow="never" class="settings-card">
          <template #header>
            <div class="settings-panel-heading">
              <span class="settings-panel-icon" aria-hidden="true"><el-icon><component :is="group.icon"/></el-icon></span>
              <div class="settings-panel-caption" :class="{'is-current':activeGroup===group.key}">
                <h3 class="admin-section-title settings-panel-title">{{ group.label }}</h3>
                <p class="settings-panel-description">{{ group.description }}</p>
              </div>
            </div>
          </template>
          <RouterLink v-if="group.key==='security'" to="/admin/sensitive-words" class="nx-btn nx-btn-secondary settings-words">打开敏感词管理</RouterLink>
          <div v-if="group.key==='search'" class="settings-search">
            <h4 class="admin-section-title">搜索接口配置</h4>
            <p>下方可设置搜索开关、搜索引擎、校外范围、结果数量和正文。密钥通过服务器环境变量或模型供应商后台配置。</p>
            <el-button type="primary" :loading="saving" :disabled="!auth.can('setting:write')||!groups.search?.length" @click="save('search')">保存搜索配置</el-button>
            <el-alert v-if="!groups.search?.length" title="当前账号未取得搜索配置项，请重新载入；仍不可见时请管理员检查设置权限。" type="warning" :closable="false" show-icon/>
            <p>保存后可测试接口。覆盖服务器配置的学校域名及子域名，仅搜索已收录的公开网页。</p>
            <div class="settings-search-controls">
              <el-input v-model="searchQuery" aria-label="测试搜索词" placeholder="例如：校园 学术新闻" maxlength="100" />
              <el-select v-model="searchScope" aria-label="测试搜索范围"><el-option label="校内子域名" value="campus"/><el-option label="校外新闻" value="external"/><el-option label="全网" value="all"/></el-select>
              <el-button :loading="searchBusy" :disabled="dirtyKeys.some(key=>groups.search?.some(item=>item.key===key))||!auth.can('setting:write')||!groups.search?.length" @click="testSearch">测试搜索</el-button>
            </div>
            <p v-if="searchReport">{{searchReport}}</p>
            <p v-for="item in searchResults" :key="item.url"><a :href="item.url" target="_blank" rel="noopener noreferrer">{{item.title}}</a> · {{item.published||'日期未提供'}}</p>
          </div>
          <PlatformBackupPanel v-if="group.key==='backup'&&activeGroup==='backup'" @imported="reload"/>
          <div v-else-if="group.key==='backup'"></div>
          <div v-else-if="!groups[group.key]" class="empty-block">该分组暂无设置项</div>
          <StudentDisplayPanel v-else-if="group.key==='student'" :values="model" :models="availableModels" :disabled="!auth.can('setting:write')" @change="setValue"/>
          <el-form v-else label-position="top" class="setting-form" @submit.prevent>
            <el-form-item v-for="item in groups[group.key]" :key="item.key">
              <template #label>
                <div class="label-box">
                  <span class="label-text">{{ item.label }}</span>
                </div>
              </template>

              <div class="field">
                <el-switch
                  v-if="item.type === 'boolean'"
                  :model-value="Boolean(model[item.key])"
                  :disabled="!auth.can('setting:write')"
                  @update:model-value="(v: any) => setValue(item.key, v)"
                />

                <el-input-number
                  v-else-if="item.type === 'number'"
                  :model-value="Number(model[item.key] ?? 0)"
                  :disabled="!auth.can('setting:write')"
                  :step="stepOf(item.key)"
                  :min="item.key==='knowledge_retrieval_depth'?1:0"
                  :max="item.key==='knowledge_retrieval_depth'?8:Infinity"
                  @update:model-value="(v: any) => setValue(item.key, Number(v))"
                />

                <el-input
                  v-else-if="item.type === 'text'"
                  :model-value="String(model[item.key] ?? '')"
                  type="textarea"
                  :rows="4"
                  :disabled="!auth.can('setting:write')"
                  @update:model-value="(v: string) => setValue(item.key, v)"
                />

                <el-select
                  v-else-if="item.options?.length"
                  :model-value="model[item.key]"
                  :disabled="!auth.can('setting:write')"
                  @update:model-value="(v: any) => setValue(item.key, v)"
                >
                  <el-option
                    v-for="opt in item.options"
                    :key="String(opt.value)"
                    :label="opt.label"
                    :value="opt.value"
                  />
                </el-select>

                <el-input
                  v-else-if="item.type !== 'json'"
                  :model-value="String(model[item.key] ?? '')"
                  :disabled="!auth.can('setting:write')"
                  @update:model-value="(v: string) => setValue(item.key, v)"
                />

                <!-- JSON 类型：数组/对象编辑器 -->
                <div v-if="item.type === 'json'" class="json-editor">
                  <el-input
                    :model-value="jsonText[item.key] ?? ''"
                    type="textarea"
                    :rows="3"
                    :disabled="!auth.can('setting:write')"
                    placeholder='JSON 数组，如 ["关键词1","关键词2"]'
                    @update:model-value="(v: string) => onJsonInput(item.key, v)"
                  />
                  <div class="json-hint">
                    <span v-if="jsonValid[item.key] === false" class="json-error">
                      JSON 格式有误，将不会被保存
                    </span>
                    <span v-else class="muted">共 {{ jsonCount(item.key) }} 项</span>
                    <span
                      v-if="Array.isArray(model[item.key]) && (model[item.key] as unknown[]).length === 0"
                      class="muted"
                    >
                      （留空表示不限制）
                    </span>
                  </div>
                </div>

                <div v-if="item.description" class="field-desc">{{ item.description }}</div>
              </div>
            </el-form-item>
          </el-form>
          <ExperienceSettingsPanel v-if="group.key === 'test' || group.key === 'presentation'" :group="group.key"
            :enabled="snapshot[group.key === 'test' ? 'test_accounts_enabled' : 'mascot_enabled'] === true"
            :disabled="!auth.can('setting:write')"/>
        </el-card>
      </div>
    </div>
    <details class="settings-build">
      <summary>构建版本</summary>
      <p>前端 · {{ buildInfo.version }} · {{ buildInfo.builtAt }}</p>
      <p>服务端 · {{ serverBuild?.version || '读取中' }} · {{ serverBuild?.builtAt || '' }}</p>
    </details>
  </div>
</template>

<script setup lang="ts">
import {get} from '@/api/client'
import buildInfo from '../../data/build-info.json'
import { computed, onMounted, reactive, ref } from "vue"
import { Collection, Monitor, Operation, Lock } from '@element-plus/icons-vue'
import PageLoading from '@/components/PageLoading.vue'
import StudentDisplayPanel from "@/components/admin/StudentDisplayPanel.vue"
import ExperienceSettingsPanel from '@/components/admin/ExperienceSettingsPanel.vue'
import PlatformBackupPanel from '@/components/admin/PlatformBackupPanel.vue'
import { settingsApi,modelsApi } from "@/api"
import { toastError, toastOk,request } from "@/api/client"
import { useAuthStore } from "@/stores/auth"
import type { SettingItem } from "@/api/types"
import { useKeepAliveRefresh } from "@/utils/keep-alive"

/*
 * 声明组件名，供 <keep-alive :include> 匹配（约定与路由 name 一致）。
 * 不声明的话缓存会静默失效：切走再回来仍会重建组件、重新拉数据。
 */
defineOptions({ name: "admin-settings" })

const auth = useAuthStore()
const searchQuery=ref('校园 学术新闻'),searchScope=ref('campus'),searchBusy=ref(false),searchReport=ref(''),searchResults=ref<{title:string;url:string;published:string}[]>([])
async function testSearch(){searchBusy.value=true;searchResults.value=[];try{const result=await request<any>({method:'POST',url:'/search/test',data:{query:searchQuery.value,scope:searchScope.value}});searchResults.value=result.results;searchReport.value=`返回 ${result.results.length} 条${result.cached?'（缓存）':''}；${result.notice}`}catch(e){searchReport.value='测试未通过，请检查开关、密钥、权限或网络';toastError(e)}finally{searchBusy.value=false}}

const sections = computed(() => [
  {label:'站点与外观',icon:Monitor,groups:[
    {key:'general',label:'站点与注册',description:'设置平台名称与新用户注册规则。'},
    {key:'student',label:'学生界面与主题',description:'设置学生端首页、主题色和默认显示内容。'},
    {key:'presentation',label:'回答排版与吉祥物',description:'配置回答样式、渲染回退顺序和吉祥物。'},
  ]},
  {label:'对话与交互',icon:Operation,groups:[
    {key:'chat',label:'对话与记忆',description:'设置回答缓存、上下文和记忆功能。'},
    {key:'voice',label:'语音输入与播报',description:'设置语音识别、播报服务和默认参数。'},
    {key:'skill',label:'工具与技能',description:'设置对话中可用的工具和技能规则。'},
    {key:'browser',label:'浏览器能力',description:'管理浏览器功能及其访问范围。'},
  ]},
  {label:'检索与更新',icon:Collection,groups:[
    {key:'knowledge',label:'知识库与检索',description:'控制检索深度、连续检索等查询行为。'},
    {key:'search',label:'联网搜索',description:'配置搜索服务、结果范围，并测试接口。'},
    {key:'officialNews',label:'官网资讯采集',description:'管理校园要闻来源和自动更新。'},
  ]},
  {label:'安全与运维',icon:Lock,groups:[
    {key:'security',label:'内容审计',description:'设置内容审核规则，并访问敏感词列表。'},
    {key:'test',label:'测试账号',description:'管理演示模式和测试账号。'},
    ...(auth.roles.includes('super_admin')?[{key:'backup',label:'备份与迁移',description:'导出或恢复平台配置与知识库。'}]:[]),
  ]},
])
const GROUP_ORDER=computed(()=>sections.value.flatMap(section=>section.groups.map(group=>({...group,icon:section.icon}))))

const activeGroup = ref("general")
const groups = ref<Record<string, SettingItem[]>>({})
const availableModels=ref<{id:string;name:string}[]>([])
const loading = ref(false)
const loaded = ref(false)
const saving = ref(false)

/** 当前编辑值 */
const model = reactive<Record<string, unknown>>({})
/** 初始值快照，用于脏检查与撤销 */
const snapshot = reactive<Record<string, unknown>>({})
/** JSON 类型项的原始文本 */
const jsonText = reactive<Record<string, string>>({})
const jsonValid = reactive<Record<string, boolean>>({})

const labelMap = computed(() => {
  const map: Record<string, string> = {}
  for (const list of Object.values(groups.value)) {
    for (const item of list) map[item.key] = item.label
  }
  return map
})

const dirtyKeys = computed(() =>
  Object.keys(model).filter(
    (key) => JSON.stringify(model[key]) !== JSON.stringify(snapshot[key]) || jsonValid[key] === false
  )
)

function labelOf(key: string) {
  return labelMap.value[key] || key
}

function stepOf(key: string) {
  if (key.includes("temperature")) return 0.1
  if (key.includes("quota") || key.includes("token")) return 1000
  return 1
}

function toJsonText(value: unknown) {
  try {
    return JSON.stringify(value ?? [], null, 2)
  } catch {
    return "[]"
  }
}

function jsonCount(key: string) {
  const value = model[key]
  if (Array.isArray(value)) return value.length
  if (value && typeof value === "object") return Object.keys(value).length
  return 0
}

function setValue(key: string, value: unknown) {
  model[key] = value
}

function onJsonInput(key: string, text: string) {
  jsonText[key] = text
  try {
    const parsed = JSON.parse(text || "[]")
    model[key] = parsed
    jsonValid[key] = true
  } catch {
    jsonValid[key] = false
  }
}

async function load() {
  if(loading.value || saving.value)return
  loading.value = true
  try {
    const results=await Promise.allSettled([settingsApi.grouped(),modelsApi.available()])
    if(results[0].status!=='fulfilled')throw results[0].reason
    const data=results[0].value
    if(results[1].status==='fulfilled')availableModels.value=results[1].value
    groups.value = data
    loaded.value = true

    for (const key of Object.keys(model)) delete model[key]
    for (const key of Object.keys(snapshot)) delete snapshot[key]

    for (const list of Object.values(data)) {
      for (const item of list) {
        model[item.key] = item.value
        snapshot[item.key] = JSON.parse(JSON.stringify(item.value ?? null))
        if (item.type === "json") {
          jsonText[item.key] = toJsonText(item.value)
          jsonValid[item.key] = true
        }
      }
    }
  } catch (error) {
    toastError(error, "系统设置加载失败")
  } finally {
    loading.value = false
  }
}

async function save(onlyGroup?: unknown) {
  const keys=typeof onlyGroup==='string'?dirtyKeys.value.filter(key=>groups.value[onlyGroup]?.some(item=>item.key===key)):dirtyKeys.value
  if(saving.value || loading.value)return
  if (keys.length === 0) {
    toastOk("没有需要保存的修改")
    return
  }

  const invalid = keys.filter((k) => jsonValid[k] === false)
  if (invalid.length > 0) {
    toastError(new Error(`以下设置项 JSON 格式有误：${invalid.join(", ")}`))
    return
  }

  saving.value = true
  try {
    const payload: Record<string, unknown> = {}
    for (const key of keys) payload[key] = JSON.parse(JSON.stringify(model[key] ?? null))

    const flat = await settingsApi.update(payload)
    // 用后端返回值刷新快照
    for (const [key, value] of Object.entries(flat)) {
      if (key in model) {
        const submitted=key in payload
        const unchanged=JSON.stringify(model[key])===JSON.stringify(submitted?payload[key]:snapshot[key]) && jsonValid[key]!==false
        if(unchanged){model[key]=value;if(key in jsonText)jsonText[key]=toJsonText(value)}
        if(submitted || unchanged)snapshot[key] = JSON.parse(JSON.stringify(value ?? null))
      }
    }
    toastOk(`已保存 ${Object.keys(payload).length} 项设置`)
    await auth.loadPublicSettings()
    try{localStorage.setItem('cagent-display-updated',String(Date.now()))}catch{}
  } catch (error) {
    toastError(error)
  } finally {
    saving.value = false
  }
}

async function reload(){
  if(dirtyKeys.value.length){try{await ElMessageBox.confirm('重新载入将丢弃尚未保存的修改，是否继续？','重新载入',{type:'warning',confirmButtonText:'重新载入',cancelButtonText:'继续编辑'})}catch{return}}
  await load()
}

async function resetAll() {
  try {
    await ElMessageBox.confirm("撤销所有未保存的修改？", "撤销修改", {
      type: "warning",
      confirmButtonText: "撤销",
      cancelButtonText: "取消"
    })
  } catch {
    return
  }
  for (const key of Object.keys(model)) {
    model[key] = JSON.parse(JSON.stringify(snapshot[key] ?? null))
    if (jsonText[key] !== undefined) jsonText[key] = toJsonText(snapshot[key])
    jsonValid[key] = true
  }
  toastOk("已撤销未保存的修改")
}

/*
 * 被 keep-alive 缓存：onMounted 只跑一次，切回来是旧数据。
 * 用统一的 composable 按「是否过期」决定要不要重拉，
 * 避免快速来回切换时打出一串请求。
 */
const { refresh } = useKeepAliveRefresh(()=>{if(!dirtyKeys.value.length && !saving.value)return load()}, { staleAfter: 120000 })
const serverBuild=ref<{version:string;builtAt:string}>()
onMounted(()=>{void get<{version:string;builtAt:string}>('/settings/version').then(v=>serverBuild.value=v).catch(()=>serverBuild.value={version:'暂不可读',builtAt:''});refresh()})
</script>

<style scoped>
.dirty-alert {
  margin-bottom: 14px;
}
.dirty-body {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.settings-layout { display: grid; grid-template-columns: minmax(176px, 204px) minmax(0, 1fr); gap: var(--admin-card-gap); align-items: start; }
.settings-nav {
  display: flex; flex-direction: column; gap: 4px; padding: 6px;
  border: 1px solid var(--nx-border); border-radius: var(--admin-card-radius); background: var(--nx-surface);
  position: sticky; top: 12px;
}
.settings-nav button {
  position: relative;
  appearance: none; background: transparent; border: 0; border-radius: var(--nx-radius);
  padding: 8px 11px; min-height: 36px; text-align: start; font: inherit; color: var(--nx-text-2); cursor: pointer;
  transition: background-color .16s ease, color .16s ease;
}
.settings-nav button:hover { background: var(--nx-surface-hover); }
.settings-nav button[aria-current] { background: var(--nx-accent-soft); color: var(--nx-accent); font-weight: 650; }
.settings-nav button[aria-current]::after { content: ''; position: absolute; inset-inline-start: 0; inset-block: 10px; width: 2px; border-radius: 999px; background: currentColor; }
.settings-nav button:focus-visible { outline: 2px solid var(--nx-accent); outline-offset: -2px; }
.settings-nav-section{display:flex;flex-direction:column;gap:2px}.settings-nav-section + .settings-nav-section{border-top:1px solid var(--nx-border);padding-top:5px;margin-top:4px}.settings-nav-section h3{margin:5px 11px;color:var(--nx-text-2);font-size:11px;font-weight:650}.settings-words{margin-bottom:var(--admin-card-gap)}
.settings-nav-section h3 { display: flex; align-items: center; gap: 6px; }
.settings-nav-section:has([aria-current]) h3 { color: var(--nx-accent); }
.settings-panels { min-width: 0; }
.settings-panel-heading { display: flex; align-items: center; gap: 12px; }
.settings-panel-icon { display: grid; place-items: center; flex: none; width: 36px; height: 36px; border-radius: 10px; background: var(--nx-accent-soft); color: var(--nx-accent); font-size: 18px; }
.settings-panel-caption.is-current { animation: settings-caption-in .18s ease-out; }
.settings-panel-title { margin: 0; }
.settings-panel-description { margin: 4px 0 0; color: var(--nx-text-2); font-size: 12px; line-height: 1.5; }
@keyframes settings-caption-in { from { opacity: .6; transform: translateY(3px); } }
@media (prefers-reduced-motion: reduce) {
  .settings-panel-caption.is-current { animation: none; }
  .settings-nav button { transition: none; }
}
.setting-form {
  width: 100%;
}
.setting-form :deep(.el-form-item) {
  display: grid; grid-template-columns: minmax(130px, 200px) minmax(0, 1fr);
  gap: 8px 16px; align-items: start; margin: 0; padding: 14px 0;
  border-bottom: 1px solid var(--nx-border);
}
.setting-form :deep(.el-form-item:first-child) { padding-top: 0; }
.setting-form :deep(.el-form-item:last-child) { border-bottom: 0; padding-bottom: 0; }
.setting-form :deep(.el-form-item__label) { margin: 0; height: auto; padding: 5px 0 0; justify-content: start; }
.setting-form :deep(.el-form-item__content) { min-width: 0; }
.field > :deep(.el-input), .field > :deep(.el-select) { width: min(100%, 35rem); }
.settings-build { margin: var(--admin-card-gap) 0 0; color: var(--nx-text-2); font-size: 12px; overflow-wrap: anywhere; }
.settings-build summary { cursor: pointer; width: fit-content; }
.settings-build p { margin: 4px 0; }
.settings-search { padding-bottom: var(--admin-card-pad); margin-bottom: var(--admin-card-pad); border-bottom: 1px solid var(--nx-border); }
.settings-search h4 { margin: 0; }
.settings-search p { color: var(--nx-text-2); line-height: 1.6; }
.settings-search-controls { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.settings-search-controls :deep(.el-input) { flex: 1 1 225px; max-width: 27rem; }
.settings-search-controls :deep(.el-select) { width: 132px; }
.label-box {
  display: flex;
  flex-direction: column;
  line-height: 1.4;
}
.label-text {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--nx-text);
}
.label-key {
  font-size: 11px;
  color: var(--nx-text-2);
  overflow-wrap: anywhere;
}
.field {
  width: 100%;
}
.field-desc {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--cg-text-muted);
}
.json-editor {
  width: 100%;
}
.json-hint {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 4px;
  font-size: 12px;
}
.json-error {
  color: var(--el-color-danger);
}
@media (max-width: 960px) {
  .settings-layout { grid-template-columns: minmax(0, 1fr); }
  .settings-nav { position: static; flex-direction: row; overflow-x: auto; scrollbar-width: thin; scrollbar-color: var(--nx-border-strong) transparent; }
  .settings-nav button { flex: none; white-space: nowrap; }
  .settings-nav button[aria-current]::after { inset-inline: 10px; inset-block: auto 2px; width: auto; height: 2px; }
  .settings-nav-section{flex-direction:row;align-items:center;flex:none}.settings-nav-section + .settings-nav-section{border-top:0;border-left:1px solid var(--nx-border);padding:0 0 0 6px;margin:0 0 0 2px}.settings-nav-section h3{white-space:nowrap}
}
@media (max-width: 620px) {
  .setting-form :deep(.el-form-item) { grid-template-columns: minmax(0, 1fr); }
  .setting-form :deep(.el-form-item__label) { padding-top: 0; }
  .dirty-body { flex-wrap: wrap; }
}
</style>
