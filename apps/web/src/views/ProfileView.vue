<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title">个人设置</h2>
        <p class="page-subtitle">维护个人资料、查看账号权限与修改密码</p>
      </div>
    </div>

    <el-row :gutter="16">
      <el-col :xs="24" :md="16">
        <el-card shadow="never" class="block">
          <template #header><span class="block-title">基本信息</span></template>

          <el-form :model="form" label-width="92px" v-loading="loading">
            <el-form-item label="邮箱">
              <el-input :model-value="auth.user?.email" disabled />
            </el-form-item>
            <el-form-item label="姓名">
              <el-input v-model="form.name" placeholder="请输入姓名" />
            </el-form-item>
            <el-form-item label="头像地址">
              <el-input v-model="form.avatar" placeholder="图片 URL，可留空" />
            </el-form-item>
            <el-form-item label="院系">
              <el-input v-model="form.department" placeholder="如：计算机学院" />
            </el-form-item>
            <el-form-item label="学号 / 工号">
              <el-input v-model="form.studentNo" placeholder="如：2023010101" />
            </el-form-item>
            <el-form-item label="手机号">
              <el-input v-model="form.phone" placeholder="选填" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="saving" @click="save">保存修改</el-button>
              <el-button @click="reset">重置</el-button>
            </el-form-item>
          </el-form>
        </el-card>

        <el-card shadow="never" class="block">
          <template #header><span class="block-title">修改密码</span></template>

          <el-form
            ref="pwdFormRef"
            :model="pwdForm"
            :rules="pwdRules"
            label-width="92px"
            @keyup.enter="changePassword"
          >
            <el-form-item label="当前密码" prop="oldPassword">
              <el-input v-model="pwdForm.oldPassword" type="password" show-password />
            </el-form-item>
            <el-form-item label="新密码" prop="newPassword">
              <el-input v-model="pwdForm.newPassword" type="password" show-password />
            </el-form-item>
            <el-form-item label="确认新密码" prop="confirm">
              <el-input v-model="pwdForm.confirm" type="password" show-password />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="pwdSaving" @click="changePassword">
                更新密码
              </el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>

      <el-col :xs="24" :md="8">
        <el-card shadow="never" class="block">
          <template #header><span class="block-title">账号概览</span></template>

          <div class="profile-head">
            <el-avatar :size="56" :src="auth.user?.avatar || undefined">
              {{ (auth.user?.name || "U").slice(0, 1) }}
            </el-avatar>
            <div>
              <div class="profile-name">{{ auth.user?.name }}</div>
              <div class="muted">{{ auth.user?.email }}</div>
            </div>
          </div>

          <el-descriptions :column="1" border size="small" class="profile-desc">
            <el-descriptions-item label="角色">
              <el-tag
                v-for="role in auth.user?.roles || []"
                :key="role"
                class="role-tag"
                size="small"
              >
                {{ roleText(role) }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="状态">
              <el-tag :type="statusType(auth.user?.status)" size="small">
                {{ statusText(auth.user?.status) }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="院系">
              {{ auth.user?.department || "-" }}
            </el-descriptions-item>
            <el-descriptions-item label="注册时间">
              {{ formatDateTime(auth.user?.createdAt) }}
            </el-descriptions-item>
            <el-descriptions-item label="上次登录">
              {{ formatDateTime(auth.user?.lastLoginAt) }}
            </el-descriptions-item>
            <el-descriptions-item label="权限数量">
              {{ auth.permissions.includes("*") ? "全部权限" : `${auth.permissions.length} 项` }}
            </el-descriptions-item>
          </el-descriptions>

          <el-button class="danger-btn" @click="logoutAll">
            <el-icon><SwitchButton /></el-icon> 注销所有设备的登录
          </el-button>
        </el-card>

        <el-card shadow="never" class="block">
          <template #header><span class="block-title">今日用量</span></template>
          <div v-if="quota" class="quota-list">
            <div class="quota-row">
              <span>今日请求次数</span>
              <strong>{{ quota.used?.dailyRequests ?? 0 }}</strong>
            </div>
            <div class="quota-row">
              <span>今日消耗 Token</span>
              <strong>{{ formatTokens(quota.used?.dailyTokens) }}</strong>
            </div>
            <div class="quota-row">
              <span>本月消耗 Token</span>
              <strong>{{ formatTokens(quota.used?.monthlyTokens) }}</strong>
            </div>
            <div class="quota-row">
              <span>配额状态</span>
              <el-tag :type="quota.allowed ? 'success' : 'danger'" size="small">
                {{ quota.allowed ? "正常" : "已受限" }}
              </el-tag>
            </div>
            <el-divider />
            <div class="quota-row">
              <span>每日 Token 上限</span>
              <strong>{{ limitText(quota.limits?.dailyTokenLimit) }}</strong>
            </div>
            <div class="quota-row">
              <span>每月 Token 上限</span>
              <strong>{{ limitText(quota.limits?.monthlyTokenLimit) }}</strong>
            </div>
            <div class="quota-row">
              <span>每日请求上限</span>
              <strong>{{ limitText(quota.limits?.dailyRequestLimit) }}</strong>
            </div>
            <div class="quota-row">
              <span>每分钟请求上限</span>
              <strong>{{ limitText(quota.limits?.rpmLimit) }}</strong>
            </div>
            <el-alert
              v-if="quota.reason"
              :title="quota.reason"
              type="warning"
              :closable="false"
              show-icon
              class="quota-alert"
            />
          </div>
          <div v-else class="empty-block">暂无配额信息</div>
          <el-button text type="primary" @click="router.push('/usage')">
            查看详细用量 <el-icon><ArrowRight /></el-icon>
          </el-button>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue"
import { useRouter } from "vue-router"
import type { FormInstance, FormRules } from "element-plus"
import { authApi, usageApi } from "@/api"
import { toastError, toastOk } from "@/api/client"
import { useAuthStore } from "@/stores/auth"
import type { QuotaStatus } from "@/api/types"
import {
  formatDateTime,
  formatTokens,
  roleText,
  statusText,
  statusType
} from "@/utils/format"

const auth = useAuthStore()
const router = useRouter()

const loading = ref(false)
const saving = ref(false)
const pwdSaving = ref(false)
const quota = ref<QuotaStatus | null>(null)
const pwdFormRef = ref<FormInstance>()

const form = reactive({
  name: "",
  avatar: "",
  department: "",
  studentNo: "",
  phone: ""
})

const pwdForm = reactive({
  oldPassword: "",
  newPassword: "",
  confirm: ""
})

const pwdRules: FormRules = {
  oldPassword: [{ required: true, message: "请输入当前密码", trigger: "blur" }],
  newPassword: [
    { required: true, message: "请输入新密码", trigger: "blur" },
    { min: 6, message: "密码至少 6 位", trigger: "blur" }
  ],
  confirm: [
    { required: true, message: "请再次输入新密码", trigger: "blur" },
    {
      validator: (_r, value, cb) => {
        if (value !== pwdForm.newPassword) cb(new Error("两次输入的密码不一致"))
        else cb()
      },
      trigger: "blur"
    }
  ]
}

function reset() {
  const user = auth.user
  form.name = user?.name || ""
  form.avatar = user?.avatar || ""
  form.department = user?.department || ""
  form.studentNo = user?.studentNo || ""
  form.phone = user?.phone || ""
}

function limitText(value?: number | null) {
  return !value || value === 0 ? "不限" : formatTokens(value)
}

async function save() {
  saving.value = true
  try {
    await auth.updateProfile({ ...form })
    toastOk("资料已更新")
  } catch (error) {
    toastError(error)
  } finally {
    saving.value = false
  }
}

async function changePassword() {
  const valid = await pwdFormRef.value?.validate().catch(() => false)
  if (!valid) return

  pwdSaving.value = true
  try {
    await authApi.changePassword({
      oldPassword: pwdForm.oldPassword,
      newPassword: pwdForm.newPassword
    })
    toastOk("密码已更新，请重新登录")
    pwdForm.oldPassword = ""
    pwdForm.newPassword = ""
    pwdForm.confirm = ""
    await auth.logout()
    router.replace("/login")
  } catch (error) {
    toastError(error)
  } finally {
    pwdSaving.value = false
  }
}

async function logoutAll() {
  try {
    await ElMessageBox.confirm(
      "将注销你在所有设备上的登录状态，需要重新登录。确定继续吗？",
      "注销所有设备",
      { type: "warning", confirmButtonText: "确定注销", cancelButtonText: "取消" }
    )
  } catch {
    return
  }
  try {
    await authApi.logoutAll()
    auth.reset()
    ElMessage.success("已注销所有设备")
    router.replace("/login")
  } catch (error) {
    toastError(error)
  }
}

onMounted(async () => {
  loading.value = true
  reset()
  try {
    const profile = await authApi.profile()
    if (profile?.quota) quota.value = profile.quota
  } catch {
    try {
      // /usage/me/quota 用 usage 字段承载消耗量，这里统一成 used
      const detail = await usageApi.myQuota()
      quota.value = { ...detail, used: detail.used ?? detail.usage }
    } catch {
      quota.value = null
    }
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.block {
  margin-bottom: 16px;
  border-radius: var(--cg-radius);
}
.block-title {
  font-size: 15px;
  font-weight: 600;
}
.profile-head {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 16px;
}
.profile-name {
  font-size: 16px;
  font-weight: 600;
}
.profile-desc {
  margin-bottom: 14px;
}
.role-tag {
  margin-right: 6px;
}
.danger-btn {
  width: 100%;
  color: var(--el-color-danger);
}
.quota-list {
  font-size: 13.5px;
}
.quota-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 0;
}
.quota-alert {
  margin-top: 10px;
}
</style>