<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title">用户管理</h2>
        <p class="page-subtitle">共 {{ total }} 名用户，可分配角色、重置密码与禁用账号</p>
      </div>
      <div class="page-actions">
        <el-button v-permission="'user:create'" type="primary" @click="openCreate">
          <el-icon><Plus /></el-icon> 新建用户
        </el-button>
        <el-button @click="load">
          <el-icon><Refresh /></el-icon> 刷新
        </el-button>
      </div>
    </div>

    <div class="filter-bar">
      <el-input
        v-model="query.keyword"
        placeholder="搜索邮箱 / 姓名 / 学号"
        clearable
        style="width: 240px"
        @keyup.enter="search"
        @clear="search"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>

      <el-select v-model="query.status" placeholder="状态" clearable style="width: 130px" @change="search">
        <el-option label="正常" value="ACTIVE" />
        <el-option label="已禁用" value="DISABLED" />
        <el-option label="待激活" value="PENDING" />
      </el-select>

      <el-select v-model="query.role" placeholder="角色" clearable style="width: 150px" @change="search">
        <el-option v-for="r in roles" :key="r.key" :label="r.name" :value="r.key" />
      </el-select>

      <el-select
        v-model="query.department"
        placeholder="院系"
        clearable
        filterable
        style="width: 170px"
        @change="search"
      >
        <el-option v-for="d in departments" :key="d" :label="d" :value="d" />
      </el-select>

      <el-button type="primary" @click="search">查询</el-button>
      <el-button @click="resetQuery">重置</el-button>
    </div>

    <div class="table-card">
      <el-table :data="items" v-loading="loading" stripe>
        <el-table-column label="用户" min-width="230">
          <template #default="{ row }">
            <div class="user-cell">
              <el-avatar :size="32" :src="row.avatar || undefined">
                {{ (row.name || row.email).slice(0, 1) }}
              </el-avatar>
              <div>
                <div class="user-name">{{ row.name }}</div>
                <div class="user-mail">{{ row.email }}</div>
              </div>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="角色" min-width="160">
          <template #default="{ row }">
            <el-tag
              v-for="r in row.roles"
              :key="r.key"
              size="small"
              class="role-tag"
              :type="r.key === 'super_admin' ? 'danger' : r.key === 'admin' ? 'warning' : 'info'"
            >
              {{ r.name }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column prop="department" label="院系" min-width="130">
          <template #default="{ row }">{{ row.department || "-" }}</template>
        </el-table-column>

        <el-table-column prop="studentNo" label="学号" min-width="120">
          <template #default="{ row }">{{ row.studentNo || "-" }}</template>
        </el-table-column>

        <el-table-column label="配额" min-width="160">
          <template #default="{ row }">
            <div class="quota-cell">
              <span>日 {{ quotaText(row.quota?.dailyTokenLimit) }}</span>
              <span>月 {{ quotaText(row.quota?.monthlyTokenLimit) }}</span>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ statusText(row.status) }}</el-tag>
          </template>
        </el-table-column>

        <el-table-column label="最后登录" width="170">
          <template #default="{ row }">{{ formatDateTime(row.lastLoginAt) }}</template>
        </el-table-column>

        <el-table-column label="操作" width="210" fixed="right">
          <template #default="{ row }">
            <el-button v-permission="'user:read'" text type="primary" size="small" @click="openDetail(row)">
              详情
            </el-button>
            <el-button v-permission="'user:update'" text type="primary" size="small" @click="openEdit(row)">
              编辑
            </el-button>
            <el-dropdown trigger="click" @command="(c: string) => onCommand(c, row)">
              <el-button text size="small">
                更多<el-icon><ArrowDown /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item v-if="auth.can('user:update')" command="toggle">
                    <el-icon><SwitchButton /></el-icon>
                    {{ row.status === "ACTIVE" ? "禁用账号" : "启用账号" }}
                  </el-dropdown-item>
                  <el-dropdown-item v-if="auth.can('user:update')" command="reset">
                    <el-icon><Key /></el-icon>重置密码
                  </el-dropdown-item>
                  <el-dropdown-item v-if="auth.can('quota:update')" command="quota">
                    <el-icon><Coin /></el-icon>设置配额
                  </el-dropdown-item>
                  <el-dropdown-item v-if="auth.can('user:delete')" command="delete" divided>
                    <el-icon><Delete /></el-icon>删除用户
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
        </el-table-column>
      </el-table>

      <div class="pager">
        <el-pagination
          v-model:current-page="query.page"
          v-model:page-size="query.pageSize"
          :total="total"
          :page-sizes="[10, 20, 50, 100]"
          layout="total, sizes, prev, pager, next, jumper"
          background
          @current-change="load"
          @size-change="search"
        />
      </div>
    </div>

    <!-- 新建 / 编辑 -->
    <el-dialog
      v-model="formVisible"
      :title="editing ? '编辑用户' : '新建用户'"
      width="560px"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="88px">
        <el-form-item label="邮箱" prop="email">
          <el-input v-model="form.email" :disabled="editing" placeholder="user@campus.edu" />
        </el-form-item>
        <el-form-item label="姓名" prop="name">
          <el-input v-model="form.name" placeholder="真实姓名" />
        </el-form-item>
        <el-form-item v-if="!editing" label="初始密码" prop="password">
          <el-input v-model="form.password" type="password" show-password placeholder="至少 6 位" />
        </el-form-item>
        <el-form-item label="角色" prop="roles">
          <el-select v-model="form.roles" multiple style="width: 100%" placeholder="选择角色">
            <el-option v-for="r in roles" :key="r.key" :label="r.name" :value="r.key" />
          </el-select>
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="院系">
              <el-input v-model="form.department" placeholder="如：计算机学院" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="学号">
              <el-input v-model="form.studentNo" placeholder="选填" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="手机号">
          <el-input v-model="form.phone" placeholder="选填" />
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="form.status">
            <el-radio value="ACTIVE">正常</el-radio>
            <el-radio value="DISABLED">禁用</el-radio>
            <el-radio value="PENDING">待激活</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="formVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <!-- 详情 -->
    <el-drawer v-model="detailVisible" title="用户详情" size="520px">
      <div v-if="detail" v-loading="detailLoading">
        <div class="detail-head">
          <el-avatar :size="56" :src="detail.avatar || undefined">
            {{ (detail.name || detail.email).slice(0, 1) }}
          </el-avatar>
          <div>
            <div class="detail-name">{{ detail.name }}</div>
            <div class="muted">{{ detail.email }}</div>
          </div>
        </div>

        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="状态">
            <el-tag :type="statusType(detail.status)" size="small">
              {{ statusText(detail.status) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="院系">{{ detail.department || "-" }}</el-descriptions-item>
          <el-descriptions-item label="学号">{{ detail.studentNo || "-" }}</el-descriptions-item>
          <el-descriptions-item label="手机">{{ detail.phone || "-" }}</el-descriptions-item>
          <el-descriptions-item label="会话数">{{ detail.stats?.conversations ?? 0 }}</el-descriptions-item>
          <el-descriptions-item label="消息数">{{ detail.stats?.messages ?? 0 }}</el-descriptions-item>
          <el-descriptions-item label="注册时间" :span="2">
            {{ formatDateTime(detail.createdAt) }}
          </el-descriptions-item>
          <el-descriptions-item label="最后登录" :span="2">
            {{ formatDateTime(detail.lastLoginAt) }}
          </el-descriptions-item>
        </el-descriptions>

        <h4 class="detail-title">今日用量 / 配额</h4>
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="今日请求">{{ detail.usage?.used?.dailyRequests ?? 0 }}</el-descriptions-item>
          <el-descriptions-item label="今日 Token">
            {{ formatTokens(detail.usage?.used?.dailyTokens) }}
          </el-descriptions-item>
          <el-descriptions-item label="本月 Token">
            {{ formatTokens(detail.usage?.used?.monthlyTokens) }}
          </el-descriptions-item>
          <el-descriptions-item label="配额状态">
            <el-tag :type="detail.usage?.allowed ? 'success' : 'danger'" size="small">
              {{ detail.usage?.allowed ? "正常" : "已受限" }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="每日 Token 上限">
            {{ detail.quota?.dailyTokenLimit || "不限" }}
          </el-descriptions-item>
          <el-descriptions-item label="每日请求上限">
            {{ detail.quota?.dailyRequestLimit || "不限" }}
          </el-descriptions-item>
        </el-descriptions>

        <el-alert
          v-if="detail.usage?.reason"
          :title="detail.usage.reason"
          type="warning"
          show-icon
          :closable="false"
          class="detail-alert"
        />
      </div>
    </el-drawer>

    <!-- 配额 -->
    <el-dialog v-model="quotaVisible" title="设置配额" width="480px" destroy-on-close>
      <el-form :model="quotaForm" label-width="120px">
        <el-form-item label="启用限制">
          <el-switch v-model="quotaForm.enabled" />
        </el-form-item>
        <el-form-item label="每日 Token">
          <el-input-number v-model="quotaForm.dailyTokenLimit" :min="0" :step="10000" style="width: 100%" />
          <div class="form-hint">0 表示不限</div>
        </el-form-item>
        <el-form-item label="每月 Token">
          <el-input-number v-model="quotaForm.monthlyTokenLimit" :min="0" :step="100000" style="width: 100%" />
        </el-form-item>
        <el-form-item label="每日请求数">
          <el-input-number v-model="quotaForm.dailyRequestLimit" :min="0" :step="10" style="width: 100%" />
        </el-form-item>
        <el-form-item label="每分钟请求">
          <el-input-number v-model="quotaForm.rpmLimit" :min="0" :step="5" style="width: 100%" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="quotaForm.note" placeholder="选填" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="quotaVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveQuota">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue"
import type { FormInstance, FormRules } from "element-plus"
import { rolesApi, usageApi, usersApi } from "@/api"
import { toastError, toastOk } from "@/api/client"
import { useAuthStore } from "@/stores/auth"
import type { RoleItem, UserDetail, UserItem } from "@/api/types"
import {
  compactNumber,
  formatDateTime,
  formatTokens,
  statusText,
  statusType
} from "@/utils/format"

/*
 * 声明组件名，供 <keep-alive :include> 匹配（约定与路由 name 一致）。
 * 不声明的话缓存会静默失效：切走再回来仍会重建组件、重新拉数据。
 */
defineOptions({ name: "admin-users" })

const auth = useAuthStore()

const items = ref<UserItem[]>([])
const roles = ref<RoleItem[]>([])
const departments = ref<string[]>([])
const total = ref(0)
const loading = ref(false)
const saving = ref(false)

const query = reactive({
  keyword: "",
  status: "",
  role: "",
  department: "",
  page: 1,
  pageSize: 20
})

const formVisible = ref(false)
const editing = ref<UserItem | null>(null)
const formRef = ref<FormInstance>()
const form = reactive({
  email: "",
  name: "",
  password: "",
  roles: ["user"] as string[],
  department: "",
  studentNo: "",
  phone: "",
  status: "ACTIVE" as string
})

const formRules: FormRules = {
  email: [
    { required: true, message: "请输入邮箱", trigger: "blur" },
    { type: "email", message: "邮箱格式不正确", trigger: "blur" }
  ],
  name: [{ required: true, message: "请输入姓名", trigger: "blur" }],
  password: [
    { required: true, message: "请输入初始密码", trigger: "blur" },
    { min: 6, message: "密码至少 6 位", trigger: "blur" }
  ],
  roles: [{ required: true, message: "请选择角色", trigger: "change" }]
}

const detailVisible = ref(false)
const detailLoading = ref(false)
const detail = ref<UserDetail | null>(null)

const quotaVisible = ref(false)
const quotaTarget = ref<UserItem | null>(null)
const quotaForm = reactive({
  enabled: true,
  dailyTokenLimit: 0,
  monthlyTokenLimit: 0,
  dailyRequestLimit: 0,
  rpmLimit: 0,
  note: ""
})

function quotaText(value?: number | null) {
  if (!value) return "不限"
  return compactNumber(value)
}

function search() {
  query.page = 1
  void load()
}

function resetQuery() {
  query.keyword = ""
  query.status = ""
  query.role = ""
  query.department = ""
  query.page = 1
  void load()
}

async function load() {
  loading.value = true
  try {
    const page = await usersApi.list({
      keyword: query.keyword || undefined,
      status: query.status || undefined,
      role: query.role || undefined,
      department: query.department || undefined,
      page: query.page,
      pageSize: query.pageSize
    })
    items.value = page.items
    total.value = page.total
  } catch (error) {
    toastError(error, "用户列表加载失败")
  } finally {
    loading.value = false
  }
}

async function loadMeta() {
  /*
   * 角色列表要 role:read 才拿得到。
   *
   * 没有该权限的角色（例如「教师（小管理）」只有 user:read）进来时，
   * 原来的写法仍会照发这个请求，控制台留下一条 403、角色筛选框空着 ——
   * 一个「本就不该请求的数据」被请求了。这里先判权限再决定要不要拉，
   * 没权限就不请求，页面其余部分照常可用。
   */
  const [roleList, deps] = await Promise.all([
    auth.can("role:read") ? rolesApi.list().catch(() => [] as RoleItem[]) : Promise.resolve([] as RoleItem[]),
    usersApi.departments().catch(() => [] as string[])
  ])
  roles.value = roleList
  departments.value = deps
}

function openCreate() {
  editing.value = null
  Object.assign(form, {
    email: "",
    name: "",
    password: "",
    roles: ["user"],
    department: "",
    studentNo: "",
    phone: "",
    status: "ACTIVE"
  })
  formVisible.value = true
}

function openEdit(row: UserItem) {
  editing.value = row
  Object.assign(form, {
    email: row.email,
    name: row.name,
    password: "",
    roles: row.roles.map((r) => r.key),
    department: row.department || "",
    studentNo: row.studentNo || "",
    phone: row.phone || "",
    status: row.status
  })
  formVisible.value = true
}

async function save() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  saving.value = true
  try {
    const payload: Record<string, unknown> = {
      name: form.name,
      roles: form.roles,
      department: form.department || null,
      studentNo: form.studentNo || null,
      phone: form.phone || null,
      status: form.status
    }
    if (editing.value) {
      await usersApi.update(editing.value.id, payload)
      toastOk("用户已更新")
    } else {
      await usersApi.create({
        ...payload,
        email: form.email.trim(),
        password: form.password
      })
      toastOk("用户已创建")
    }
    formVisible.value = false
    await load()
  } catch (error) {
    toastError(error)
  } finally {
    saving.value = false
  }
}

async function openDetail(row: UserItem) {
  detailVisible.value = true
  detailLoading.value = true
  detail.value = null
  try {
    detail.value = await usersApi.detail(row.id)
  } catch (error) {
    toastError(error)
  } finally {
    detailLoading.value = false
  }
}

async function onCommand(command: string, row: UserItem) {
  if (command === "toggle") {
    const next = row.status === "ACTIVE" ? "DISABLED" : "ACTIVE"
    try {
      await ElMessageBox.confirm(
        next === "DISABLED"
          ? `禁用后 ${row.name} 将立即退出所有设备并无法登录，确定吗？`
          : `确定启用 ${row.name} 的账号吗？`,
        "确认操作",
        { type: "warning", confirmButtonText: "确定", cancelButtonText: "取消" }
      )
    } catch {
      return
    }
    try {
      await usersApi.setStatus(row.id, next)
      toastOk(next === "ACTIVE" ? "账号已启用" : "账号已禁用")
      await load()
    } catch (error) {
      toastError(error)
    }
  } else if (command === "reset") {
    try {
      const { value } = await ElMessageBox.prompt(
        `为 ${row.name} 设置新密码（至少 6 位）`,
        "重置密码",
        {
          confirmButtonText: "重置",
          cancelButtonText: "取消",
          inputType: "password",
          inputValidator: (v) => (v && v.length >= 6 ? true : "密码至少 6 位")
        }
      )
      await usersApi.resetPassword(row.id, value)
      toastOk("密码已重置，该用户需重新登录")
    } catch (error) {
      if (error instanceof Error) toastError(error)
    }
  } else if (command === "quota") {
    quotaTarget.value = row
    Object.assign(quotaForm, {
      enabled: row.quota?.enabled ?? true,
      dailyTokenLimit: row.quota?.dailyTokenLimit ?? 0,
      monthlyTokenLimit: row.quota?.monthlyTokenLimit ?? 0,
      dailyRequestLimit: row.quota?.dailyRequestLimit ?? 0,
      rpmLimit: row.quota?.rpmLimit ?? 0,
      note: row.quota?.note || ""
    })
    quotaVisible.value = true
  } else if (command === "delete") {
    try {
      await ElMessageBox.confirm(
        `删除用户 ${row.name}（${row.email}）将同时移除其会话与记录，且不可恢复。确定继续吗？`,
        "危险操作",
        { type: "error", confirmButtonText: "删除", cancelButtonText: "取消" }
      )
    } catch {
      return
    }
    try {
      await usersApi.remove(row.id)
      ElMessage.success("用户已删除")
      await load()
    } catch (error) {
      toastError(error)
    }
  }
}

async function saveQuota() {
  if (!quotaTarget.value) return
  saving.value = true
  try {
    await usageApi.setQuota(quotaTarget.value.id, { ...quotaForm })
    toastOk("配额已保存")
    quotaVisible.value = false
    await load()
  } catch (error) {
    toastError(error)
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  await loadMeta()
  await load()
})

void formatTokens
</script>

<style scoped>
.user-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}
.user-name {
  font-size: 13.5px;
  font-weight: 500;
}
.user-mail {
  font-size: 12px;
  color: var(--cg-text-muted);
}
.role-tag {
  margin-right: 4px;
}
.quota-cell {
  display: flex;
  flex-direction: column;
  font-size: 12px;
  color: var(--cg-text-muted);
}
.detail-head {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 18px;
}
.detail-name {
  font-size: 16px;
  font-weight: 600;
}
.detail-title {
  margin: 20px 0 10px;
  font-size: 14px;
  font-weight: 600;
}
.detail-alert {
  margin-top: 14px;
}
.form-hint {
  font-size: 12px;
  color: var(--cg-text-muted);
}
</style>