<template>
  <el-dialog
    v-model="visible"
    :title="`Key 池 · ${provider?.name || ''}`"
    width="760px"
    destroy-on-close
    @closed="reset"
  >
    <div v-loading="loading">
      <el-alert type="info" :closable="false" show-icon class="kp-tip">
        <template #default>
          <div class="kp-tip-body">
            配多把 Key 后，请求会<strong>按最久未使用轮询</strong>，分摊配额；
            某把 Key 限流会<strong>自动冷却</strong>，认证失败会<strong>自动停用</strong>并切换到其他 Key。
            <br />
            密钥只以掩码展示，明文不会回传到浏览器。
          </div>
        </template>
      </el-alert>

      <!-- 健康概览 -->
      <div v-if="stats" class="kp-stats">
        <div class="kp-stat">
          <span class="kp-stat-value">{{ stats.available }}/{{ stats.total }}</span>
          <span class="kp-stat-label">可用</span>
        </div>
        <div class="kp-stat">
          <span class="kp-stat-value ok">{{ stats.totalSuccess }}</span>
          <span class="kp-stat-label">累计成功</span>
        </div>
        <div class="kp-stat">
          <span class="kp-stat-value" :class="{ bad: stats.totalFailure > 0 }">
            {{ stats.totalFailure }}
          </span>
          <span class="kp-stat-label">累计失败</span>
        </div>
        <div class="kp-stat">
          <span class="kp-stat-value">{{ stats.byStatus?.COOLDOWN ?? 0 }}</span>
          <span class="kp-stat-label">冷却中</span>
        </div>
        <div class="kp-stat">
          <span class="kp-stat-value" :class="{ bad: (stats.byStatus?.INVALID ?? 0) > 0 }">
            {{ stats.byStatus?.INVALID ?? 0 }}
          </span>
          <span class="kp-stat-label">已失效</span>
        </div>
      </div>

      <!-- Key 列表 -->
      <div v-if="keys.length === 0" class="kp-empty">
        <el-empty description="还没有配置 Key" :image-size="70">
          <template #description>
            <p>还没有配置 Key，当前会回退使用「供应商上保存的单把 Key」。</p>
          </template>
        </el-empty>
      </div>

      <div v-else class="kp-list">
        <div v-for="k in keys" :key="k.id" class="kp-item" :class="{ off: !k.enabled }">
          <div class="kp-main">
            <div class="kp-line">
              <span class="kp-mask mono">{{ k.masked }}</span>
              <el-tag size="small" :type="statusType(k.status)" effect="plain">
                {{ statusText(k.status) }}
              </el-tag>
              <span v-if="k.label" class="kp-label">{{ k.label }}</span>
            </div>
            <div class="kp-meta">
              <span>成功 {{ k.successCount }} 次</span>
              <span>失败 {{ k.failureCount }} 次</span>
              <span v-if="k.lastUsedAt">最近使用 {{ fromNow(k.lastUsedAt) }}</span>
              <span v-if="k.cooldownUntil" class="warn">
                冷却至 {{ formatDateTime(k.cooldownUntil) }}
              </span>
            </div>
            <div v-if="k.lastError" class="kp-error" :title="k.lastError">
              {{ truncate(k.lastError, 120) }}
            </div>
          </div>

          <div class="kp-actions">
            <el-switch
              :model-value="k.enabled"
              size="small"
              :disabled="!canWrite"
              @change="(v: any) => toggleKey(k, Boolean(v))"
            />
            <el-button
              v-if="k.status !== 'ACTIVE' || k.failureCount > 0"
              text
              type="primary"
              size="small"
              :disabled="!canWrite"
              @click="resetKey(k)"
            >
              重置
            </el-button>
            <el-button text type="primary" size="small" :disabled="!canWrite" @click="openEdit(k)">
              编辑
            </el-button>
            <el-button text type="danger" size="small" :disabled="!canWrite" @click="removeKey(k)">
              删除
            </el-button>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="kp-footer">
        <el-button
          v-if="provider?.hasApiKey && keys.length === 0"
          :disabled="!canWrite"
          :loading="migrating"
          @click="migrateLegacy"
        >
          <el-icon><Download /></el-icon> 迁移现有 Key 进池
        </el-button>
        <div class="kp-footer-right">
          <el-button @click="visible = false">关闭</el-button>
          <el-button type="primary" :disabled="!canWrite" @click="openAdd">
            <el-icon><Plus /></el-icon> 添加 Key
          </el-button>
        </div>
      </div>
    </template>

    <!-- 新增 / 编辑 Key -->
    <el-dialog
      v-model="editVisible"
      :title="editing ? '编辑 Key' : '添加 Key'"
      width="480px"
      append-to-body
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="API Key" prop="apiKey">
          <el-input
            v-model="form.apiKey"
            type="password"
            show-password
            :placeholder="editing ? '留空表示不更换密钥' : '粘贴密钥，如 sk-...'"
          />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.label" placeholder="便于区分来源，如「主号」「备用-实验室」" />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="form.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue"
import { providersApi } from "@/api"
import { toastError, toastOk } from "@/api/client"
import { useAuthStore } from "@/stores/auth"
import { formatDateTime, fromNow, truncate } from "@/utils/format"
import type { ProviderApiKey, ProviderItem } from "@/api/types"

const props = defineProps<{
  modelValue: boolean
  provider: ProviderItem | null
}>()

const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void
  (e: "changed"): void
}>()

const auth = useAuthStore()
const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit("update:modelValue", v)
})
const canWrite = computed(() => auth.can("provider:write"))

const loading = ref(false)
const migrating = ref(false)
const keys = ref<ProviderApiKey[]>([])
const stats = ref<{
  total: number
  available: number
  byStatus: Record<string, number>
  totalSuccess: number
  totalFailure: number
} | null>(null)

const editVisible = ref(false)
const saving = ref(false)
const editing = ref<ProviderApiKey | null>(null)
const formRef = ref()
const form = reactive({ apiKey: "", label: "", enabled: true })

const rules = {
  apiKey: [
    {
      // 编辑时留空表示不更换密钥，因此只在「新增」时强制必填
      validator: (_r: unknown, value: string, cb: (e?: Error) => void) => {
        if (!editing.value && !value?.trim()) cb(new Error("请输入 API Key"))
        else cb()
      },
      trigger: "blur"
    }
  ]
}

const STATUS_TEXT: Record<string, string> = {
  ACTIVE: "可用",
  COOLDOWN: "冷却中",
  INVALID: "已失效",
  DISABLED: "已停用"
}
const statusText = (s: string) => STATUS_TEXT[s] || s

function statusType(s: string): "success" | "warning" | "danger" | "info" {
  if (s === "ACTIVE") return "success"
  if (s === "COOLDOWN") return "warning"
  if (s === "INVALID") return "danger"
  return "info"
}

function reset() {
  keys.value = []
  stats.value = null
  editing.value = null
}

async function load() {
  if (!props.provider) return
  loading.value = true
  try {
    const [list, st] = await Promise.all([
      providersApi.keys(props.provider.id),
      providersApi.keyStats(props.provider.id)
    ])
    keys.value = list
    stats.value = st
  } catch (error) {
    toastError(error, "加载 Key 池失败")
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.modelValue, props.provider?.id],
  ([open]) => {
    if (open) void load()
  },
  { immediate: true }
)

function openAdd() {
  editing.value = null
  form.apiKey = ""
  form.label = ""
  form.enabled = true
  editVisible.value = true
}

function openEdit(k: ProviderApiKey) {
  editing.value = k
  form.apiKey = "" // 留空表示不更换
  form.label = k.label || ""
  form.enabled = k.enabled
  editVisible.value = true
}

async function save() {
  if (!props.provider) return
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  saving.value = true
  try {
    if (editing.value) {
      await providersApi.updateKey(props.provider.id, editing.value.id, {
        ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
        label: form.label,
        enabled: form.enabled
      })
      toastOk("Key 已更新")
    } else {
      await providersApi.addKey(props.provider.id, {
        apiKey: form.apiKey.trim(),
        label: form.label || undefined,
        enabled: form.enabled
      })
      toastOk("Key 已添加")
    }
    editVisible.value = false
    await load()
    emit("changed")
  } catch (error) {
    toastError(error, "保存失败")
  } finally {
    saving.value = false
  }
}

async function toggleKey(k: ProviderApiKey, enabled: boolean) {
  if (!props.provider) return
  try {
    await providersApi.updateKey(props.provider.id, k.id, { enabled })
    toastOk(enabled ? "已启用" : "已停用")
    await load()
  } catch (error) {
    toastError(error)
  }
}

/** 手动重置：清掉冷却与失败计数，用于「确认已恢复」的场景 */
async function resetKey(k: ProviderApiKey) {
  if (!props.provider) return
  try {
    await providersApi.updateKey(props.provider.id, k.id, { status: "ACTIVE" })
    toastOk("已重置为可用状态")
    await load()
  } catch (error) {
    toastError(error)
  }
}

async function removeKey(k: ProviderApiKey) {
  if (!props.provider) return
  try {
    await ElMessageBox.confirm(
      `删除 Key「${k.masked}」？删除后不再参与轮询。`,
      "删除 Key",
      { type: "warning", confirmButtonText: "删除", cancelButtonText: "取消" }
    )
  } catch {
    return
  }
  try {
    await providersApi.removeKey(props.provider.id, k.id)
    toastOk("已删除")
    await load()
    emit("changed")
  } catch (error) {
    toastError(error)
  }
}

async function migrateLegacy() {
  if (!props.provider) return
  migrating.value = true
  try {
    await providersApi.migrateLegacyKey(props.provider.id)
    toastOk("已迁移进 Key 池")
    await load()
    emit("changed")
  } catch (error) {
    toastError(error, "迁移失败")
  } finally {
    migrating.value = false
  }
}
</script>

<style scoped>
.kp-tip {
  margin-bottom: 14px;
}
.kp-tip-body {
  font-size: 12.5px;
  line-height: 1.8;
}

.kp-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
}
.kp-stat {
  flex: 1 1 100px;
  padding: 10px 12px;
  text-align: center;
  background: var(--cg-card-bg-soft);
  border: 1px solid var(--cg-border);
  border-radius: 8px;
}
.kp-stat-value {
  display: block;
  font-size: 18px;
  font-weight: 600;
}
.kp-stat-value.ok {
  color: var(--cg-success-text);
}
.kp-stat-value.bad {
  color: var(--cg-danger-text);
}
.kp-stat-label {
  font-size: 11.5px;
  color: var(--cg-text-muted);
}

.kp-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 46vh;
  overflow-y: auto;
}

.kp-item {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 10px 12px;
  background: var(--cg-card-bg-soft);
  border: 1px solid var(--cg-border);
  border-radius: 9px;
}

.kp-item.off {
  opacity: 0.6;
}

.kp-main {
  flex: 1;
  min-width: 0;
}

.kp-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.kp-mask {
  font-size: 13px;
}

.kp-label {
  font-size: 12px;
  color: var(--cg-text-muted);
}

.kp-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 4px;
  font-size: 11.5px;
  color: var(--cg-text-muted);
}

.kp-meta .warn {
  color: var(--cg-warning-text);
}

.kp-error {
  margin-top: 4px;
  overflow: hidden;
  font-size: 11.5px;
  color: var(--cg-danger-text);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kp-actions {
  display: flex;
  flex-shrink: 0;
  gap: 4px;
  align-items: center;
}

.kp-empty {
  padding: 10px 0;
}

.kp-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.kp-footer-right {
  display: flex;
  gap: 8px;
}

@media (max-width: 640px) {
  .kp-item {
    flex-direction: column;
    align-items: stretch;
  }
  .kp-actions {
    justify-content: flex-end;
  }
}
</style>
