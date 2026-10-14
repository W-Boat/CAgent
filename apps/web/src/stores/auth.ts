import { defineStore } from "pinia"
import { authApi, settingsApi } from "@/api"
import {useThemeStore} from "./theme"
import {saveDisplayPolicy} from "@/utils/display-policy"
import { useUiStore } from "./ui"
import { errorMessage, tokenStore } from "@/api/client"
import type { AuthUser, PublicSettings } from "@/api/types"

let identityVersion = 0
let publicSettingsRequest:Promise<void>|null=null
let currentUserRequest:{token:string;promise:Promise<AuthUser|null>}|null=null

interface AuthState {
  user: AuthUser | null
  permissions: string[]
  roles: string[]
  settings: PublicSettings | null
  loading: boolean
  initialized: boolean
}

export const useAuthStore = defineStore("auth", {
  state: (): AuthState => ({
    user: null,
    permissions: [],
    roles: [],
    settings: null,
    loading: false,
    initialized: false
  }),

  getters: {
    isLoggedIn: (state) => Boolean(state.user && tokenStore.access),
    isAdmin: (state) =>
      state.permissions.includes("*") || state.permissions.includes("dashboard:read"),
    displayName: (state) => state.user?.name || state.user?.email || "未登录",
    siteName: (state) => state.settings?.site_name || "CAgent 校园智能体平台",

    /**
     * 是否是「学生」——即只能使用聊天前端的用户。
     *
     * 判据是**没有任何后台可见权限**，而不是角色名。
     * 原因：角色名可以自建（学校可能建一个「助教」「访客」），
     * 而「能不能进后台」本质是由权限决定的。按权限判断，
     * 自建角色只要不勾后台权限就自动获得学生端体验，无需改代码。
     *
     * 用 dashboard:read 作为探针：它是「工作台」的权限，
     * 管理员与超管都有（超管走 `*`），而普通用户角色没有。
     * 这正是原 homePath 的分流依据，此处保持一致。
     *
     * ⚠️ 由此派生一条**约定**：dashboard:read 同时充当
     *    「可以进后台」的标记位。内置的「教师（小管理）」角色
     *    （constants/permissions.ts 的 SYSTEM_ROLES.teacher）必须带上它，
     *    否则教师会被当成学生、被重定向进学生聊天端 —— 这正是
     *    教师原先挂普通用户角色时踩到的问题。
     *    脚本 scripts/apply-teacher-role.ts 会在漏配时明确告警。
     */
    isStudent: (state): boolean => {
      if (state.permissions.includes("*")) return false
      return !state.permissions.includes("dashboard:read")
    },

    /**
     * 可选功能是否已开放。
     *
     * 读公开设置里的 `<feature>_enabled`。**缺省视为关闭**（fail-closed）：
     * 设置还没加载到、或接口挂了，都按「不露出」处理。
     * 这类开关默认关比默认开安全 —— 忘了配的后果是「功能没出现」
     * （可见、可补救），而不是「不该看到的人看到了」。
     */
    featureOn: (state) => (feature: "memory"): boolean => {
      const s = state.settings as unknown as Record<string, unknown> | null
      if (!s) return false
      return s[`${feature}_enabled`] !== false
    },

    /**
     * 登录后的落地页：学生直达独立聊天前端，管理员进工作台。
     *
     * 学生去 `/student` 而不是 `/chat`：后者在 AppLayout 里，
     * 会把整套后台导航重新暴露给学生（详见 router/routes.ts 的说明）。
     */
    homePath: (state): string => {
      if (state.permissions.includes("*")) return "/dashboard"
      if (state.permissions.includes("dashboard:read")) return "/dashboard"
      return "/student"
    }
  },

  actions: {
    /** 权限判断：支持通配符 * 与 code 精确匹配 */
    can(code?: string | string[]): boolean {
      if (!code) return true
      if (this.permissions.includes("*")) return true
      const list = Array.isArray(code) ? code : [code]
      return list.some((c) => this.permissions.includes(c))
    },

    canAll(codes: string[]): boolean {
      if (this.permissions.includes("*")) return true
      return codes.every((c) => this.permissions.includes(c))
    },

    async loadPublicSettings() {
      if(publicSettingsRequest)return publicSettingsRequest
      publicSettingsRequest=(async()=>{
        try{this.settings=await settingsApi.publicSettings()}catch{return}
        const ui=useUiStore(),theme=useThemeStore()
        ui.applyServerAccent(this.settings?.default_accent_color||'',this.settings?.unified_theme_enabled!==false)
        theme.applyPolicy(this.settings?.student_default_theme||'system',this.settings?.student_allow_theme_toggle!==false)
        saveDisplayPolicy({accent:ui.serverAccent,unified:ui.managed,theme:theme.defaultMode,allowToggle:theme.allowToggle})
      })()
      try{await publicSettingsRequest}finally{publicSettingsRequest=null}
    },

    async login(payload: { email: string; password: string }) {
      identityVersion++
      this.loading = true
      try {
        const result = await authApi.login(payload)
        tokenStore.set(result.accessToken, result.refreshToken)
        this.user = result.user
        this.permissions = result.user.permissions || []
        this.roles = result.user.roles || []
        return result
      } finally {
        this.loading = false
      }
    },

    async register(payload: {
      email: string
      password: string
      name: string
      department?: string
      studentNo?: string
    }) {
      identityVersion++
      this.loading = true
      try {
        const result = await authApi.register(payload)
        tokenStore.set(result.accessToken, result.refreshToken)
        this.user = result.user
        this.permissions = result.user.permissions || []
        this.roles = result.user.roles || []
        return result
      } finally {
        this.loading = false
      }
    },

    /** 刷新当前用户（进入受保护路由时调用） */
    async fetchMe() {
      if (!tokenStore.access) {
        this.initialized = true
        return null
      }
      const token=tokenStore.access, version=identityVersion
      if(currentUserRequest)return currentUserRequest.promise
      const request=(async()=>{try {
        const me = await authApi.me()
        if(!tokenStore.access || version !== identityVersion)return null
        this.user = me
        this.permissions = me.permissions || []
        this.roles = me.roles || []
        return me
      } catch (error) {
        if(version === identityVersion && !tokenStore.access){
          tokenStore.clear()
          this.user = null
          this.permissions = []
          this.roles = []
        }
        throw error
      } finally {
        if(tokenStore.access===token || !tokenStore.access)this.initialized = true
      }})()
      currentUserRequest={token,promise:request}
      try{return await request}finally{if(currentUserRequest?.promise===request)currentUserRequest=null}
    },

    async updateProfile(payload: Record<string, unknown>) {
      const user = await authApi.updateProfile(payload as any)
      this.user = { ...(this.user as AuthUser), ...user }
      return user
    },

    async logout() {
      identityVersion++
      const refreshToken = tokenStore.refresh
      try {
        if (refreshToken && this.user) await authApi.logout(refreshToken)
      } catch {
        /* 退出失败也要清理本地状态 */
      }
      tokenStore.clear()
      this.user = null
      this.permissions = []
      this.roles = []
    },

    reset() {
      identityVersion++
      tokenStore.clear()
      this.user = null
      this.permissions = []
      this.roles = []
      this.initialized = false
    }
  }
})
