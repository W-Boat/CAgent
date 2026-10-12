<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title">技能管理</h2>
        <p class="page-subtitle">
          共 {{ skills.length }} 个技能 · 支持提示词 / 内置工具 / HTTP 接口 / 浏览器自动化四种类型
        </p>
      </div>
      <div class="page-actions">
        <el-button @click="load">
          <el-icon><Refresh /></el-icon> 刷新
        </el-button>
        <el-button :disabled="!auth.can('skill:create')" @click="importVisible = true">
          <el-icon><UploadFilled /></el-icon> 导入技能
        </el-button>
        <el-button type="primary" :disabled="!auth.can('skill:create')" @click="openCreate">
          <el-icon><Plus /></el-icon> 新建技能
        </el-button>
      </div>
    </div>

    <SkillImportDialog v-model="importVisible" @imported="load" />

    <div class="filter-bar">
      <el-input v-model="query.keyword" placeholder="搜索名称 / 标识 / 描述" clearable style="width: 220px" @change="load">
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-select v-model="query.type" placeholder="全部类型" clearable style="width: 140px" @change="load">
        <el-option v-for="t in TYPES" :key="t.value" :label="t.label" :value="t.value" />
      </el-select>
      <el-input v-model="query.category" placeholder="分类" clearable style="width: 140px" @change="load" />
      <el-select v-model="query.enabled" placeholder="全部状态" clearable style="width: 130px" @change="load">
        <el-option label="已启用" value="true" />
        <el-option label="已禁用" value="false" />
      </el-select>
    </div>

    <el-table :data="skills" v-loading="loading" stripe>
      <el-table-column label="技能" min-width="230">
        <template #default="{ row }">
          <div class="skill-cell">
            <SkillAvatar :icon="row.icon" :name="row.name" :seed="row.key" :size="36" />
            <div class="skill-main">
              <div class="skill-name">
                {{ row.name }}
                <el-tag v-if="row.isSystem" size="small" type="warning" effect="plain">内置</el-tag>
              </div>
              <div class="skill-key mono">{{ row.key }}</div>
            </div>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="类型" width="110">
        <template #default="{ row }">
          <el-tag size="small" effect="plain" :type="typeTag(row.type)">{{ typeText(row.type) }}</el-tag>
        </template>
      </el-table-column>

      <el-table-column label="分类" width="110" prop="category" />

      <el-table-column label="描述" min-width="200">
        <template #default="{ row }">
          <span class="muted">{{ truncate(row.description, 60) }}</span>
        </template>
      </el-table-column>

      <el-table-column label="权限码" width="150">
        <template #default="{ row }">
          <span v-if="row.permissionCode" class="mono small">{{ row.permissionCode }}</span>
          <span v-else class="muted">不限制</span>
        </template>
      </el-table-column>

      <el-table-column label="绑定智能体" width="100">
        <template #default="{ row }">{{ row.agentCount ?? 0 }}</template>
      </el-table-column>

      <el-table-column label="运行次数" width="100">
        <template #default="{ row }">{{ formatNumber(row.runCount ?? 0) }}</template>
      </el-table-column>

      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-switch
            :model-value="row.enabled"
            :disabled="!auth.can('skill:update')"
            @change="(v: boolean) => toggleSkill(row, v)"
          />
        </template>
      </el-table-column>

      <el-table-column label="操作" width="230" fixed="right">
        <template #default="{ row }">
          <el-button text type="primary" size="small" @click="openRun(row)">测试</el-button>
          <el-button text type="primary" size="small" :disabled="!auth.can('skill:update')" @click="openEdit(row)">
            编辑
          </el-button>
          <el-button text type="primary" size="small" :disabled="!auth.can('skill:update')" @click="openBind(row)">
            绑定
          </el-button>
          <el-button
            text
            type="danger"
            size="small"
            :disabled="!auth.can('skill:delete') || row.isSystem"
            @click="removeSkill(row)"
          >
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 新建 / 编辑 -->
    <el-dialog
      v-model="editVisible"
      :title="editing ? '编辑技能' : '新建技能'"
      width="760px"
      top="5vh"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-row :gutter="14">
          <el-col :span="12">
            <el-form-item label="技能标识" prop="key">
              <el-input v-model="form.key" :disabled="Boolean(editing)" placeholder="如 campus_weather" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="技能名称" prop="name">
              <el-input v-model="form.name" placeholder="如 校园天气查询" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="技能描述" prop="description">
          <el-input v-model="form.description" type="textarea" :rows="2" placeholder="描述用途，会展示给用户与模型" />
        </el-form-item>

        <el-row :gutter="14">
          <el-col :span="8">
            <el-form-item label="类型" prop="type">
              <el-select v-model="form.type" style="width: 100%">
                <el-option v-for="t in TYPES" :key="t.value" :label="t.label" :value="t.value" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="分类">
              <el-input v-model="form.category" placeholder="如 校园服务" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="图标">
              <div class="icon-field">
                <SkillAvatar
                  :icon="form.icon"
                  :name="form.name"
                  :seed="form.key"
                  :size="32"
                />
                <el-select
                  v-model="form.icon"
                  placeholder="自动生成"
                  clearable
                  filterable
                  allow-create
                  default-first-option
                  style="flex: 1; min-width: 0"
                >
                  <el-option
                    v-for="opt in ICON_OPTIONS"
                    :key="opt.value"
                    :label="opt.label"
                    :value="opt.value"
                  >
                    <span class="icon-opt">
                      <el-icon><component :is="opt.value" /></el-icon>
                      <span>{{ opt.label }}</span>
                    </span>
                  </el-option>
                </el-select>
              </div>
              <div class="field-desc">留空则按名称自动生成配色头像</div>
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="管理备注">
          <el-input
            v-model="form.note"
            type="textarea"
            :rows="2"
            maxlength="2000"
            show-word-limit
            placeholder="适用场景、维护人、复核周期等。仅后台可见，不会进入模型上下文。"
          />
        </el-form-item>

        <el-row :gutter="14">
          <el-col :span="8">
            <el-form-item label="权限码">
              <el-select
                v-model="form.permissionCode"
                placeholder="不限制"
                clearable
                filterable
                style="width: 100%"
              >
                <el-option
                  v-for="p in permissionOptions"
                  :key="p.code"
                  :label="`${p.name}（${p.code}）`"
                  :value="p.code"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="排序">
              <el-input-number v-model="form.sort" :min="0" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="启用">
              <el-switch v-model="form.enabled" />
            </el-form-item>
          </el-col>
        </el-row>

        <!-- 类型化配置 -->
        <el-divider content-position="left">{{ typeText(form.type) }}配置</el-divider>

        <template v-if="form.type === 'PROMPT'">
          <el-form-item label="系统提示词">
            <el-input
              v-model="form.systemPrompt"
              type="textarea"
              :rows="6"
              placeholder="技能注入模型的系统提示词，例如：你是一个校园天气助手……"
            />
          </el-form-item>
        </template>

        <template v-else-if="form.type === 'HTTP'">
          <el-row :gutter="14">
            <el-col :span="16">
              <el-form-item label="请求地址">
                <el-input v-model="httpConfig.url" placeholder="https://api.example.com/weather?city={{city}}" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="请求方法">
                <el-select v-model="httpConfig.method" style="width: 100%">
                  <el-option label="GET" value="GET" />
                  <el-option label="POST" value="POST" />
                  <el-option label="PUT" value="PUT" />
                  <el-option label="DELETE" value="DELETE" />
                </el-select>
              </el-form-item>
            </el-col>
          </el-row>
          <el-form-item label="超时(ms)">
            <el-input-number v-model="httpConfig.timeout" :min="1000" :step="1000" />
            <span class="field-desc">地址与请求体支持双花括号占位符，例如 city 参数写作 city 的花括号包裹形式</span>
          </el-form-item>
          <el-form-item label="请求头">
            <el-input
              v-model="httpHeaders"
              type="textarea"
              :rows="3"
              placeholder='{"Content-Type": "application/json"}'
            />
            <div v-if="httpHeadersError" class="field-error">{{ httpHeadersError }}</div>
          </el-form-item>
          <el-form-item v-if="httpConfig.method !== 'GET'" label="请求体模板">
            <el-input
              v-model="httpConfig.bodyTemplate"
              type="textarea"
              :rows="4"
              placeholder='{"city": "{{city}}"}'
            />
          </el-form-item>
          <el-form-item label="系统提示词">
            <el-input v-model="form.systemPrompt" type="textarea" :rows="2" placeholder="可选：告诉模型如何使用该接口结果" />
          </el-form-item>
        </template>

        <template v-else-if="form.type === 'BROWSER'">
          <el-form-item label="起始地址">
            <el-input v-model="browserConfig.startUrl" placeholder="https://jw.example.edu.cn" />
          </el-form-item>
          <el-form-item label="操作步骤">
            <el-input
              v-model="browserSteps"
              type="textarea"
              :rows="5"
              placeholder='[{"action":"goto","value":"https://..."},{"action":"extract","selector":".score-table"}]'
            />
            <div v-if="browserStepsError" class="field-error">{{ browserStepsError }}</div>
            <div class="field-desc">JSON 数组，每项含 action 及 selector / value</div>
          </el-form-item>
          <el-form-item label="系统提示词">
            <el-input v-model="form.systemPrompt" type="textarea" :rows="2" placeholder="可选：说明抓取内容的含义" />
          </el-form-item>
        </template>

        <template v-else>
          <el-form-item label="内置工具">
            <el-select
              v-model="toolKey"
              placeholder="选择一个内置工具"
              clearable
              filterable
              style="width: 100%"
              @change="onToolChange"
            >
              <el-option-group
                v-for="grp in toolGroups"
                :key="grp.category"
                :label="grp.category"
              >
                <el-option
                  v-for="t in grp.items"
                  :key="t.key"
                  :label="t.name"
                  :value="t.key"
                >
                  <div class="tool-opt">
                    <span class="tool-opt-name">{{ t.name }}</span>
                    <span class="tool-opt-desc">{{ truncate(t.description, 46) }}</span>
                  </div>
                </el-option>
              </el-option-group>
            </el-select>
            <div class="field-desc">
              平台已内置 {{ builtinTools.length }} 个可直接使用的工具，选中后入参 Schema 会自动填好
            </div>
          </el-form-item>

          <div v-if="selectedTool" class="tool-preview">
            <div class="tool-preview-head">
              <SkillAvatar :icon="selectedTool.icon" :name="selectedTool.name" :seed="selectedTool.key" :size="34" />
              <div>
                <div class="tool-preview-name">
                  {{ selectedTool.name }}
                  <el-tag v-if="selectedTool.needsNetwork" size="small" type="warning" effect="plain">
                    需联网
                  </el-tag>
                  <el-tag v-else size="small" type="success" effect="plain">本地可用</el-tag>
                </div>
                <div class="tool-preview-desc">{{ selectedTool.description }}</div>
              </div>
            </div>
            <div v-if="toolParamList.length" class="tool-params">
              <div v-for="p in toolParamList" :key="p.name" class="tool-param">
                <span class="mono">{{ p.name }}</span>
                <el-tag v-if="p.required" size="small" type="danger" effect="plain">必填</el-tag>
                <span class="muted">{{ p.description }}</span>
              </div>
            </div>
            <div v-else class="muted">该工具无需入参</div>
          </div>

          <el-alert
            v-if="builtinTools.length === 0"
            title="未能加载内置工具目录，请确认后端已启动且当前账号有 skill:update 权限。"
            type="warning"
            show-icon
            :closable="false"
            class="tip"
          />

          <el-form-item label="系统提示词">
            <el-input
              v-model="form.systemPrompt"
              type="textarea"
              :rows="2"
              placeholder="可选：告诉模型何时该用这个工具"
            />
          </el-form-item>
        </template>

        <el-form-item label="入参 Schema">
          <el-input
            v-model="inputSchemaText"
            type="textarea"
            :rows="6"
            placeholder='{"type":"object","properties":{"city":{"type":"string","title":"城市"}},"required":["city"]}'
          />
          <div v-if="inputSchemaError" class="field-error">{{ inputSchemaError }}</div>
          <div v-else class="field-desc">JSON Schema，用于渲染运行表单；留空表示无需入参</div>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <!-- 绑定智能体 -->
    <el-dialog v-model="bindVisible" title="绑定智能体" width="520px" destroy-on-close>
      <p class="bind-hint">
        被绑定的智能体在对话中即可调用「{{ binding?.name }}」技能。
      </p>
      <el-checkbox-group v-model="bindAgentIds" class="bind-list">
        <el-checkbox v-for="agent in agents" :key="agent.id" :value="agent.id" class="bind-item">
          <div class="bind-row">
            <el-avatar :size="24" :src="agent.avatar || undefined">
              {{ (agent.name || "A").slice(0, 1) }}
            </el-avatar>
            <span>{{ agent.name }}</span>
            <el-tag v-if="!agent.enabled" size="small" type="info" effect="plain">已禁用</el-tag>
          </div>
        </el-checkbox>
      </el-checkbox-group>
      <el-empty v-if="agents.length === 0" description="暂无智能体" :image-size="70" />
      <template #footer>
        <el-button @click="bindVisible = false">取消</el-button>
        <el-button type="primary" :loading="binding_" @click="saveBind">保存绑定</el-button>
      </template>
    </el-dialog>

    <!-- 测试运行 -->
    <el-dialog v-model="runVisible" :title="`测试运行 · ${testing?.name || ''}`" width="600px" destroy-on-close>
      <el-form v-if="testing && hasParams(testing)" label-width="110px">
        <el-form-item
          v-for="(prop, key) in schemaProps(testing)"
          :key="key"
          :label="String(prop.title || key)"
        >
          <el-select
            v-if="prop.enum?.length"
            v-model="runInput[String(key)]"
            style="width: 100%"
          >
            <el-option v-for="opt in prop.enum" :key="String(opt)" :label="String(opt)" :value="opt" />
          </el-select>
          <el-switch v-else-if="prop.type === 'boolean'" v-model="runInput[String(key)]" />
          <el-input-number
            v-else-if="prop.type === 'number' || prop.type === 'integer'"
            v-model="runInput[String(key)] as number"
            style="width: 100%"
          />
          <el-input v-else v-model="runInput[String(key)] as string" />
        </el-form-item>
      </el-form>
      <el-alert v-else title="该技能无需入参，直接执行即可" type="info" show-icon :closable="false" />

      <div v-if="runResult" class="run-result">
        <el-tag :type="runResult.success ? 'success' : 'danger'" size="small">
          {{ runResult.success ? "执行成功" : "执行失败" }}
        </el-tag>
        <span class="muted">{{ formatDuration(runResult.durationMs) }}</span>
        <el-alert v-if="runResult.error" :title="runResult.error" type="error" show-icon :closable="false" class="tip" />
        <pre v-if="runResult.output !== undefined" class="result-body">{{
          typeof runResult.output === "string" ? runResult.output : JSON.stringify(runResult.output, null, 2)
        }}</pre>
      </div>

      <template #footer>
        <el-button @click="runVisible = false">关闭</el-button>
        <el-button type="primary" :loading="testing_" @click="doTest">执行</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue"
import type { FormInstance, FormRules } from "element-plus"
import { agentsApi, rolesApi, skillsApi } from "@/api"
import { toastError, toastOk } from "@/api/client"
import { useAuthStore } from "@/stores/auth"
import SkillAvatar from "@/components/SkillAvatar.vue"
import SkillImportDialog from "@/components/SkillImportDialog.vue"
import type { AgentItem, BuiltinTool, SkillItem } from "@/api/types"
import { formatDuration, formatNumber, truncate } from "@/utils/format"

/*
 * 声明组件名，供 <keep-alive :include> 匹配（约定与路由 name 一致）。
 * 不声明的话缓存会静默失效：切走再回来仍会重建组件、重新拉数据。
 */
defineOptions({ name: "admin-skills" })

const auth = useAuthStore()

const TYPES = [
  { label: "提示词", value: "PROMPT" },
  { label: "内置工具", value: "TOOL" },
  { label: "HTTP 接口", value: "HTTP" },
  { label: "浏览器", value: "BROWSER" }
]

/** 图标候选：覆盖技能最常用的语义 */
const ICON_OPTIONS = [
  { label: "文档", value: "Document" },
  { label: "搜索", value: "Search" },
  { label: "链接", value: "Link" },
  { label: "显示器", value: "Monitor" },
  { label: "日历", value: "Calendar" },
  { label: "指南针", value: "Guide" },
  { label: "太阳", value: "Sunny" },
  { label: "硬币", value: "Coin" },
  { label: "柱状图", value: "Histogram" },
  { label: "魔法棒", value: "MagicStick" },
  { label: "连接", value: "Connection" },
  { label: "钥匙", value: "Key" },
  { label: "时钟", value: "Clock" },
  { label: "切换", value: "Switch" },
  { label: "票据", value: "Tickets" },
  { label: "星星", value: "Star" },
  { label: "阅读", value: "Reading" },
  { label: "相机", value: "Camera" }
]

const importVisible = ref(false)

const skills = ref<SkillItem[]>([])
const agents = ref<AgentItem[]>([])
const permissionOptions = ref<{ code: string; name: string }[]>([])
const loading = ref(false)

const query = reactive({
  keyword: "",
  type: "",
  category: "",
  enabled: ""
})

const editVisible = ref(false)
const editing = ref<SkillItem | null>(null)
const saving = ref(false)
const formRef = ref<FormInstance>()

const form = reactive({
  key: "",
  name: "",
  description: "",
  type: "TOOL" as SkillItem["type"],
  category: "通用",
  icon: "",
  enabled: true,
  sort: 0,
  systemPrompt: "",
  permissionCode: "",
  note: ""
})

// ---------- 内置工具 ----------
const builtinTools = ref<BuiltinTool[]>([])
/** 当前选中的内置工具 key，保存时写进 config.builtin */
const toolKey = ref("")

const toolGroups = computed(() => {
  const map = new Map<string, BuiltinTool[]>()
  for (const t of builtinTools.value) {
    const list = map.get(t.category) || []
    list.push(t)
    map.set(t.category, list)
  }
  return [...map.entries()].map(([category, items]) => ({ category, items }))
})

const selectedTool = computed(
  () => builtinTools.value.find((t) => t.key === toolKey.value) || null
)

const toolParamList = computed(() => {
  const tool = selectedTool.value
  if (!tool) return []
  return Object.entries(tool.parameters || {}).map(([name, p]) => ({
    name,
    description: p.description,
    required: (tool.required || []).includes(name)
  }))
})

/** 选中内置工具后，自动把入参 Schema 填好，省掉手写 JSON */
function onToolChange(key: string) {
  const tool = builtinTools.value.find((t) => t.key === key)
  if (!tool) return

  if (!form.name) form.name = tool.name
  if (!form.description) form.description = tool.description
  if (!form.icon) form.icon = tool.icon
  if (form.category === "通用") form.category = tool.category

  const properties: Record<string, unknown> = {}
  for (const [name, p] of Object.entries(tool.parameters || {})) {
    properties[name] = {
      type: p.type,
      title: p.description,
      ...(p.enum ? { enum: p.enum } : {}),
      ...(p.default !== undefined ? { default: p.default } : {})
    }
  }
  inputSchemaText.value = JSON.stringify(
    { type: "object", properties, required: tool.required || [] },
    null,
    2
  )
  inputSchemaError.value = ""
}

const httpConfig = reactive({
  url: "",
  method: "GET",
  timeout: 15000,
  bodyTemplate: ""
})
const httpHeaders = ref("{}")
const httpHeadersError = ref("")

const browserConfig = reactive({ startUrl: "" })
const browserSteps = ref("[]")
const browserStepsError = ref("")

const inputSchemaText = ref("")
const inputSchemaError = ref("")

const bindVisible = ref(false)
const binding = ref<SkillItem | null>(null)
const binding_ = ref(false)
const bindAgentIds = ref<string[]>([])

const runVisible = ref(false)
const testing = ref<SkillItem | null>(null)
const testing_ = ref(false)
const runInput = reactive<Record<string, unknown>>({})
const runResult = ref<{ success: boolean; output?: unknown; error?: string; durationMs: number } | null>(null)

const rules: FormRules = {
  key: [
    { required: true, message: "请输入技能标识", trigger: "blur" },
    {
      pattern: /^[a-z][a-z0-9_]*$/,
      message: "只允许小写字母、数字与下划线，且以字母开头",
      trigger: "blur"
    }
  ],
  name: [{ required: true, message: "请输入技能名称", trigger: "blur" }],
  description: [{ required: true, message: "请输入技能描述", trigger: "blur" }]
}

interface SchemaProp {
  type?: string
  title?: string
  enum?: unknown[]
}

function schemaProps(skill: SkillItem): Record<string, SchemaProp> {
  const schema = skill.inputSchema as { properties?: Record<string, SchemaProp> } | null
  return schema?.properties || {}
}

function hasParams(skill: SkillItem) {
  return Object.keys(schemaProps(skill)).length > 0
}

function typeText(type: string) {
  return TYPES.find((t) => t.value === type)?.label || type
}

function typeTag(type: string) {
  if (type === "PROMPT") return "info"
  if (type === "HTTP") return "primary"
  if (type === "BROWSER") return "warning"
  return "success"
}

function validateJson(text: string, label: string): unknown | undefined {
  if (!text.trim()) return undefined
  try {
    return JSON.parse(text)
  } catch {
    toastError(new Error(`${label}不是合法 JSON`))
    return undefined
  }
}

function openCreate() {
  editing.value = null
  Object.assign(form, {
    key: "",
    name: "",
    description: "",
    type: "TOOL",
    category: "通用",
    icon: "",
    enabled: true,
    sort: 0,
    systemPrompt: "",
    permissionCode: "",
    note: ""
  })
  Object.assign(httpConfig, { url: "", method: "GET", timeout: 15000, bodyTemplate: "" })
  httpHeaders.value = "{}"
  browserConfig.startUrl = ""
  browserSteps.value = "[]"
  inputSchemaText.value = ""
  toolKey.value = ""
  clearErrors()
  editVisible.value = true
}

async function openEdit(row: SkillItem) {
  editing.value = row
  Object.assign(form, {
    key: row.key,
    name: row.name,
    description: row.description,
    type: row.type,
    category: row.category,
    icon: row.icon || "",
    enabled: row.enabled,
    sort: row.sort,
    systemPrompt: row.systemPrompt || "",
    permissionCode: row.permissionCode || "",
    note: row.note || ""
  })

  const config = (row.config || {}) as Record<string, any>
  Object.assign(httpConfig, {
    url: config.url || "",
    method: config.method || "GET",
    timeout: config.timeout || 15000,
    bodyTemplate: config.bodyTemplate || ""
  })
  httpHeaders.value = JSON.stringify(config.headers || {}, null, 2)
  browserConfig.startUrl = config.startUrl || ""
  browserSteps.value = JSON.stringify(config.steps || [], null, 2)
  inputSchemaText.value = row.inputSchema ? JSON.stringify(row.inputSchema, null, 2) : ""
  // 已是内置工具的技能，回填所选工具
  toolKey.value = row.type === "TOOL" && typeof config.builtin === "string" ? config.builtin : ""
  clearErrors()
  editVisible.value = true

  // 详情接口会返回已绑定智能体，用于展示（绑定单独弹窗保存）
  try {
    const detail = await skillsApi.detail(row.id)
    const idx = skills.value.findIndex((s) => s.id === row.id)
    if (idx >= 0) skills.value[idx] = { ...skills.value[idx], agents: detail.agents }
  } catch {
    // 详情失败不影响编辑
  }
}

function clearErrors() {
  httpHeadersError.value = ""
  browserStepsError.value = ""
  inputSchemaError.value = ""
}

function buildConfig(): Record<string, unknown> | undefined {
  if (form.type === "HTTP") {
    const config: Record<string, unknown> = {
      url: httpConfig.url.trim(),
      method: httpConfig.method,
      timeout: httpConfig.timeout
    }
    const headers = validateJson(httpHeaders.value, "请求头")
    if (headers) config.headers = headers
    if (httpConfig.method !== "GET" && httpConfig.bodyTemplate.trim()) {
      config.bodyTemplate = httpConfig.bodyTemplate
    }
    return config
  }
  if (form.type === "BROWSER") {
    const steps = validateJson(browserSteps.value, "操作步骤")
    return {
      startUrl: browserConfig.startUrl.trim() || undefined,
      steps: Array.isArray(steps) ? steps : []
    }
  }
  if (form.type === "TOOL") {
    // 内置工具靠 config.builtin 找到实现；不选工具则退化为「提示词 + 模型」型
    return toolKey.value ? { builtin: toolKey.value } : undefined
  }
  return undefined
}

async function save() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  clearErrors()

  if (form.type === "HTTP" && !httpConfig.url.trim()) {
    toastError(new Error("HTTP 技能必须填写请求地址"))
    return
  }

  const config = buildConfig()
  if (form.type === "HTTP" && httpHeaders.value.trim() && !validateJson(httpHeaders.value, "请求头")) {
    httpHeadersError.value = "JSON 格式有误"
    return
  }
  if (form.type === "BROWSER" && !validateJson(browserSteps.value, "操作步骤")) {
    browserStepsError.value = "JSON 格式有误"
    return
  }

  let inputSchema: unknown
  if (inputSchemaText.value.trim()) {
    try {
      inputSchema = JSON.parse(inputSchemaText.value)
    } catch {
      inputSchemaError.value = "JSON Schema 格式有误"
      return
    }
  }

  const payload: Record<string, unknown> = {
    name: form.name.trim(),
    description: form.description.trim(),
    type: form.type,
    category: form.category.trim() || "通用",
    icon: form.icon.trim() || null,
    enabled: form.enabled,
    sort: form.sort,
    systemPrompt: form.systemPrompt.trim() || null,
    permissionCode: form.permissionCode || null,
    note: form.note.trim() || null,
    inputSchema: inputSchema ?? null,
    config: config ?? null
  }

  saving.value = true
  try {
    if (editing.value) {
      await skillsApi.update(editing.value.id, payload)
      toastOk("技能已更新")
    } else {
      await skillsApi.create({ ...payload, key: form.key.trim() })
      toastOk("技能已创建")
    }
    editVisible.value = false
    await load()
  } catch (error) {
    toastError(error)
  } finally {
    saving.value = false
  }
}

async function toggleSkill(row: SkillItem, enabled: boolean) {
  try {
    await skillsApi.toggle(row.id, enabled)
    row.enabled = enabled
    toastOk(enabled ? "技能已启用" : "技能已禁用")
  } catch (error) {
    toastError(error)
  }
}

async function removeSkill(row: SkillItem) {
  try {
    await ElMessageBox.confirm(
      `删除技能「${row.name}」？该操作不可恢复，历史运行记录会一并删除。`,
      "删除技能",
      { type: "warning", confirmButtonText: "删除", cancelButtonText: "取消" }
    )
  } catch {
    return
  }
  try {
    await skillsApi.remove(row.id)
    toastOk("技能已删除")
    await load()
  } catch (error) {
    toastError(error)
  }
}

async function openBind(row: SkillItem) {
  binding.value = row
  bindAgentIds.value = []
  bindVisible.value = true
  try {
    const detail = await skillsApi.detail(row.id)
    bindAgentIds.value = (detail.agents || []).map((a) => a.id)
  } catch (error) {
    toastError(error, "绑定信息加载失败")
  }
}

async function saveBind() {
  if (!binding.value) return
  binding_.value = true
  try {
    await skillsApi.bindAgents(binding.value.id, bindAgentIds.value)
    toastOk("绑定已保存")
    bindVisible.value = false
    await load()
  } catch (error) {
    toastError(error)
  } finally {
    binding_.value = false
  }
}

function openRun(row: SkillItem) {
  testing.value = row
  runResult.value = null
  for (const key of Object.keys(runInput)) delete runInput[key]
  for (const [key, prop] of Object.entries(schemaProps(row))) {
    runInput[key] = prop.type === "boolean" ? false : prop.enum?.length ? prop.enum[0] : ""
  }
  runVisible.value = true
}

async function doTest() {
  if (!testing.value) return
  testing_.value = true
  runResult.value = null
  try {
    const res = await skillsApi.run(testing.value.id, { ...runInput })
    runResult.value = res
    if (res.success) toastOk("执行成功")
    else toastError(new Error(res.error || "执行失败"))
  } catch (error) {
    toastError(error)
  } finally {
    testing_.value = false
  }
}

async function load() {
  loading.value = true
  try {
    skills.value = await skillsApi.list({
      keyword: query.keyword || undefined,
      type: query.type || undefined,
      category: query.category || undefined,
      enabled: query.enabled || undefined
    })
  } catch (error) {
    toastError(error, "技能列表加载失败")
  } finally {
    loading.value = false
  }
}

async function loadMeta() {
  try {
    const [agentList, catalog] = await Promise.all([
      agentsApi.list(),
      rolesApi.permissionCatalog().catch(() => null)
    ])
    agents.value = agentList
    if (catalog) {
      permissionOptions.value = catalog.groups.flatMap((g) =>
        g.permissions.map((p) => ({ code: p.code, name: p.name }))
      )
    }
  } catch {
    // 元数据失败不阻塞主列表
  }

  // 内置工具目录：失败也不阻塞页面，只是 TOOL 型技能选不到工具
  try {
    builtinTools.value = await skillsApi.tools()
  } catch {
    builtinTools.value = []
  }
}

onMounted(async () => {
  await loadMeta()
  await load()
})
</script>

<style scoped>
.filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
}
.skill-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}
.skill-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  font-size: 17px;
  background: var(--cg-brand-soft);
  border-radius: 9px;
  flex-shrink: 0;
}
.skill-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13.5px;
  font-weight: 500;
}
.skill-key {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--cg-text-muted);
}
.small {
  font-size: 12px;
}
.field-desc {
  margin-top: 4px;
  font-size: 12px;
  color: var(--cg-text-muted);
}
.field-error {
  margin-top: 4px;
  font-size: 12px;
  color: #ef4444;
}
.tip {
  margin-top: 8px;
}

/* ---------- 图标选择 ---------- */

.icon-field {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.icon-opt {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* ---------- 内置工具选择 ---------- */

.tool-opt {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.tool-opt-name {
  flex: 0 0 auto;
}

.tool-opt-desc {
  overflow: hidden;
  font-size: 12px;
  color: var(--cg-text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-preview {
  padding: 12px 14px;
  margin-bottom: 14px;
  background: var(--cg-card-bg-soft);
  border: 1px solid var(--cg-border);
  border-radius: 10px;
}

.tool-preview-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.tool-preview-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
}

.tool-preview-desc {
  margin-top: 4px;
  font-size: 12.5px;
  line-height: 1.7;
  color: #4b5563;
}

.tool-params {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--cg-border);
}

.tool-param {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12.5px;
}

.tool-param .mono {
  color: var(--cg-brand);
}
.bind-hint {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--cg-text-muted);
}
.bind-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 340px;
  overflow-y: auto;
}
.bind-item {
  width: 100%;
  height: auto;
  padding: 6px 0;
}
.bind-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.run-result {
  padding-top: 12px;
  margin-top: 14px;
  border-top: 1px solid var(--cg-border);
}
.run-result .muted {
  margin-left: 8px;
  font-size: 12px;
}
.result-body {
  max-height: 300px;
  padding: 12px;
  margin-top: 10px;
  overflow: auto;
  font-size: 12.5px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  background: #0f172a;
  color: #e2e8f0;
  border-radius: 8px;
}
</style>