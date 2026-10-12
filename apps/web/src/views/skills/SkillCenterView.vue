<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title">技能中心</h2>
        <p class="page-subtitle">
          共 {{ skills.length }} 个可用技能 · 点击卡片直接运行，或粘贴 JSON 入参手动调用
        </p>
      </div>
      <div class="page-actions">
        <el-button @click="load">
          <el-icon><Refresh /></el-icon> 刷新
        </el-button>
        <el-button @click="historyVisible = true">
          <el-icon><Tickets /></el-icon> 我的运行记录
        </el-button>
      </div>
    </div>

    <div class="filter-bar">
      <el-input
        v-model="keyword"
        placeholder="搜索技能名称或用途"
        clearable
        style="width: 240px"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-radio-group v-model="typeFilter" size="small">
        <el-radio-button value="">全部</el-radio-button>
        <el-radio-button v-for="t in TYPES" :key="t.value" :value="t.value">
          {{ t.label }}
        </el-radio-button>
      </el-radio-group>
    </div>

    <el-row :gutter="14" v-loading="loading">
      <el-col
        v-for="skill in filtered"
        :key="skill.id"
        :xs="24"
        :sm="12"
        :lg="8"
        :xl="6"
      >
        <el-card shadow="never" class="skill-card">
          <div class="sc-head">
            <SkillAvatar :icon="skill.icon" :name="skill.name" :seed="skill.key" :size="40" />
            <div class="sc-title">
              <div class="sc-name">{{ skill.name }}</div>
              <div class="sc-key mono">{{ skill.key }}</div>
            </div>
          </div>

          <div class="sc-tags">
            <el-tag size="small" effect="plain">{{ typeText(skill.type) }}</el-tag>
            <el-tag size="small" type="info" effect="plain">{{ skill.category }}</el-tag>
          </div>

          <p class="sc-desc">{{ skill.description }}</p>

          <div class="sc-foot">
            <span class="sc-hint">
              <template v-if="skill.type === 'PROMPT'">提示词型，对话中自动生效</template>
              <template v-else-if="hasParams(skill)">
                {{ Object.keys(schemaProps(skill)).length }} 个入参
              </template>
              <template v-else>无需入参，可直接运行</template>
            </span>
            <el-button
              v-if="skill.type !== 'PROMPT'"
              type="primary"
              size="small"
              :disabled="!auth.can('skill:run')"
              @click="openRun(skill)"
            >
              <el-icon><CaretRight /></el-icon> 运行
            </el-button>
            <el-button v-else size="small" @click="router.push('/chat')">
              去对话
            </el-button>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-empty v-if="!loading && filtered.length === 0" description="没有匹配的技能" />

    <!-- 运行面板 -->
    <el-drawer v-model="runVisible" :title="running?.name || '运行技能'" size="560px">
      <div v-if="running" class="run-panel">
        <div class="run-head">
          <SkillAvatar :icon="running.icon" :name="running.name" :seed="running.key" :size="44" />
          <div>
            <div class="run-name">{{ running.name }}</div>
            <div class="muted">{{ running.description }}</div>
          </div>
        </div>

        <el-alert
          v-if="running.type === 'HTTP'"
          title="该技能会请求外部 HTTP 接口，请确认入参正确"
          type="info"
          show-icon
          :closable="false"
          class="run-alert"
        />
        <el-alert
          v-else-if="running.type === 'BROWSER'"
          title="该技能会驱动无头浏览器访问网页并抓取内容"
          type="warning"
          show-icon
          :closable="false"
          class="run-alert"
        />

        <el-form v-if="hasParams(running)" label-width="110px" class="run-form">
          <el-form-item
            v-for="(prop, key) in schemaProps(running)"
            :key="key"
            :label="String(prop.title || key)"
            :required="isRequired(running, String(key))"
          >
            <el-input
              v-if="prop.enum?.length"
              :model-value="String(runInput[String(key)] ?? '')"
              readonly
              @click="void 0"
            />
            <el-select
              v-if="prop.enum?.length"
              v-model="runInput[String(key)]"
              style="width: 100%"
            >
              <el-option v-for="opt in prop.enum" :key="String(opt)" :label="String(opt)" :value="opt" />
            </el-select>

            <el-switch
              v-else-if="prop.type === 'boolean'"
              v-model="runInput[String(key)]"
            />

            <el-input-number
              v-else-if="prop.type === 'number' || prop.type === 'integer'"
              v-model="runInput[String(key)] as number"
              style="width: 100%"
            />

            <el-input
              v-else
              v-model="runInput[String(key)] as string"
              :type="prop.type === 'string' && (prop.maxLength ?? 0) > 120 ? 'textarea' : 'text'"
              :rows="3"
              :placeholder="String(prop.description || '')"
            />

            <div v-if="prop.description" class="field-desc">{{ prop.description }}</div>
          </el-form-item>
        </el-form>
        <div v-else class="no-param">该技能无需入参</div>

        <div class="run-actions">
          <el-button type="primary" :loading="running_" @click="doRun">
            <el-icon><CaretRight /></el-icon> 执行
          </el-button>
          <el-button @click="runVisible = false">关闭</el-button>
          <el-button text @click="toggleRaw">
            {{ rawMode ? "使用表单" : "编辑原始 JSON" }}
          </el-button>
        </div>

        <el-input
          v-if="rawMode"
          v-model="rawInput"
          type="textarea"
          :rows="6"
          class="raw-editor"
          placeholder="{}"
        />

        <div v-if="result" class="run-result">
          <div class="result-head">
            <el-tag :type="result.success ? 'success' : 'danger'" size="small">
              {{ result.success ? "执行成功" : "执行失败" }}
            </el-tag>
            <span class="muted">{{ formatDuration(result.durationMs) }}</span>
            <el-button
              v-if="result.output"
              text
              size="small"
              @click="copyOutput"
            >
              <el-icon><CopyDocument /></el-icon> 复制
            </el-button>
          </div>
          <el-alert
            v-if="result.error"
            :title="result.error"
            type="error"
            show-icon
            :closable="false"
          />
          <pre v-if="result.output !== undefined" class="result-body">{{
            typeof result.output === "string" ? result.output : JSON.stringify(result.output, null, 2)
          }}</pre>
        </div>
      </div>
    </el-drawer>

    <!-- 运行记录 -->
    <el-drawer v-model="historyVisible" title="我的技能运行记录" size="640px">
      <el-table :data="history" v-loading="historyLoading" size="small">
        <el-table-column label="技能" min-width="140">
          <template #default="{ row }">{{ row.skill?.name || "-" }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ statusText(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="耗时" width="90">
          <template #default="{ row }">{{ formatDuration(row.durationMs) }}</template>
        </el-table-column>
        <el-table-column label="时间" width="160">
          <template #default="{ row }">{{ formatDateTime(row.startedAt) }}</template>
        </el-table-column>
        <el-table-column label="" width="70">
          <template #default="{ row }">
            <el-button text type="primary" size="small" @click="showRun(row)">详情</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-model:current-page="historyPage"
        :page-size="20"
        :total="historyTotal"
        layout="prev, pager, next"
        background
        class="history-pager"
        @current-change="loadHistory"
      />

      <el-dialog v-model="runDetailVisible" title="运行详情" width="600px" append-to-body>
        <div v-if="runDetail">
          <el-descriptions :column="1" border size="small">
            <el-descriptions-item label="技能">{{ runDetail.skill?.name }}</el-descriptions-item>
            <el-descriptions-item label="状态">
              <el-tag :type="statusType(runDetail.status)" size="small">
                {{ statusText(runDetail.status) }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="耗时">{{ formatDuration(runDetail.durationMs) }}</el-descriptions-item>
            <el-descriptions-item label="开始">{{ formatDateTime(runDetail.startedAt) }}</el-descriptions-item>
            <el-descriptions-item label="结束">{{ formatDateTime(runDetail.finishedAt) }}</el-descriptions-item>
          </el-descriptions>
          <h4 class="detail-title">入参</h4>
          <pre class="result-body">{{ JSON.stringify(runDetail.input, null, 2) }}</pre>
          <template v-if="runDetail.output">
            <h4 class="detail-title">输出</h4>
            <pre class="result-body">{{
              typeof runDetail.output === "string"
                ? runDetail.output
                : JSON.stringify(runDetail.output, null, 2)
            }}</pre>
          </template>
          <el-alert
            v-if="runDetail.error"
            :title="runDetail.error"
            type="error"
            show-icon
            :closable="false"
            class="detail-alert"
          />
        </div>
      </el-dialog>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue"
import { useRouter } from "vue-router"
import { skillsApi } from "@/api"
import { toastError, toastOk } from "@/api/client"
import SkillAvatar from "@/components/SkillAvatar.vue"
import { useAuthStore } from "@/stores/auth"
import type { SkillItem, SkillRun } from "@/api/types"
import {
  copyText,
  formatDateTime,
  formatDuration,
  statusText,
  statusType
} from "@/utils/format"

/*
 * 声明组件名，供 <keep-alive :include> 匹配（约定与路由 name 一致）。
 * 不声明的话缓存会静默失效：切走再回来仍会重建组件、重新拉数据。
 */
defineOptions({ name: "skills" })

const auth = useAuthStore()
const router = useRouter()

const TYPES = [
  { label: "内置工具", value: "TOOL" },
  { label: "HTTP 接口", value: "HTTP" },
  { label: "浏览器", value: "BROWSER" },
  { label: "提示词", value: "PROMPT" }
]

const skills = ref<SkillItem[]>([])
const loading = ref(false)
const keyword = ref("")
const typeFilter = ref("")

const runVisible = ref(false)
const running = ref<SkillItem | null>(null)
const running_ = ref(false)
const runInput = reactive<Record<string, unknown>>({})
const rawMode = ref(false)
const rawInput = ref("{}")
const result = ref<{ success: boolean; output?: unknown; error?: string; durationMs: number } | null>(null)

const historyVisible = ref(false)
const history = ref<SkillRun[]>([])
const historyLoading = ref(false)
const historyPage = ref(1)
const historyTotal = ref(0)

const runDetailVisible = ref(false)
const runDetail = ref<SkillRun | null>(null)

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return skills.value.filter((s) => {
    if (typeFilter.value && s.type !== typeFilter.value) return false
    if (!kw) return true
    return (
      s.name.toLowerCase().includes(kw) ||
      s.key.toLowerCase().includes(kw) ||
      (s.description || "").toLowerCase().includes(kw)
    )
  })
})

function typeText(type: string) {
  return TYPES.find((t) => t.value === type)?.label || type
}

interface SchemaProp {
  type?: string
  title?: string
  description?: string
  enum?: unknown[]
  maxLength?: number
}

function schemaProps(skill: SkillItem): Record<string, SchemaProp> {
  const schema = skill.inputSchema as { properties?: Record<string, SchemaProp> } | null
  return schema?.properties || {}
}

function isRequired(skill: SkillItem, key: string) {
  const schema = skill.inputSchema as { required?: string[] } | null
  return Boolean(schema?.required?.includes(key))
}

function hasParams(skill: SkillItem) {
  return Object.keys(schemaProps(skill)).length > 0
}

function openRun(skill: SkillItem) {
  running.value = skill
  result.value = null
  rawMode.value = false
  for (const key of Object.keys(runInput)) delete runInput[key]
  for (const [key, prop] of Object.entries(schemaProps(skill))) {
    runInput[key] = prop.type === "boolean" ? false : prop.enum?.length ? prop.enum[0] : ""
  }
  rawInput.value = JSON.stringify(runInput, null, 2)
  runVisible.value = true
}

function toggleRaw() {
  if (!rawMode.value) {
    rawInput.value = JSON.stringify(runInput, null, 2)
    rawMode.value = true
  } else {
    try {
      const parsed = JSON.parse(rawInput.value || "{}")
      for (const key of Object.keys(runInput)) delete runInput[key]
      Object.assign(runInput, parsed)
      rawMode.value = false
    } catch {
      toastError(new Error("JSON 格式有误，无法切换回表单"))
    }
  }
}

async function doRun() {
  if (!running.value) return

  let payload: Record<string, unknown>
  if (rawMode.value) {
    try {
      payload = JSON.parse(rawInput.value || "{}")
    } catch {
      toastError(new Error("入参 JSON 格式有误"))
      return
    }
  } else {
    payload = { ...runInput }
  }

  running_.value = true
  result.value = null
  try {
    const res = await skillsApi.run(running.value.id, payload)
    result.value = res
    if (res.success) toastOk("技能执行成功")
    else toastError(new Error(res.error || "技能执行失败"))
  } catch (error) {
    toastError(error)
  } finally {
    running_.value = false
  }
}

async function copyOutput() {
  if (!result.value?.output) return
  const text =
    typeof result.value.output === "string"
      ? result.value.output
      : JSON.stringify(result.value.output, null, 2)
  await copyText(text)
  toastOk("输出已复制")
}

async function load() {
  loading.value = true
  try {
    skills.value = await skillsApi.available()
  } catch (error) {
    toastError(error, "技能列表加载失败")
  } finally {
    loading.value = false
  }
}

async function loadHistory() {
  historyLoading.value = true
  try {
    const page = await skillsApi.myRuns({ page: historyPage.value, pageSize: 20 })
    history.value = page.items
    historyTotal.value = page.total
  } catch (error) {
    toastError(error, "运行记录加载失败")
  } finally {
    historyLoading.value = false
  }
}

function showRun(row: SkillRun) {
  runDetail.value = row
  runDetailVisible.value = true
}

onMounted(async () => {
  await load()
  await loadHistory()
})
</script>

<style scoped>
.skill-card {
  margin-bottom: 14px;
  border-radius: var(--cg-radius);
  height: 100%;
}
.sc-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.sc-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  font-size: 20px;
  background: var(--cg-brand-soft);
  border-radius: 10px;
}
.sc-title {
  min-width: 0;
}
.sc-name {
  font-size: 14.5px;
  font-weight: 600;
}
.sc-key {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--cg-text-muted);
}
.sc-tags {
  display: flex;
  gap: 6px;
  margin: 12px 0 8px;
}
.sc-desc {
  margin: 0;
  min-height: 54px;
  font-size: 12.8px;
  line-height: 1.65;
  color: var(--cg-text-muted);
}
.sc-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--cg-border);
}
.sc-hint {
  font-size: 12px;
  color: var(--cg-text-muted);
}
.run-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.run-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  font-size: 22px;
  background: var(--cg-brand-soft);
  border-radius: 12px;
}
.run-name {
  font-size: 15px;
  font-weight: 600;
}
.run-alert {
  margin-bottom: 14px;
}
.run-form {
  margin-bottom: 4px;
}
.no-param {
  padding: 14px;
  margin-bottom: 14px;
  font-size: 13px;
  color: var(--cg-text-muted);
  background: var(--cg-card-bg-soft);
  border-radius: 8px;
}
.field-desc {
  margin-top: 4px;
  font-size: 12px;
  color: var(--cg-text-muted);
}
.run-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 0 12px;
}
.raw-editor {
  margin-bottom: 14px;
}
.run-result {
  padding-top: 14px;
  border-top: 1px solid var(--cg-border);
}
.result-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.result-body {
  max-height: 380px;
  padding: 12px;
  margin-top: 8px;
  overflow: auto;
  font-size: 12.5px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  background: #0f172a;
  color: #e2e8f0;
  border-radius: 8px;
}
.history-pager {
  margin-top: 14px;
  justify-content: flex-end;
}
.detail-title {
  margin: 16px 0 8px;
  font-size: 13.5px;
  font-weight: 600;
}
.detail-alert {
  margin-top: 12px;
}
</style>