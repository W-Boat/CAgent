<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title">角色与权限</h2>
        <p class="page-subtitle">
          共 {{ roles.length }} 个角色 · 系统权限码 {{ catalog?.total ?? 0 }} 项
        </p>
      </div>
      <div class="page-actions">
        <el-button v-permission="'role:create'" type="primary" @click="openCreate">
          <el-icon><Plus /></el-icon> 新建角色
        </el-button>
        <el-button @click="load">
          <el-icon><Refresh /></el-icon> 刷新
        </el-button>
      </div>
    </div>

    <el-row :gutter="16">
      <el-col :xs="24" :lg="9">
        <el-card shadow="never" class="block" v-loading="loading">
          <template #header><span class="block-title">角色列表</span></template>

          <div
            v-for="role in roles"
            :key="role.id"
            class="role-card"
            :class="{ active: role.id === activeRoleId }"
            @click="selectRole(role.id)"
          >
            <div class="role-top">
              <div class="role-title">
                <el-icon class="role-icon"><Key /></el-icon>
                <span>{{ role.name }}</span>
                <el-tag v-if="role.isSystem" size="small" type="info" effect="plain">
                  内置
                </el-tag>
              </div>
              <el-tag size="small" :type="role.key === 'super_admin' ? 'danger' : 'primary'" effect="plain">
                {{ role.key }}
              </el-tag>
            </div>
            <div class="role-desc">{{ role.description || "暂无描述" }}</div>
            <div class="role-meta">
              <span><el-icon><User /></el-icon> {{ role.userCount ?? 0 }} 位用户</span>
              <span>
                <el-icon><Lock /></el-icon>
                {{ role.key === "super_admin" ? "全部权限" : `${role.permissionCount ?? 0} 项权限` }}
              </span>
            </div>
          </div>
        </el-card>
      </el-col>

      <el-col :xs="24" :lg="15">
        <el-card shadow="never" class="block" v-loading="detailLoading">
          <template #header>
            <div class="block-head">
              <span class="block-title">
                权限配置{{ activeRole ? ` · ${activeRole.name}` : "" }}
              </span>
              <div v-if="activeRole">
                <el-button
                  v-permission="'role:update'"
                  type="primary"
                  size="small"
                  :disabled="activeRole.key === 'super_admin'"
                  :loading="saving"
                  @click="savePermissions"
                >
                  保存权限
                </el-button>
                <el-button
                  v-permission="'role:delete'"
                  type="danger"
                  plain
                  size="small"
                  :disabled="activeRole.isSystem"
                  @click="removeRole"
                >
                  删除角色
                </el-button>
              </div>
            </div>
          </template>

          <div v-if="!activeRole" class="empty-block">请选择左侧角色查看权限</div>
          <template v-else>
            <el-alert
              v-if="activeRole.key === 'super_admin'"
              title="超级管理员拥有系统全部权限（通配符 *），权限不可修改"
              type="info"
              show-icon
              :closable="false"
              class="role-alert"
            />

            <div class="perm-toolbar">
              <el-checkbox
                v-model="checkAll"
                :indeterminate="indeterminate"
                :disabled="activeRole.key === 'super_admin'"
                @change="toggleAll"
              >
                全选
              </el-checkbox>
              <el-input
                v-model="permKeyword"
                size="small"
                placeholder="筛选权限"
                clearable
                style="width: 190px"
              >
                <template #prefix><el-icon><Search /></el-icon></template>
              </el-input>
            </div>

            <div v-for="group in filteredGroups" :key="group.key" class="perm-group">
              <div class="perm-group-head">
                <el-checkbox
                  :model-value="groupChecked(group)"
                  :indeterminate="groupIndeterminate(group)"
                  :disabled="activeRole.key === 'super_admin'"
                  @change="(v: any) => toggleGroup(group, Boolean(v))"
                >
                  <span class="perm-group-name">{{ group.name }}</span>
                </el-checkbox>
                <span class="perm-group-count">
                  {{ group.permissions.filter((p) => checked.has(p.code)).length }}/{{ group.permissions.length }}
                </span>
              </div>
              <div class="perm-items">
                <el-checkbox
                  v-for="perm in group.permissions"
                  :key="perm.code"
                  :model-value="checked.has(perm.code)"
                  :disabled="activeRole.key === 'super_admin'"
                  @change="(v: any) => togglePerm(perm.code, Boolean(v))"
                >
                  <span class="perm-name">{{ perm.name }}</span>
                  <span class="perm-code mono">{{ perm.code }}</span>
                </el-checkbox>
              </div>
            </div>
          </template>
        </el-card>
      </el-col>
    </el-row>

    <el-dialog
      v-model="formVisible"
      :title="editing ? '编辑角色' : '新建角色'"
      width="520px"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="88px">
        <el-form-item label="标识" prop="key">
          <el-input v-model="form.key" :disabled="Boolean(editing)" placeholder="如：teacher" />
        </el-form-item>
        <el-form-item label="名称" prop="name">
          <el-input v-model="form.name" placeholder="如：教师" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="2" placeholder="选填" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="form.sort" :min="0" :step="1" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveRole">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue"
import type { FormInstance, FormRules } from "element-plus"
import { rolesApi } from "@/api"
import { toastError, toastOk } from "@/api/client"
import type { PermissionCatalog, RoleItem } from "@/api/types"

/*
 * 声明组件名，供 <keep-alive :include> 匹配（约定与路由 name 一致）。
 * 不声明的话缓存会静默失效：切走再回来仍会重建组件、重新拉数据。
 */
defineOptions({ name: "admin-roles" })

const roles = ref<RoleItem[]>([])
const catalog = ref<PermissionCatalog | null>(null)
const loading = ref(false)
const detailLoading = ref(false)
const saving = ref(false)

const activeRoleId = ref("")
const checked = ref<Set<string>>(new Set())
const permKeyword = ref("")

const formVisible = ref(false)
const editing = ref<RoleItem | null>(null)
const formRef = ref<FormInstance>()
const form = reactive({ key: "", name: "", description: "", sort: 0 })
const formRules: FormRules = {
  key: [
    { required: true, message: "请输入角色标识", trigger: "blur" },
    {
      pattern: /^[a-z][a-z0-9_]{1,31}$/,
      message: "仅小写字母、数字与下划线，字母开头",
      trigger: "blur"
    }
  ],
  name: [{ required: true, message: "请输入角色名称", trigger: "blur" }]
}

const activeRole = computed(() => roles.value.find((r) => r.id === activeRoleId.value) || null)

const allCodes = computed(() => {
  const list: string[] = []
  for (const group of catalog.value?.groups || []) {
    for (const p of group.permissions) list.push(p.code)
  }
  return list
})

const filteredGroups = computed(() => {
  const groups = catalog.value?.groups || []
  const kw = permKeyword.value.trim().toLowerCase()
  if (!kw) return groups
  return groups
    .map((g) => ({
      ...g,
      permissions: g.permissions.filter(
        (p) =>
          p.code.toLowerCase().includes(kw) ||
          p.name.toLowerCase().includes(kw) ||
          (p.description || "").toLowerCase().includes(kw)
      )
    }))
    .filter((g) => g.permissions.length > 0)
})

const checkAll = computed({
  get: () => allCodes.value.length > 0 && allCodes.value.every((c) => checked.value.has(c)),
  set: () => undefined
})

const indeterminate = computed(() => {
  const hit = allCodes.value.filter((c) => checked.value.has(c)).length
  return hit > 0 && hit < allCodes.value.length
})

function groupChecked(group: PermissionCatalog["groups"][number]) {
  return group.permissions.every((p) => checked.value.has(p.code))
}

function groupIndeterminate(group: PermissionCatalog["groups"][number]) {
  const hit = group.permissions.filter((p) => checked.value.has(p.code)).length
  return hit > 0 && hit < group.permissions.length
}

function toggleAll(value: boolean) {
  if (value) checked.value = new Set(allCodes.value)
  else checked.value = new Set()
}

function toggleGroup(group: PermissionCatalog["groups"][number], value: boolean) {
  const next = new Set(checked.value)
  for (const p of group.permissions) {
    if (value) next.add(p.code)
    else next.delete(p.code)
  }
  checked.value = next
}

function togglePerm(code: string, value: boolean) {
  const next = new Set(checked.value)
  if (value) next.add(code)
  else next.delete(code)
  checked.value = next
}

async function load() {
  loading.value = true
  try {
    const list = await rolesApi.list()
    roles.value = list
    if (!activeRoleId.value && list.length) activeRoleId.value = list[0].id
    if (activeRoleId.value) await selectRole(activeRoleId.value)
  } catch (error) {
    toastError(error, "角色列表加载失败")
  } finally {
    loading.value = false
  }
}

async function selectRole(id: string) {
  activeRoleId.value = id
  detailLoading.value = true
  try {
    const [detail, cat] = await Promise.all([
      rolesApi.detail(id),
      catalog.value ? Promise.resolve(catalog.value) : rolesApi.permissionCatalog()
    ])
    catalog.value = cat
    checked.value = new Set(detail.permissions || [])
  } catch (error) {
    toastError(error, "角色详情加载失败")
  } finally {
    detailLoading.value = false
  }
}

async function savePermissions() {
  if (!activeRole.value) return
  saving.value = true
  try {
    await rolesApi.update(activeRole.value.id, { permissions: [...checked.value] })
    toastOk("权限已保存")
    await load()
  } catch (error) {
    toastError(error)
  } finally {
    saving.value = false
  }
}

function openCreate() {
  editing.value = null
  Object.assign(form, { key: "", name: "", description: "", sort: roles.value.length })
  formVisible.value = true
}

async function saveRole() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  saving.value = true
  try {
    await rolesApi.create({
      key: form.key.trim(),
      name: form.name.trim(),
      description: form.description || null,
      sort: form.sort,
      permissions: []
    })
    toastOk("角色已创建，请为其勾选权限")
    formVisible.value = false
    await load()
  } catch (error) {
    toastError(error)
  } finally {
    saving.value = false
  }
}

async function removeRole() {
  if (!activeRole.value) return
  try {
    await ElMessageBox.confirm(
      `删除角色「${activeRole.value.name}」？该操作不可恢复。`,
      "删除角色",
      { type: "warning", confirmButtonText: "删除", cancelButtonText: "取消" }
    )
  } catch {
    return
  }
  try {
    await rolesApi.remove(activeRole.value.id)
    ElMessage.success("角色已删除")
    activeRoleId.value = ""
    await load()
  } catch (error) {
    toastError(error)
  }
}

onMounted(load)
</script>

<style scoped>
.block {
  border-radius: var(--cg-radius);
}
.block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.block-title {
  font-size: 15px;
  font-weight: 600;
}
.role-card {
  padding: 12px 14px;
  margin-bottom: 10px;
  cursor: pointer;
  border: 1px solid var(--cg-border);
  border-radius: 9px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.role-card:hover {
  border-color: #b9c9ee;
}
.role-card.active {
  border-color: var(--cg-brand);
  box-shadow: 0 0 0 2px var(--cg-brand-soft);
}
.role-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.role-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
}
.role-icon {
  color: var(--cg-brand);
}
.role-desc {
  margin-top: 6px;
  font-size: 12.5px;
  color: var(--cg-text-muted);
}
.role-meta {
  display: flex;
  gap: 16px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--cg-text-muted);
}
.role-meta span {
  display: flex;
  align-items: center;
  gap: 4px;
}
.role-alert {
  margin-bottom: 14px;
}
.perm-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--cg-border);
}
.perm-group {
  padding: 12px 0;
  border-bottom: 1px dashed #eef1f7;
}
.perm-group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.perm-group-name {
  font-size: 13.5px;
  font-weight: 600;
}
.perm-group-count {
  font-size: 12px;
  color: var(--cg-text-muted);
}
.perm-items {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 2px 12px;
  padding-left: 22px;
}
.perm-name {
  font-size: 13px;
}
.perm-code {
  margin-left: 6px;
  color: #9aa4b8;
}
</style>