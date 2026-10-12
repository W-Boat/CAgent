<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title">智能体管理</h2>
        <p class="page-subtitle">
          共 {{ items.length }} 个智能体 · {{ enabledCount }} 个已启用 · 可绑定模型与技能
        </p>
      </div>
      <div class="page-actions">
        <el-button v-permission="'agent:create'" type="primary" @click="openCreate">
          <el-icon><Plus /></el-icon> 新建智能体
        </el-button>
        <el-button @click="load">
          <el-icon><Refresh /></el-icon> 刷新
        </el-button>
      </div>
    </div>

    <div class="filter-bar">
      <el-input
        v-model="query.keyword"
        placeholder="搜索名称 / 标识"
        clearable
        style="width: 220px"
        @keyup.enter="load"
        @clear="load"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-select v-model="query.visibility" placeholder="可见范围" clearable style="width: 150px" @change="load">
        <el-option label="仅创建者" value="PRIVATE" />
        <el-option label="校内可见" value="CAMPUS" />
        <el-option label="公开" value="PUBLIC" />
      </el-select>
      <el-select v-model="query.enabled" placeholder="状态" clearable style="width: 130px" @change="load">
        <el-option label="已启用" value="true" />
        <el-option label="已禁用" value="false" />
      </el-select>
      <el-button type="primary" @click="load">查询</el-button>
    </div>

    <div class="table-card">
      <el-table :data="items" v-loading="loading" stripe>
        <el-table-column label="智能体" min-width="250">
          <template #default="{ row }">
            <div class="agent-cell">
              <el-avatar :size="36" :src="row.avatar || undefined">
                {{ (row.name || "A").slice(0, 1) }}
              </el-avatar>
              <div class="agent-main">
                <div class="agent-name">
                  {{ row.name }}
                  <el-tag v-if="row.isSystem" size="small" type="info" effect="plain">内置</el-tag>
                </div>
                <div class="agent-key mono">{{ row.key }}</div>
              </div>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="描述" min-width="200">
          <template #default="{ row }">
            <span class="muted">{{ truncate(row.description, 46) || "-" }}</span>
          </template>
        </el-table-column>

        <el-table-column label="模型" min-width="150">
          <template #default="{ row }">
            <span>{{ row.model?.name || "跟随默认" }}</span>
          </template>
        </el-table-column>

        <el-table-column label="技能" min-width="200">
          <template #default="{ row }">
            <div class="skill-tags">
              <el-tag v-for="s in row.skills.slice(0, 3)" :key="s.id" size="small" effect="plain">
                {{ s.name }}
              </el-tag>
              <el-tag v-if="row.skills.length > 3" size="small" type="info" effect="plain">
                +{{ row.skills.length - 3 }}
              </el-tag>
              <span v-if="row.skills.length === 0" class="muted">未绑定</span>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="可见范围" width="110">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ visibilityText(row.visibility) }}</el-tag>
          </template>
        </el-table-column>

        <el-table-column label="浏览器" width="90">
          <template #default="{ row }">
            <el-icon v-if="row.allowBrowser" class="ok-icon"><CircleCheck /></el-icon>
            <span v-else class="muted">-</span>
          </template>
        </el-table-column>

        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-switch
              :model-value="row.enabled"
              :disabled="!auth.can('agent:update')"
              @change="(v: any) => toggle(row, Boolean(v))"
            />
          </template>
        </el-table-column>

        <el-table-column label="操作" width="170" fixed="right">
          <template #default="{ row }">
            <el-button v-permission="'agent:read'" text type="primary" size="small" @click="openPreview(row)">
              预览
            </el-button>
            <el-button v-permission="'agent:update'" text type="primary" size="small" @click="openEdit(row)">
              编辑
            </el-button>
            <el-button
              v-permission="'agent:delete'"
              text
              type="danger"
              size="small"
              :disabled="row.isSystem"
              @click="remove(row)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 表单 -->
    <el-dialog
      v-model="formVisible"
      :title="editing ? '编辑智能体' : '新建智能体'"
      width="760px"
      destroy-on-close
      top="6vh"
    >
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="104px">
        <!-- 应用模式：决定要不要给模型工具，放在最前面 -->
        <el-form-item label="应用模式">
          <div class="mode-picker">
            <button
              v-for="m in MODES"
              :key="m.value"
              type="button"
              class="mode-card"
              :class="{ on: form.mode === m.value }"
              @click="form.mode = m.value"
            >
              <span class="mode-icon">
                <el-icon><component :is="m.icon" /></el-icon>
              </span>
              <span class="mode-body">
                <span class="mode-name">{{ m.label }}</span>
                <span class="mode-desc">{{ m.desc }}</span>
              </span>
              <el-icon v-if="form.mode === m.value" class="mode-check"><CircleCheckFilled /></el-icon>
            </button>
          </div>
        </el-form-item>

        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="标识" prop="key">
              <el-input v-model="form.key" :disabled="Boolean(editing)" placeholder="如：campus-assistant" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="名称" prop="name">
              <el-input v-model="form.name" placeholder="如：校园学习助手" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="描述">
          <el-input v-model="form.description" placeholder="一句话说明这个智能体能做什么" />
        </el-form-item>

        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="头像地址">
              <el-input v-model="form.avatar" placeholder="图片 URL，选填" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="绑定模型">
              <el-select v-model="form.modelId" clearable placeholder="留空则跟随系统默认" style="width: 100%">
                <el-option v-for="m in models" :key="m.id" :label="m.name" :value="m.id" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="系统提示词" prop="systemPrompt">
          <el-input
            v-model="form.systemPrompt"
            type="textarea"
            :rows="6"
            placeholder="定义智能体的角色、能力边界与回答风格"
          />
        </el-form-item>

        <el-form-item label="开场白">
          <el-input v-model="form.greeting" type="textarea" :rows="2" placeholder="进入对话时展示的欢迎语，支持 Markdown" />
        </el-form-item>

        <el-form-item label="推荐追问">
          <div class="starters-editor">
            <div v-for="(s, i) in form.starters" :key="i" class="starter-row">
              <el-input v-model="form.starters[i]" placeholder="输入一个推荐问题" />
              <el-button text type="danger" @click="form.starters.splice(i, 1)">
                <el-icon><Delete /></el-icon>
              </el-button>
            </div>
            <el-button text type="primary" @click="form.starters.push('')">
              <el-icon><Plus /></el-icon> 添加一条
            </el-button>
          </div>
        </el-form-item>

        <el-form-item v-if="form.mode === 'AGENT'" label="可调用工具">
          <div class="tool-summary">
            <el-tag type="success" effect="plain" size="small">
              平台内置 {{ builtinToolCount }} 个工具（自动可用）
            </el-tag>
            <span class="tool-hint">
              计算、日期、单位换算、文本处理、天气、汇率、网页抓取等，无需逐个勾选
            </span>
          </div>
        </el-form-item>

        <el-form-item label="绑定技能">
          <el-select v-model="form.skillIds" multiple filterable style="width: 100%" placeholder="选择该智能体可调用的技能">
            <el-option v-for="s in skills" :key="s.id" :label="s.name" :value="s.id">
              <span>{{ s.name }}</span>
              <span class="opt-hint">{{ skillTypeText(s.type) }}</span>
            </el-option>
          </el-select>
          <div class="field-tip">提示词技能按需读取工作流程；可执行技能按权限调用。辛瓜、外卖及资料内容在知识库管理中维护。</div>
        </el-form-item>

        <el-row :gutter="12">
          <el-col :span="8">
            <el-form-item label="温度">
              <el-slider v-model="form.temperature" :min="0" :max="2" :step="0.1" show-input />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="上下文轮数">
              <el-input-number v-model="form.maxContextMessages" :min="2" :max="100" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="工具轮数上限">
              <el-input-number
                v-model="form.maxToolRounds"
                :min="1"
                :max="20"
                :disabled="form.mode === 'CHAT'"
                style="width: 100%"
              />
              <div class="field-tip">最多 {{ form.maxToolRounds }} 轮工具处理，另留 1 轮整理回答；只读结果可在本轮复用。</div>
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
            placeholder="面向谁、维护人、注意事项，仅后台可见"
          />
        </el-form-item>

        <el-form-item label="可见范围">
          <el-radio-group v-model="form.visibility">
            <el-radio value="PRIVATE">仅创建者</el-radio>
            <el-radio value="CAMPUS">校内可见</el-radio>
            <el-radio value="PUBLIC">公开</el-radio>
          </el-radio-group>
        </el-form-item>

        <el-form-item label="其他">
          <el-checkbox v-model="form.enabled">启用</el-checkbox>
          <el-checkbox v-model="form.allowBrowser" :disabled="form.mode === 'CHAT'">
            允许浏览器操作
          </el-checkbox>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="formVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <!-- 预览 -->
    <el-dialog v-model="previewVisible" title="智能体预览" width="640px" destroy-on-close>
      <div v-if="preview" class="preview">
        <div class="preview-head">
          <el-avatar :size="52" :src="preview.avatar || undefined">
            {{ (preview.name || "A").slice(0, 1) }}
          </el-avatar>
          <div>
            <div class="preview-name">{{ preview.name }}</div>
            <div class="muted">{{ preview.description || "暂无描述" }}</div>
          </div>
        </div>

        <div v-if="preview.greeting" class="preview-greeting">{{ preview.greeting }}</div>

        <el-descriptions :column="2" border size="small" class="preview-desc">
          <el-descriptions-item label="模型">{{ preview.model?.name || "跟随默认" }}</el-descriptions-item>
          <el-descriptions-item label="可见范围">{{ visibilityText(preview.visibility) }}</el-descriptions-item>
          <el-descriptions-item label="温度">{{ preview.temperature ?? 0.7 }}</el-descriptions-item>
          <el-descriptions-item label="上下文轮数">{{ preview.maxContextMessages ?? 20 }}</el-descriptions-item>
          <el-descriptions-item label="浏览器操作">
            {{ preview.allowBrowser ? "允许" : "禁止" }}
          </el-descriptions-item>
          <el-descriptions-item label="会话数">{{ preview.conversationCount ?? 0 }}</el-descriptions-item>
        </el-descriptions>

        <h4 class="preview-title">系统提示词</h4>
        <pre class="preview-pre">{{ preview.systemPrompt || "（空）" }}</pre>

        <template v-if="preview.starters?.length">
          <h4 class="preview-title">推荐追问</h4>
          <div class="preview-starters">
            <el-tag v-for="(s, i) in preview.starters" :key="i" effect="plain">{{ s }}</el-tag>
          </div>
        </template>

        <template v-if="preview.skills.length">
          <h4 class="preview-title">绑定技能</h4>
          <div class="preview-starters">
            <el-tag v-for="s in preview.skills" :key="s.id" type="success" effect="plain">
              {{ s.name }}
            </el-tag>
          </div>
        </template>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue"
import type { FormInstance, FormRules } from "element-plus"
import { agentsApi, modelsApi, skillsApi } from "@/api"
import { toastError, toastOk } from "@/api/client"
import { useAuthStore } from "@/stores/auth"
import type { AgentItem, AgentMode, AgentVisibility, ModelItem, SkillItem } from "@/api/types"
import { skillTypeText, truncate, visibilityText } from "@/utils/format"

/*
 * 声明组件名，供 <keep-alive :include> 匹配（约定与路由 name 一致）。
 * 不声明的话缓存会静默失效：切走再回来仍会重建组件、重新拉数据。
 */
defineOptions({ name: "admin-agents" })

const auth = useAuthStore()

const items = ref<AgentItem[]>([])
const models = ref<ModelItem[]>([])
const skills = ref<SkillItem[]>([])
const loading = ref(false)
const saving = ref(false)

const query = reactive({ keyword: "", visibility: "", enabled: "" })

const formVisible = ref(false)
const editing = ref<AgentItem | null>(null)
const formRef = ref<FormInstance>()

const form = reactive({
  key: "",
  name: "",
  description: "",
  avatar: "",
  systemPrompt: "",
  greeting: "",
  starters: [] as string[],
  modelId: "",
  skillIds: [] as string[],
  temperature: 0.7,
  maxContextMessages: 20,
  visibility: "PUBLIC" as AgentVisibility,
  enabled: true,
  allowBrowser: false,
  mode: "AGENT" as AgentMode,
  maxToolRounds: 5,
  note: "",
  sort: 0
})

/** 应用模式（参考 Dify 的「聊天助手 / 智能体」） */
const MODES = [
  {
    value: "CHAT" as AgentMode,
    label: "对话助手",
    desc: "只靠提示词回答，不调用任何工具，答案稳定可控",
    icon: "ChatDotRound"
  },
  {
    value: "AGENT" as AgentMode,
    label: "智能体",
    desc: "模型自主决定调用哪些工具（计算、天气、网页等）",
    icon: "MagicStick"
  }
]

/** 内置工具数量，用于在表单上直观说明「自动可用」 */
const builtinToolCount = ref(0)

const formRules: FormRules = {
  key: [
    { required: true, message: "请输入标识", trigger: "blur" },
    { pattern: /^[a-z][a-z0-9-]{1,63}$/, message: "小写字母开头，可含数字与连字符", trigger: "blur" }
  ],
  name: [{ required: true, message: "请输入名称", trigger: "blur" }],
  systemPrompt: [{ required: true, message: "请输入系统提示词", trigger: "blur" }]
}

const previewVisible = ref(false)
const preview = ref<AgentItem | null>(null)

const enabledCount = computed(() => items.value.filter((a) => a.enabled).length)

async function load() {
  loading.value = true
  try {
    items.value = await agentsApi.list({
      keyword: query.keyword || undefined,
      visibility: query.visibility || undefined,
      enabled: query.enabled || undefined
    })
  } catch (error) {
    toastError(error, "智能体列表加载失败")
  } finally {
    loading.value = false
  }
}

async function loadMeta() {
  const [modelList, skillList, toolList] = await Promise.all([
    modelsApi.list({ enabled: "true" }).catch(() => [] as ModelItem[]),
    skillsApi.list().catch(() => [] as SkillItem[]),
    skillsApi.tools().catch(() => [])
  ])
  models.value = modelList
  skills.value = skillList
  builtinToolCount.value = toolList.length
}

function openCreate() {
  editing.value = null
  Object.assign(form, {
    key: "",
    name: "",
    description: "",
    avatar: "",
    systemPrompt: "",
    greeting: "",
    starters: [],
    modelId: "",
    skillIds: [],
    temperature: 0.7,
    maxContextMessages: 20,
    visibility: "PUBLIC",
    enabled: true,
    allowBrowser: false,
    mode: "AGENT",
    maxToolRounds: 5,
    note: "",
    sort: items.value.length
  })
  formVisible.value = true
}

function openEdit(row: AgentItem) {
  editing.value = row
  Object.assign(form, {
    key: row.key,
    name: row.name,
    description: row.description || "",
    avatar: row.avatar || "",
    systemPrompt: row.systemPrompt || "",
    greeting: row.greeting || "",
    starters: [...(row.starters || [])],
    modelId: row.modelId || "",
    skillIds: row.skills.map((s) => s.id),
    temperature: row.temperature ?? 0.7,
    maxContextMessages: row.maxContextMessages ?? 20,
    visibility: row.visibility,
    enabled: row.enabled ?? true,
    allowBrowser: row.allowBrowser ?? false,
    // 老数据没有 mode 字段，按 AGENT 处理（与数据库默认值一致）
    mode: row.mode ?? "AGENT",
    maxToolRounds: row.maxToolRounds ?? 5,
    note: row.note || "",
    sort: row.sort ?? 0
  })
  formVisible.value = true
}

async function save() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  saving.value = true
  try {
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      description: form.description || null,
      avatar: form.avatar || null,
      systemPrompt: form.systemPrompt,
      greeting: form.greeting || null,
      starters: form.starters.map((s) => s.trim()).filter(Boolean),
      modelId: form.modelId || null,
      skillIds: form.skillIds,
      temperature: form.temperature,
      maxContextMessages: form.maxContextMessages,
      visibility: form.visibility,
      enabled: form.enabled,
      allowBrowser: form.allowBrowser,
      mode: form.mode,
      maxToolRounds: form.maxToolRounds,
      note: form.note.trim() || null,
      sort: form.sort
    }
    if (editing.value) {
      await agentsApi.update(editing.value.id, payload)
      toastOk("智能体已更新")
    } else {
      await agentsApi.create({ ...payload, key: form.key.trim() })
      toastOk("智能体已创建")
    }
    formVisible.value = false
    await load()
  } catch (error) {
    toastError(error)
  } finally {
    saving.value = false
  }
}

async function toggle(row: AgentItem, enabled: boolean) {
  try {
    await agentsApi.toggle(row.id, enabled)
    row.enabled = enabled
    toastOk(enabled ? "已启用" : "已禁用")
  } catch (error) {
    toastError(error)
  }
}

async function remove(row: AgentItem) {
  try {
    await ElMessageBox.confirm(
      `删除智能体「${row.name}」？已有 ${row.conversationCount ?? 0} 个会话关联，删除后这些会话将失去智能体配置。`,
      "删除智能体",
      { type: "warning", confirmButtonText: "删除", cancelButtonText: "取消" }
    )
  } catch {
    return
  }
  try {
    await agentsApi.remove(row.id)
    ElMessage.success("智能体已删除")
    await load()
  } catch (error) {
    toastError(error)
  }
}

function openPreview(row: AgentItem) {
  preview.value = row
  previewVisible.value = true
}

onMounted(async () => {
  await loadMeta()
  await load()
})
</script>

<style scoped>
.agent-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}
.agent-main {
  min-width: 0;
}
.agent-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13.5px;
  font-weight: 500;
}
.agent-key {
  margin-top: 2px;
  font-size: 12px;
  color: var(--cg-text-muted);
}
.skill-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.ok-icon {
  color: var(--el-color-success);
}
.starters-editor {
  width: 100%;
}
.starter-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.opt-hint {
  float: right;
  margin-left: 12px;
  font-size: 11.5px;
  color: var(--cg-text-muted);
}

/* ---------- 应用模式选择 ---------- */

.mode-picker {
  display: flex;
  gap: 10px;
  width: 100%;
}

.mode-card {
  position: relative;
  display: flex;
  flex: 1;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
  padding: 12px 14px;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  background: var(--cg-card-bg);
  border: 1.5px solid var(--cg-border);
  border-radius: 10px;
  transition: border-color 0.16s ease, background 0.16s ease, transform 0.14s ease;
}

.mode-card:hover {
  border-color: #bfd3f7;
  transform: translateY(-1px);
}

.mode-card.on {
  background: var(--cg-brand-soft);
  border-color: var(--cg-brand);
}

.mode-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  font-size: 16px;
  color: var(--cg-brand);
  background: rgba(37, 99, 235, 0.1);
  border-radius: 8px;
}

.mode-body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.mode-name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--cg-text);
}

.mode-desc {
  font-size: 12px;
  line-height: 1.55;
  color: var(--cg-text-muted);
}

.mode-check {
  position: absolute;
  top: 8px;
  right: 8px;
  font-size: 15px;
  color: var(--cg-brand);
}

.tool-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.tool-hint {
  font-size: 12px;
  color: var(--cg-text-muted);
}

.field-tip {
  margin-top: 4px;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--cg-text-muted);
}
.preview-head {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 14px;
}
.preview-name {
  font-size: 16px;
  font-weight: 600;
}
.preview-greeting {
  padding: 10px 14px;
  margin-bottom: 14px;
  font-size: 13.5px;
  background: var(--cg-brand-soft);
  border-radius: 8px;
}
.preview-desc {
  margin-bottom: 6px;
}
.preview-title {
  margin: 18px 0 8px;
  font-size: 14px;
  font-weight: 600;
}
.preview-pre {
  max-height: 240px;
  padding: 12px;
  overflow: auto;
  font-size: 12.5px;
  line-height: 1.7;
  white-space: pre-wrap;
  background: var(--cg-card-bg-soft);
  border-radius: 8px;
}
.preview-starters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
</style>
