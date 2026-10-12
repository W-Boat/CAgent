<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title">模型配置</h2>
        <p class="page-subtitle">
          共 {{ items.length }} 个模型，其中 {{ enabledCount }} 个可用 ·
          默认模型：{{ defaultModel?.name || "未设置" }}
        </p>
      </div>
      <div class="page-actions">
        <el-button v-permission="'model:write'" type="primary" :disabled="providers.length === 0" @click="openCreate">
          <el-icon><Plus /></el-icon> 新增模型
        </el-button>
        <el-button @click="load">
          <el-icon><Refresh /></el-icon> 刷新
        </el-button>
      </div>
    </div>

    <el-alert
      v-if="providers.length === 0"
      title="请先在「模型供应商」中新增并配置供应商，然后再添加模型"
      type="warning"
      show-icon
      :closable="false"
      class="tip-alert"
    />

    <div class="filter-bar">
      <el-input
        v-model="query.keyword"
        placeholder="搜索模型名称或标识"
        clearable
        style="width: 220px"
        @keyup.enter="load"
        @clear="load"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-select
        v-model="query.providerId"
        placeholder="全部供应商"
        clearable
        style="width: 180px"
        @change="load"
      >
        <el-option v-for="p in providers" :key="p.id" :label="p.name" :value="p.id" />
      </el-select>
      <el-select v-model="query.enabled" placeholder="全部状态" clearable style="width: 140px" @change="load">
        <el-option label="已启用" value="true" />
        <el-option label="已禁用" value="false" />
      </el-select>
      <el-button type="primary" @click="load">查询</el-button>
      <el-button @click="resetQuery">重置</el-button>
    </div>

    <div class="table-card">
      <el-table :data="items" v-loading="loading" stripe>
        <el-table-column label="模型" min-width="230">
          <template #default="{ row }">
            <div class="model-cell">
              <div class="model-name">
                {{ row.name }}
                <el-tag v-if="row.isDefault" size="small" type="success" effect="plain">默认</el-tag>
              </div>
              <div class="model-key mono">{{ row.key }}</div>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="供应商" min-width="160">
          <template #default="{ row }">
            <div class="prov-cell">
              <span>{{ row.provider?.name || row.providerName || "-" }}</span>
              <el-tag
                v-if="row.provider && !row.provider.enabled"
                size="small"
                type="danger"
                effect="plain"
              >
                供应商已禁用
              </el-tag>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="能力" min-width="190">
          <template #default="{ row }">
            <div class="cap-cell">
              <el-tag v-if="row.supportsVision" size="small" effect="plain">视觉</el-tag>
              <el-tag v-if="row.supportsTools" size="small" type="warning" effect="plain">工具</el-tag>
              <el-tag v-if="row.supportsStream" size="small" type="info" effect="plain">流式</el-tag>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="上下文" width="110">
          <template #default="{ row }">
            <span class="mono">{{ compactNumber(row.contextWindow) }}</span>
          </template>
        </el-table-column>

        <el-table-column label="价格（$/M）" width="150">
          <template #default="{ row }">
            <div class="price-cell">
              <span>入 {{ row.inputPricePerM }}</span>
              <span>出 {{ row.outputPricePerM }}</span>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="状态" width="130">
          <template #default="{ row }">
            <el-tag v-if="row.available" type="success" size="small">可用</el-tag>
            <el-tag v-else-if="!row.enabled" type="info" size="small">已禁用</el-tag>
            <el-tag v-else type="warning" size="small">供应商禁用</el-tag>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="230" fixed="right">
          <template #default="{ row }">
            <el-button
              v-permission="'model:test'"
              text
              type="primary"
              size="small"
              @click="openTest(row)"
            >
              测试
            </el-button>
            <el-button v-permission="'model:write'" text type="primary" size="small" @click="openEdit(row)">
              编辑
            </el-button>
            <el-dropdown trigger="click" @command="(c: string) => onCommand(c, row)">
              <el-button text size="small">更多<el-icon><ArrowDown /></el-icon></el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item v-if="auth.can('model:write')" command="toggle">
                    <el-icon><SwitchButton /></el-icon>
                    {{ row.enabled ? "禁用模型" : "启用模型" }}
                  </el-dropdown-item>
                  <el-dropdown-item
                    v-if="auth.can('model:write')"
                    command="default"
                    :disabled="row.isDefault"
                  >
                    <el-icon><Select /></el-icon>设为默认
                  </el-dropdown-item>
                  <el-dropdown-item v-if="auth.can('model:delete')" command="delete" divided>
                    <el-icon><Delete /></el-icon>删除模型
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 新建 / 编辑 -->
    <el-dialog
      v-model="formVisible"
      :title="editing ? '编辑模型' : '新增模型'"
      width="680px"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="112px">
        <el-form-item label="所属供应商" prop="providerId">
          <el-select v-model="form.providerId" style="width: 100%" placeholder="选择供应商">
            <el-option v-for="p in providers" :key="p.id" :label="p.name" :value="p.id" />
          </el-select>
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="模型标识" prop="key">
              <el-input v-model="form.key" placeholder="如：deepseek-chat" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="显示名称" prop="name">
              <el-input v-model="form.name" placeholder="如：DeepSeek Chat" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="上下文窗口">
              <el-input-number v-model="form.contextWindow" :min="0" :step="4096" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="最大输出">
              <el-input-number v-model="form.maxOutputTokens" :min="0" :step="1024" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="输入价格">
              <el-input-number v-model="form.inputPricePerM" :min="0" :precision="4" :step="0.1" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="输出价格">
              <el-input-number v-model="form.outputPricePerM" :min="0" :precision="4" :step="0.1" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <div class="form-hint">价格单位为美元 / 百万 Token，用于用量费用估算</div>

        <el-form-item label="能力支持">
          <el-checkbox v-model="form.supportsStream">流式输出</el-checkbox>
          <el-checkbox v-model="form.supportsTools">函数调用</el-checkbox>
          <el-checkbox v-model="form.supportsVision">图片理解</el-checkbox>
        </el-form-item>

        <el-form-item label="其他">
          <el-checkbox v-model="form.enabled">启用该模型</el-checkbox>
          <el-checkbox v-model="form.isDefault">设为系统默认模型</el-checkbox>
        </el-form-item>

        <el-form-item label="排序">
          <el-input-number v-model="form.sort" :min="0" />
        </el-form-item>

        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="2" placeholder="选填" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="formVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <!-- 连通性测试 -->
    <el-dialog v-model="testVisible" title="模型连通性测试" width="560px" destroy-on-close>
      <div class="test-head">
        <span class="test-model">{{ testTarget?.name }}</span>
        <span class="mono muted">{{ testTarget?.key }}</span>
      </div>
      <el-form label-width="72px">
        <el-form-item label="提示词">
          <el-input
            v-model="testPrompt"
            type="textarea"
            :rows="2"
            placeholder="例如：用一句话介绍你自己"
          />
        </el-form-item>
      </el-form>

      <el-button type="primary" :loading="testing" @click="runTest">
        <el-icon><Promotion /></el-icon> 发送测试请求
      </el-button>

      <div v-if="testResult" class="test-result">
        <el-alert
          v-if="testResult.ok"
          :title="`连通正常 · ${testResult.provider} / ${testResult.model} · ${testResult.latencyMs} ms`"
          type="success"
          show-icon
          :closable="false"
        />
        <el-alert v-else :title="testResult.error || '请求失败'" type="error" show-icon :closable="false" />

        <div v-if="testResult.reply" class="test-reply">
          <div class="test-reply-label">模型回复</div>
          <div class="test-reply-body">{{ testResult.reply }}</div>
        </div>

        <div v-if="testResult.usage" class="test-usage">
          输入 {{ testResult.usage.promptTokens }} · 输出
          {{ testResult.usage.completionTokens }} · 合计
          {{ testResult.usage.totalTokens }} tokens
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue"
import type { FormInstance, FormRules } from "element-plus"
import { modelsApi, providersApi } from "@/api"
import { toastError, toastOk } from "@/api/client"
import { useAuthStore } from "@/stores/auth"
import type { ModelItem, ProviderItem, TestModelResult } from "@/api/types"
import { compactNumber } from "@/utils/format"

/*
 * 声明组件名，供 <keep-alive :include> 匹配（约定与路由 name 一致）。
 * 不声明的话缓存会静默失效：切走再回来仍会重建组件、重新拉数据。
 */
defineOptions({ name: "admin-models" })

const auth = useAuthStore()

const items = ref<ModelItem[]>([])
const providers = ref<ProviderItem[]>([])
const loading = ref(false)
const saving = ref(false)

const query = reactive({ keyword: "", providerId: "", enabled: "" })

const formVisible = ref(false)
const editing = ref<ModelItem | null>(null)
const formRef = ref<FormInstance>()

const form = reactive({
  providerId: "",
  key: "",
  name: "",
  contextWindow: 8192,
  maxOutputTokens: 4096,
  inputPricePerM: 0,
  outputPricePerM: 0,
  supportsStream: true,
  supportsTools: false,
  supportsVision: false,
  enabled: true,
  isDefault: false,
  sort: 0,
  description: ""
})

const formRules: FormRules = {
  providerId: [{ required: true, message: "请选择供应商", trigger: "change" }],
  key: [{ required: true, message: "请输入模型标识", trigger: "blur" }],
  name: [{ required: true, message: "请输入显示名称", trigger: "blur" }]
}

const testVisible = ref(false)
const testing = ref(false)
const testTarget = ref<ModelItem | null>(null)
const testPrompt = ref("用一句话介绍你自己")
const testResult = ref<TestModelResult | null>(null)

const enabledCount = computed(() => items.value.filter((m) => m.available).length)
const defaultModel = computed(() => items.value.find((m) => m.isDefault) || null)

async function loadProviders() {
  try {
    providers.value = await providersApi.list()
  } catch (error) {
    toastError(error, "供应商加载失败")
  }
}

async function load() {
  loading.value = true
  try {
    items.value = await modelsApi.list({
      keyword: query.keyword || undefined,
      providerId: query.providerId || undefined,
      enabled: query.enabled || undefined
    })
  } catch (error) {
    toastError(error, "模型列表加载失败")
  } finally {
    loading.value = false
  }
}

function resetQuery() {
  query.keyword = ""
  query.providerId = ""
  query.enabled = ""
  void load()
}

function openCreate() {
  editing.value = null
  Object.assign(form, {
    providerId: query.providerId || providers.value[0]?.id || "",
    key: "",
    name: "",
    contextWindow: 8192,
    maxOutputTokens: 4096,
    inputPricePerM: 0,
    outputPricePerM: 0,
    supportsStream: true,
    supportsTools: false,
    supportsVision: false,
    enabled: true,
    isDefault: items.value.length === 0,
    sort: items.value.length,
    description: ""
  })
  formVisible.value = true
}

function openEdit(row: ModelItem) {
  editing.value = row
  Object.assign(form, {
    providerId: row.providerId,
    key: row.key,
    name: row.name,
    contextWindow: row.contextWindow,
    maxOutputTokens: row.maxOutputTokens,
    inputPricePerM: row.inputPricePerM,
    outputPricePerM: row.outputPricePerM,
    supportsStream: row.supportsStream,
    supportsTools: row.supportsTools,
    supportsVision: row.supportsVision,
    enabled: row.enabled,
    isDefault: row.isDefault,
    sort: row.sort,
    description: row.description || ""
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
      providerId: form.providerId,
      contextWindow: form.contextWindow,
      maxOutputTokens: form.maxOutputTokens,
      inputPricePerM: form.inputPricePerM,
      outputPricePerM: form.outputPricePerM,
      supportsStream: form.supportsStream,
      supportsTools: form.supportsTools,
      supportsVision: form.supportsVision,
      enabled: form.enabled,
      isDefault: form.isDefault,
      sort: form.sort,
      description: form.description || null
    }
    if (editing.value) {
      // 标识（真实模型名）允许修改
      await modelsApi.update(editing.value.id, { ...payload, key: form.key.trim() })
      toastOk("模型已更新")
    } else {
      await modelsApi.create({ ...payload, key: form.key.trim() })
      toastOk("模型已创建")
    }
    formVisible.value = false
    await load()
  } catch (error) {
    toastError(error)
  } finally {
    saving.value = false
  }
}

async function onCommand(command: string, row: ModelItem) {
  if (command === "toggle") {
    try {
      await modelsApi.toggle(row.id, !row.enabled)
      toastOk(row.enabled ? "模型已禁用" : "模型已启用")
      await load()
    } catch (error) {
      toastError(error)
    }
  } else if (command === "default") {
    try {
      await modelsApi.setDefault(row.id)
      toastOk(`已将 ${row.name} 设为默认模型`)
      await load()
    } catch (error) {
      toastError(error)
    }
  } else if (command === "delete") {
    try {
      await ElMessageBox.confirm(
        `删除模型「${row.name}」？历史会话记录将保留但无法再使用该模型。`,
        "删除模型",
        { type: "warning", confirmButtonText: "删除", cancelButtonText: "取消" }
      )
    } catch {
      return
    }
    try {
      await modelsApi.remove(row.id)
      ElMessage.success("模型已删除")
      await load()
    } catch (error) {
      toastError(error)
    }
  }
}

function openTest(row: ModelItem) {
  testTarget.value = row
  testResult.value = null
  testVisible.value = true
}

async function runTest() {
  if (!testTarget.value) return
  testing.value = true
  testResult.value = null
  try {
    testResult.value = await modelsApi.test({
      modelId: testTarget.value.id,
      prompt: testPrompt.value || undefined
    })
    if (testResult.value.ok) toastOk("连通正常")
  } catch (error) {
    toastError(error, "测试请求失败")
  } finally {
    testing.value = false
  }
}

onMounted(async () => {
  await loadProviders()
  await load()
})
</script>

<style scoped>
.tip-alert {
  margin-bottom: 14px;
}
.model-cell {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.model-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13.5px;
  font-weight: 500;
}
.model-key {
  font-size: 12px;
  color: var(--cg-text-muted);
}
.prov-cell {
  display: flex;
  align-items: center;
  gap: 6px;
}
.cap-cell {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.price-cell {
  display: flex;
  flex-direction: column;
  font-size: 12px;
  color: var(--cg-text-muted);
}
.form-hint {
  margin: -6px 0 12px 112px;
  font-size: 12px;
  color: var(--cg-text-muted);
}
.test-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 12px;
}
.test-model {
  font-size: 15px;
  font-weight: 600;
}
.test-result {
  margin-top: 16px;
}
.test-reply {
  margin-top: 12px;
}
.test-reply-label {
  margin-bottom: 6px;
  font-size: 12.5px;
  color: var(--cg-text-muted);
}
.test-reply-body {
  padding: 10px 12px;
  font-size: 13.5px;
  line-height: 1.7;
  white-space: pre-wrap;
  background: var(--cg-card-bg-soft);
  border-radius: 8px;
}
.test-usage {
  margin-top: 10px;
  font-size: 12px;
  color: var(--cg-text-muted);
}
</style>