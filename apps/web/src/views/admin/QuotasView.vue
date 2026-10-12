<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title">配额管理</h2>
        <p class="page-subtitle">
          为用户设置 Token / 请求次数上限，0 表示不限制 · 共 {{ total }} 位用户
        </p>
      </div>
      <div class="page-actions">
        <el-button @click="load">
          <el-icon><Refresh /></el-icon> 刷新
        </el-button>
        <el-button type="primary" :disabled="!auth.can('quota:write')" @click="openBatch">
          <el-icon><Operation /></el-icon> 批量设置
        </el-button>
      </div>
    </div>

    <div class="filter-bar">
      <el-input
        v-model="keyword"
        placeholder="搜索邮箱 / 姓名 / 学号"
        clearable
        style="width: 260px"
        @keyup.enter="reload"
        @clear="reload"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-button @click="reload">查询</el-button>
    </div>

    <el-table :data="rows" v-loading="loading" stripe size="small">
      <el-table-column label="用户" min-width="210">
        <template #default="{ row }">
          <div class="user-cell">
            <span class="name">{{ row.name }}</span>
            <span class="muted small">{{ row.email }}</span>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="院系 / 学号" min-width="150">
        <template #default="{ row }">
          <div class="user-cell">
            <span>{{ row.department || "-" }}</span>
            <span v-if="row.studentNo" class="muted small mono">{{ row.studentNo }}</span>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="角色" width="150">
        <template #default="{ row }">
          <el-tag v-for="r in row.roles" :key="r.key" size="small" effect="plain" class="role-tag">
            {{ r.name }}
          </el-tag>
          <span v-if="!row.roles?.length" class="muted">-</span>
        </template>
      </el-table-column>

      <el-table-column label="配额状态" width="100">
        <template #default="{ row }">
          <el-tag v-if="row.quota?.enabled" type="success" size="small" effect="plain">已启用</el-tag>
          <el-tag v-else-if="row.quota" type="info" size="small" effect="plain">已停用</el-tag>
          <el-tag v-else size="small" type="warning" effect="plain">默认</el-tag>
        </template>
      </el-table-column>

      <el-table-column label="今日 Token / 上限" min-width="180">
        <template #default="{ row }">
          <div class="limit-cell">
            <el-progress
              :percentage="percent(row.usage.dailyTokens, row.quota?.dailyTokenLimit)"
              :stroke-width="6"
              :show-text="false"
              :color="progressColor(percent(row.usage.dailyTokens, row.quota?.dailyTokenLimit))"
            />
            <span class="muted small">
              {{ formatTokens(row.usage.dailyTokens) }} /
              {{ limitText(row.quota?.dailyTokenLimit) }}
            </span>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="今日请求 / 上限" min-width="150">
        <template #default="{ row }">
          <span class="muted small">
            {{ row.usage.dailyRequests }} / {{ limitText(row.quota?.dailyRequestLimit) }}
          </span>
        </template>
      </el-table-column>

      <el-table-column label="本月 Token" width="120">
        <template #default="{ row }">{{ formatTokens(row.usage.monthlyTokens) }}</template>
      </el-table-column>

      <el-table-column label="操作" width="150" fixed="right">
        <template #default="{ row }">
          <el-button text type="primary" size="small" @click="openDetail(row)">消耗</el-button>
          <el-button
            text
            type="primary"
            size="small"
            :disabled="!auth.can('quota:write')"
            @click="openEdit(row)"
          >
            设置配额
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      v-if="total > 0"
      v-model:current-page="page"
      v-model:page-size="pageSize"
      :total="total"
      :page-sizes="[20, 50, 100]"
      layout="total, sizes, prev, pager, next"
      background
      class="pager"
      @current-change="load"
      @size-change="reload"
    />

    <!-- 单用户配额设置 -->
    <el-dialog v-model="editVisible" :title="`设置配额 · ${editing?.name || ''}`" width="580px" destroy-on-close>
      <el-alert
        v-if="editing && !editing.quota"
        title="该用户尚未创建配额记录，保存后将自动创建。"
        type="info"
        show-icon
        :closable="false"
        class="tip"
      />
      <el-form :model="form" label-width="130px">
        <el-form-item label="启用配额限制">
          <el-switch v-model="form.enabled" />
          <span class="field-desc">关闭后该用户不受任何配额限制</span>
        </el-form-item>
        <el-form-item label="每日 Token 上限">
          <el-input-number v-model="form.dailyTokenLimit" :min="0" :step="10000" style="width: 200px" />
          <span class="field-desc">0 = 不限</span>
        </el-form-item>
        <el-form-item label="每月 Token 上限">
          <el-input-number v-model="form.monthlyTokenLimit" :min="0" :step="100000" style="width: 200px" />
          <span class="field-desc">0 = 不限</span>
        </el-form-item>
        <el-form-item label="每日请求上限">
          <el-input-number v-model="form.dailyRequestLimit" :min="0" :step="50" style="width: 200px" />
          <span class="field-desc">0 = 不限</span>
        </el-form-item>
        <el-form-item label="每分钟请求上限">
          <el-input-number v-model="form.rpmLimit" :min="0" :step="5" style="width: 200px" />
          <span class="field-desc">0 = 不限，用于防止突发刷量</span>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.note" placeholder="如：本科生机房批次调整" maxlength="255" show-word-limit />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <!-- 批量设置 -->
    <el-dialog v-model="batchVisible" title="批量设置配额" width="620px" destroy-on-close>
      <el-form :model="batchForm" label-width="130px">
        <el-form-item label="应用范围">
          <el-radio-group v-model="batchScope">
            <el-radio-button value="role">按角色</el-radio-button>
            <el-radio-button value="department">按院系</el-radio-button>
            <el-radio-button value="users">指定用户</el-radio-button>
          </el-radio-group>
        </el-form-item>

        <el-form-item v-if="batchScope === 'role'" label="角色">
          <el-select v-model="batchForm.roleKey" placeholder="选择角色" style="width: 100%">
            <el-option v-for="r in roles" :key="r.key" :label="`${r.name}（${r.key}）`" :value="r.key" />
          </el-select>
        </el-form-item>

        <el-form-item v-if="batchScope === 'department'" label="院系">
          <el-select v-model="batchForm.department" placeholder="选择院系" filterable style="width: 100%">
            <el-option v-for="d in departments" :key="d" :label="d" :value="d" />
          </el-select>
        </el-form-item>

        <el-form-item v-if="batchScope === 'users'" label="用户">
          <el-select
            v-model="batchForm.userIds"
            multiple
            filterable
            placeholder="选择用户（可多选）"
            style="width: 100%"
          >
            <el-option v-for="u in userOptions" :key="u.id" :label="`${u.name}（${u.email}）`" :value="u.id" />
          </el-select>
        </el-form-item>

        <el-divider content-position="left">配额参数</el-divider>

        <el-form-item label="启用限制">
          <el-switch v-model="batchForm.enabled" />
        </el-form-item>
        <el-form-item label="每日 Token">
          <el-input-number v-model="batchForm.dailyTokenLimit" :min="0" :step="10000" style="width: 200px" />
        </el-form-item>
        <el-form-item label="每月 Token">
          <el-input-number v-model="batchForm.monthlyTokenLimit" :min="0" :step="100000" style="width: 200px" />
        </el-form-item>
        <el-form-item label="每日请求">
          <el-input-number v-model="batchForm.dailyRequestLimit" :min="0" :step="50" style="width: 200px" />
        </el-form-item>
        <el-form-item label="每分钟请求">
          <el-input-number v-model="batchForm.rpmLimit" :min="0" :step="5" style="width: 200px" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="batchForm.note" placeholder="可选" maxlength="255" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="batchVisible = false">取消</el-button>
        <el-button type="primary" :loading="batchSaving" @click="saveBatch">批量应用</el-button>
      </template>
    </el-dialog>

    <!-- 消耗明细 -->
    <el-drawer v-model="detailVisible" :title="`配额与消耗 · ${detail?.user?.name || ''}`" size="560px">
      <div v-if="detail" v-loading="detailLoading">
        <el-alert
          v-if="!detail.allowed"
          :title="detail.reason || '该用户已超出配额限制'"
          type="warning"
          show-icon
          :closable="false"
          class="tip"
        />
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="用户">
            {{ detail.user.name }} <span class="muted">{{ detail.user.email }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="配额状态">
            <el-tag :type="detail.quota?.enabled ? 'success' : 'info'" size="small">
              {{ detail.quota?.enabled ? "已启用" : "已停用" }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="备注">{{ detail.quota?.note || "-" }}</el-descriptions-item>
        </el-descriptions>

        <h4 class="detail-title">配额消耗</h4>
        <div class="usage-item" v-for="item in usageItems" :key="item.label">
          <div class="usage-head">
            <span>{{ item.label }}</span>
            <span class="muted small">{{ formatNumber(item.used) }} / {{ limitText(item.limit) }}</span>
          </div>
          <el-progress
            :percentage="percent(item.used, item.limit)"
            :stroke-width="8"
            :color="progressColor(percent(item.used, item.limit))"
          />
        </div>

        <h4 class="detail-title">今日调用记录</h4>
        <el-table :data="detailRecords" v-loading="recordsLoading" size="small">
          <el-table-column label="时间" width="150">
            <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="模型" min-width="140">
            <template #default="{ row }">{{ row.modelKey }}</template>
          </el-table-column>
          <el-table-column label="Token" width="90" prop="totalTokens" />
          <el-table-column label="来源" width="80">
            <template #default="{ row }">{{ sourceText(row.source) }}</template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!recordsLoading && detailRecords.length === 0" description="今日暂无调用" :image-size="70" />

        <div class="detail-actions">
          <el-button type="primary" :disabled="!auth.can('quota:write')" @click="openEdit(detailRow)">
            修改配额
          </el-button>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue"
import { rolesApi, usageApi, usersApi } from "@/api"
import { toastError, toastOk } from "@/api/client"
import { useAuthStore } from "@/stores/auth"
import type { QuotaDetail, QuotaRow, RoleItem, UsageRecord, UserItem } from "@/api/types"
import { formatDateTime, formatNumber, formatTokens, lastNDays, sourceText } from "@/utils/format"

/*
 * 声明组件名，供 <keep-alive :include> 匹配（约定与路由 name 一致）。
 * 不声明的话缓存会静默失效：切走再回来仍会重建组件、重新拉数据。
 */
defineOptions({ name: "admin-quotas" })

const auth = useAuthStore()

const rows = ref<QuotaRow[]>([])
const total = ref(0)
const loading = ref(false)
const keyword = ref("")
const page = ref(1)
const pageSize = ref(20)

const roles = ref<RoleItem[]>([])
const departments = ref<string[]>([])
const userOptions = ref<UserItem[]>([])

const editVisible = ref(false)
const saving = ref(false)
const editing = ref<QuotaRow | null>(null)
const form = reactive({
  enabled: true,
  dailyTokenLimit: 0,
  monthlyTokenLimit: 0,
  dailyRequestLimit: 0,
  rpmLimit: 0,
  note: ""
})

const batchVisible = ref(false)
const batchSaving = ref(false)
const batchScope = ref<"role" | "department" | "users">("role")
const batchForm = reactive({
  roleKey: "",
  department: "",
  userIds: [] as string[],
  enabled: true,
  dailyTokenLimit: 0,
  monthlyTokenLimit: 0,
  dailyRequestLimit: 0,
  rpmLimit: 0,
  note: ""
})

const detailVisible = ref(false)
const detailLoading = ref(false)
const detail = ref<QuotaDetail | null>(null)
const detailRow = ref<QuotaRow | null>(null)
const detailRecords = ref<UsageRecord[]>([])
const recordsLoading = ref(false)

const usageItems = computed(() => {
  const used = detail.value?.used ?? detail.value?.usage
  const limits = detail.value?.limits
  return [
    {
      label: "每日 Token",
      used: used?.dailyTokens ?? 0,
      limit: limits?.dailyTokenLimit ?? 0
    },
    {
      label: "每月 Token",
      used: used?.monthlyTokens ?? 0,
      limit: limits?.monthlyTokenLimit ?? 0
    },
    {
      label: "每日请求次数",
      used: used?.dailyRequests ?? 0,
      limit: limits?.dailyRequestLimit ?? 0
    }
  ]
})

function limitText(limit?: number | null) {
  return !limit ? "不限" : formatNumber(limit)
}

function percent(used: number, limit?: number | null) {
  if (!limit) return 0
  return Math.min(100, Math.round((used / limit) * 100))
}

function progressColor(value: number) {
  if (value >= 90) return "#ef4444"
  if (value >= 70) return "#f59e0b"
  return "var(--cg-brand)"
}

async function load() {
  loading.value = true
  try {
    const data = await usageApi.quotas({
      keyword: keyword.value || undefined,
      page: page.value,
      pageSize: pageSize.value
    })
    rows.value = data.items
    total.value = data.total
  } catch (error) {
    toastError(error, "配额列表加载失败")
  } finally {
    loading.value = false
  }
}

function reload() {
  page.value = 1
  void load()
}

function fillForm(quota?: QuotaRow["quota"]) {
  form.enabled = quota?.enabled ?? true
  form.dailyTokenLimit = quota?.dailyTokenLimit ?? 0
  form.monthlyTokenLimit = quota?.monthlyTokenLimit ?? 0
  form.dailyRequestLimit = quota?.dailyRequestLimit ?? 0
  form.rpmLimit = quota?.rpmLimit ?? 0
  form.note = quota?.note ?? ""
}

function openEdit(row: QuotaRow | null) {
  if (!row) return
  editing.value = row
  fillForm(row.quota)
  editVisible.value = true
}

async function save() {
  if (!editing.value) return
  saving.value = true
  try {
    await usageApi.setQuota(editing.value.id, { ...form })
    toastOk("配额已保存")
    editVisible.value = false
    await load()
    if (detail.value?.user.id === editing.value.id) await loadDetail(editing.value)
  } catch (error) {
    toastError(error)
  } finally {
    saving.value = false
  }
}

function openBatch() {
  batchScope.value = "role"
  Object.assign(batchForm, {
    roleKey: "",
    department: "",
    userIds: [],
    enabled: true,
    dailyTokenLimit: 0,
    monthlyTokenLimit: 0,
    dailyRequestLimit: 0,
    rpmLimit: 0,
    note: ""
  })
  batchVisible.value = true
}

async function saveBatch() {
  const payload: Record<string, unknown> = {
    enabled: batchForm.enabled,
    dailyTokenLimit: batchForm.dailyTokenLimit,
    monthlyTokenLimit: batchForm.monthlyTokenLimit,
    dailyRequestLimit: batchForm.dailyRequestLimit,
    rpmLimit: batchForm.rpmLimit,
    note: batchForm.note || undefined
  }

  if (batchScope.value === "role") {
    if (!batchForm.roleKey) {
      toastError(new Error("请选择角色"))
      return
    }
    payload.roleKey = batchForm.roleKey
  } else if (batchScope.value === "department") {
    if (!batchForm.department) {
      toastError(new Error("请选择院系"))
      return
    }
    payload.department = batchForm.department
  } else {
    if (batchForm.userIds.length === 0) {
      toastError(new Error("请选择至少一个用户"))
      return
    }
    payload.userIds = batchForm.userIds
  }

  batchSaving.value = true
  try {
    const result = await usageApi.batchQuota(payload)
    toastOk(`已更新 ${result.count ?? 0} 位用户的配额`)
    batchVisible.value = false
    await load()
  } catch (error) {
    toastError(error)
  } finally {
    batchSaving.value = false
  }
}

async function loadDetail(row: QuotaRow) {
  detailLoading.value = true
  try {
    detail.value = await usageApi.quota(row.id)
    const range = lastNDays(1)
    const records = await usageApi.records({
      userId: row.id,
      from: range.from,
      to: range.to,
      page: 1,
      pageSize: 20
    })
    detailRecords.value = records.items
  } catch (error) {
    toastError(error, "配额详情加载失败")
  } finally {
    detailLoading.value = false
  }
}

async function openDetail(row: QuotaRow) {
  detailRow.value = row
  detailVisible.value = true
  detail.value = null
  detailRecords.value = []
  await loadDetail(row)
}

async function loadMeta() {
  try {
    const [roleList, deptList, userPage] = await Promise.all([
      rolesApi.list(),
      usersApi.departments().catch(() => []),
      usersApi.list({ page: 1, pageSize: 200 })
    ])
    roles.value = roleList
    departments.value = deptList
    userOptions.value = userPage.items
  } catch {
    // 元数据失败不阻塞主列表
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
  gap: 10px;
  margin-bottom: 14px;
}
.user-cell {
  display: flex;
  flex-direction: column;
}
.name {
  font-size: 13.5px;
  font-weight: 500;
}
.small {
  font-size: 11.5px;
}
.role-tag {
  margin-right: 4px;
}
.limit-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 170px;
}
.pager {
  margin-top: 14px;
  justify-content: flex-end;
}
.field-desc {
  margin-left: 10px;
  font-size: 12px;
  color: var(--cg-text-muted);
}
.tip {
  margin-bottom: 14px;
}
.detail-title {
  margin: 20px 0 12px;
  font-size: 13.5px;
  font-weight: 600;
}
.usage-item {
  margin-bottom: 14px;
}
.usage-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 5px;
  font-size: 13px;
}
.detail-actions {
  margin-top: 22px;
}
</style>