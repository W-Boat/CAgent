<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title">系统设置</h2>
        <p class="page-subtitle">站点品牌、对话默认参数、内容安全、技能与浏览器操控开关</p>
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

    <el-tabs v-model="activeGroup" class="setting-tabs" v-loading="loading">
      <el-tab-pane
        v-for="group in GROUP_ORDER"
        :key="group.key"
        :name="group.key"
        :label="group.label"
      >
        <el-card shadow="never" class="block">
          <div v-if="group.key==='search'" style="margin-bottom:20px">
            <p>先保存搜索设置，再测试接口。默认覆盖 ucass.edu.cn 及全部子域名，仅搜索已收录的公开网页。</p>
            <el-input v-model="searchQuery" placeholder="例如：中国社会科学院大学 学术新闻" maxlength="100" style="max-width:460px" />
            <el-select v-model="searchScope" style="width:130px;margin:8px"><el-option label="校内子域名" value="campus"/><el-option label="校外新闻" value="external"/><el-option label="全网" value="all"/></el-select>
            <el-button :loading="searchBusy" :disabled="dirtyKeys.length>0||!auth.can('setting:write')" @click="testSearch">测试搜索</el-button>
            <p v-if="searchReport">{{searchReport}}</p>
            <p v-for="item in searchResults" :key="item.url"><a :href="item.url" target="_blank" rel="noopener noreferrer">{{item.title}}</a> · {{item.published||'日期未提供'}}</p>
          </div>
          <div v-if="!groups[group.key]" class="empty-block">该分组暂无设置项</div>
          <StudentDisplayPanel v-else-if="group.key==='student'" :values="model" :models="availableModels" :disabled="!auth.can('setting:write')" @change="setValue"/>
          <el-form v-else label-width="200px" label-position="right" class="setting-form" @submit.prevent>
            <el-form-item v-for="item in groups[group.key]" :key="item.key">
              <template #label>
                <div class="label-box">
                  <span class="label-text">{{ item.label }}</span>
                  <span class="label-key mono">{{ item.key }}</span>
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
                  style="width: 280px"
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
                  v-else
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
        </el-card>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue"
import StudentDisplayPanel from "@/components/admin/StudentDisplayPanel.vue"
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
const searchQuery=ref('中国社会科学院大学 学术新闻'),searchScope=ref('campus'),searchBusy=ref(false),searchReport=ref(''),searchResults=ref<{title:string;url:string;published:string}[]>([])
async function testSearch(){searchBusy.value=true;searchResults.value=[];try{const result=await request<any>({method:'POST',url:'/search/test',data:{query:searchQuery.value,scope:searchScope.value}});searchResults.value=result.results;searchReport.value=`返回 ${result.results.length} 条${result.cached?'（缓存）':''}；${result.notice}`}catch(e){searchReport.value='测试未通过，请检查开关、密钥、权限或网络';toastError(e)}finally{searchBusy.value=false}}

const GROUP_ORDER = [
  { key: "general", label: "通用" },
  { key: "student", label: "学生端与主题" },
  { key: "chat", label: "对话" },
  { key: "knowledge", label: "知识库与检索" },
  { key: "search", label: "联网搜索" },
  { key: "security", label: "内容安全" },
  { key: "skill", label: "技能系统" },
  { key: "browser", label: "浏览器操控" }
]

const activeGroup = ref("general")
const groups = ref<Record<string, SettingItem[]>>({})
const availableModels=ref<{id:string;name:string}[]>([])
const loading = ref(false)
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

async function save() {
  if(saving.value || loading.value)return
  if (dirtyKeys.value.length === 0) {
    toastOk("没有需要保存的修改")
    return
  }

  const invalid = dirtyKeys.value.filter((k) => jsonValid[k] === false)
  if (invalid.length > 0) {
    toastError(new Error(`以下设置项 JSON 格式有误：${invalid.join(", ")}`))
    return
  }

  saving.value = true
  try {
    const payload: Record<string, unknown> = {}
    for (const key of dirtyKeys.value) payload[key] = JSON.parse(JSON.stringify(model[key] ?? null))

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
onMounted(refresh)
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
.setting-tabs :deep(.el-tabs__header) {
  margin-bottom: 14px;
}
.block {
  border-radius: var(--cg-radius);
}
.setting-form {
  max-width: 860px;
}
.label-box {
  display: flex;
  flex-direction: column;
  line-height: 1.4;
}
.label-text {
  font-size: 13.5px;
  color: var(--cg-text);
}
.label-key {
  font-size: 11.5px;
  color: #a6b0c3;
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
  margin-top: 6px;
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
</style>
