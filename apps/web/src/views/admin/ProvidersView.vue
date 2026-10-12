<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title">模型供应商</h2>
        <p class="page-subtitle">
          管理 OpenAI 兼容、Anthropic、Google、Ollama 等供应商的接入地址与密钥（AES-256-GCM 加密存储）
        </p>
      </div>
      <div class="page-actions">
        <el-button v-permission="'provider:create'" type="primary" @click="openCreate">
          <el-icon><Plus /></el-icon> 新增供应商
        </el-button>
        <el-button @click="load">
          <el-icon><Refresh /></el-icon> 刷新
        </el-button>
      </div>
    </div>

    <el-row :gutter="14" v-loading="loading">
      <el-col v-for="p in providers" :key="p.id" :xs="24" :md="12" :xl="8">
        <el-card shadow="never" class="provider-card" :class="{ disabled: !p.enabled }">
          <div class="pc-head">
            <div class="pc-title">
              <el-icon class="pc-icon"><Connection /></el-icon>
              <span class="pc-name">{{ p.name }}</span>
            </div>
            <div class="pc-tags">
              <el-tag size="small" effect="plain">{{ typeText(p.type) }}</el-tag>
              <el-tag v-if="p.isSystem" size="small" type="info" effect="plain">系统</el-tag>
            </div>
          </div>

          <div class="pc-key mono">{{ p.key }}</div>
          <div class="pc-desc">{{ p.description || "暂无描述" }}</div>

          <div class="pc-info">
            <div class="pc-row">
              <span class="pc-label">接口地址</span>
              <span class="pc-value mono">{{ p.baseUrl || "默认" }}</span>
            </div>
            <div class="pc-row">
              <span class="pc-label">API Key</span>
              <span class="pc-value">
                <template v-if="p.hasApiKey">
                  <span class="mono">{{ p.apiKeyMasked }}</span>
                  <el-tag size="small" type="success" effect="plain">已配置</el-tag>
                </template>
                <el-tag v-else size="small" type="danger" effect="plain">未配置</el-tag>
              </span>
            </div>
            <div class="pc-row">
              <span class="pc-label">模型数量</span>
              <span class="pc-value">{{ p.modelCount ?? 0 }} 个</span>
            </div>
            <div class="pc-row">
              <span class="pc-label">状态</span>
              <span class="pc-value">
                <el-switch
                  :model-value="p.enabled"
                  :disabled="!auth.can('provider:update')"
                  @change="(v: any) => toggle(p, Boolean(v))"
                />
              </span>
            </div>
          </div>

          <div class="pc-actions">
            <el-button
              v-permission="'provider:read'"
              text
              type="primary"
              size="small"
              @click="openKeys(p)"
            >
              Key 池
            </el-button>
            <el-button
              v-permission="'model:read'"
              text
              type="primary"
              size="small"
              @click="router.push({ path: '/admin/models', query: { providerId: p.id } })"
            >
              查看模型
            </el-button>
            <el-button v-permission="'provider:update'" text type="primary" size="small" @click="openEdit(p)">
              编辑
            </el-button>
            <el-button
              v-permission="'provider:delete'"
              text
              type="danger"
              size="small"
              :disabled="p.isSystem"
              @click="remove(p)"
            >
              删除
            </el-button>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-empty v-if="!loading && providers.length === 0" description="还没有配置供应商" />

    <el-dialog
      v-model="formVisible"
      :title="editing ? '编辑供应商' : '新增供应商'"
      width="600px"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="104px">
        <el-form-item label="标识" prop="key">
          <el-input v-model="form.key" :disabled="Boolean(editing)" placeholder="如：deepseek" />
        </el-form-item>
        <el-form-item label="名称" prop="name">
          <el-input v-model="form.name" placeholder="如：DeepSeek" />
        </el-form-item>
        <el-form-item label="协议类型" prop="type">
          <el-select v-model="form.type" style="width: 100%">
            <el-option v-for="t in PROVIDER_TYPES" :key="t.value" :label="t.label" :value="t.value" />
          </el-select>
          <div class="form-hint">{{ currentTypeHint }}</div>
        </el-form-item>
        <el-form-item label="接口地址">
          <el-input v-model="form.baseUrl" placeholder="如：https://api.deepseek.com/v1" />
          <div class="form-hint">留空则使用内置默认地址</div>
        </el-form-item>
        <el-form-item label="API Key">
          <el-input
            v-model="form.apiKey"
            type="password"
            show-password
            :placeholder="editing?.hasApiKey ? '留空表示不修改密钥' : '请输入密钥'"
          />
          <div class="form-hint">
            密钥仅在后端加密保存，接口只返回掩码；留空提交表示保持不变。
          </div>
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="2" placeholder="选填" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="form.sort" :min="0" />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="form.enabled" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="formVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <!-- Key 池：多 Key 轮询与健康管理 -->
    <ProviderKeysDialog
      v-model="keysVisible"
      :provider="keysProvider"
      @changed="load"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue"
import { useRouter } from "vue-router"
import type { FormInstance, FormRules } from "element-plus"
import { providersApi } from "@/api"
import { toastError, toastOk } from "@/api/client"
import { useAuthStore } from "@/stores/auth"
import ProviderKeysDialog from "@/components/ProviderKeysDialog.vue"
import type { ProviderItem, ProviderType } from "@/api/types"

/*
 * 声明组件名，供 <keep-alive :include> 匹配（约定与路由 name 一致）。
 * 不声明的话缓存会静默失效：切走再回来仍会重建组件、重新拉数据。
 */
defineOptions({ name: "admin-providers" })

const auth = useAuthStore()
const router = useRouter()

const PROVIDER_TYPES: { label: string; value: ProviderType; hint: string }[] = [
  {
    label: "OpenAI 兼容",
    value: "OPENAI_COMPATIBLE",
    hint: "适用于 OpenAI、DeepSeek、Moonshot、通义、OpenRouter、Groq 等 /chat/completions 协议"
  },
  { label: "Anthropic", value: "ANTHROPIC", hint: "Claude 系列，使用 /v1/messages 协议" },
  { label: "Google Gemini", value: "GOOGLE", hint: "Gemini 系列，使用 generateContent 协议" },
  { label: "Ollama（本地）", value: "OLLAMA", hint: "本地部署，无需 API Key，默认 http://127.0.0.1:11434" },
  { label: "Azure OpenAI", value: "AZURE_OPENAI", hint: "需要填写部署名与 api-version" }
]

const providers = ref<ProviderItem[]>([])
const loading = ref(false)
const saving = ref(false)

const formVisible = ref(false)
const editing = ref<ProviderItem | null>(null)
const formRef = ref<FormInstance>()

/** Key 池管理弹窗 */
const keysVisible = ref(false)
const keysProvider = ref<ProviderItem | null>(null)

function openKeys(p: ProviderItem) {
  keysProvider.value = p
  keysVisible.value = true
}

const form = reactive({
  key: "",
  name: "",
  type: "OPENAI_COMPATIBLE" as ProviderType,
  baseUrl: "",
  apiKey: "",
  description: "",
  sort: 0,
  enabled: true
})

const formRules: FormRules = {
  key: [
    { required: true, message: "请输入标识", trigger: "blur" },
    { pattern: /^[a-z][a-z0-9_-]{1,31}$/, message: "小写字母开头，可含数字、下划线、连字符", trigger: "blur" }
  ],
  name: [{ required: true, message: "请输入名称", trigger: "blur" }],
  type: [{ required: true, message: "请选择协议类型", trigger: "change" }]
}

const currentTypeHint = computed(
  () => PROVIDER_TYPES.find((t) => t.value === form.type)?.hint || ""
)

function typeText(type: ProviderType) {
  return PROVIDER_TYPES.find((t) => t.value === type)?.label || type
}

async function load() {
  loading.value = true
  try {
    providers.value = await providersApi.list()
  } catch (error) {
    toastError(error, "供应商加载失败")
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editing.value = null
  Object.assign(form, {
    key: "",
    name: "",
    type: "OPENAI_COMPATIBLE",
    baseUrl: "",
    apiKey: "",
    description: "",
    sort: providers.value.length,
    enabled: true
  })
  formVisible.value = true
}

function openEdit(p: ProviderItem) {
  editing.value = p
  Object.assign(form, {
    key: p.key,
    name: p.name,
    type: p.type,
    baseUrl: p.baseUrl || "",
    apiKey: "",
    description: p.description || "",
    sort: p.sort,
    enabled: p.enabled
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
      type: form.type,
      baseUrl: form.baseUrl.trim() || null,
      description: form.description || null,
      sort: form.sort,
      enabled: form.enabled
    }
    // 仅在填写了密钥时提交，避免覆盖已保存的密钥
    if (form.apiKey.trim()) payload.apiKey = form.apiKey.trim()

    if (editing.value) {
      await providersApi.update(editing.value.id, payload)
      toastOk("供应商已更新")
    } else {
      await providersApi.create({ ...payload, key: form.key.trim() })
      toastOk("供应商已创建")
    }
    formVisible.value = false
    await load()
  } catch (error) {
    toastError(error)
  } finally {
    saving.value = false
  }
}

async function toggle(p: ProviderItem, enabled: boolean) {
  try {
    await providersApi.toggle(p.id, enabled)
    p.enabled = enabled
    toastOk(enabled ? "已启用" : "已禁用")
  } catch (error) {
    toastError(error)
  }
}

async function remove(p: ProviderItem) {
  try {
    await ElMessageBox.confirm(
      `删除供应商「${p.name}」将同时影响其下 ${p.modelCount ?? 0} 个模型，确定继续吗？`,
      "删除供应商",
      { type: "warning", confirmButtonText: "删除", cancelButtonText: "取消" }
    )
  } catch {
    return
  }
  try {
    await providersApi.remove(p.id)
    ElMessage.success("供应商已删除")
    await load()
  } catch (error) {
    toastError(error)
  }
}

onMounted(load)
</script>

<style scoped>
.provider-card {
  margin-bottom: 14px;
  border-radius: var(--cg-radius);
}
.provider-card.disabled {
  opacity: 0.72;
}
.pc-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.pc-title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.pc-icon {
  color: var(--cg-brand);
  font-size: 17px;
}
.pc-name {
  font-size: 15px;
  font-weight: 600;
}
.pc-tags {
  display: flex;
  gap: 6px;
}
.pc-key {
  margin-top: 4px;
  font-size: 12px;
  color: #9aa4b8;
}
.pc-desc {
  margin-top: 8px;
  min-height: 34px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--cg-text-muted);
}
.pc-info {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--cg-border);
}
.pc-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 5px 0;
  font-size: 12.5px;
}
.pc-label {
  color: var(--cg-text-muted);
  flex: 0 0 72px;
}
.pc-value {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pc-actions {
  display: flex;
  justify-content: flex-end;
  gap: 2px;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--cg-border);
}
.form-hint {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--cg-text-muted);
}
</style>