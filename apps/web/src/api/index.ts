import { del, get, patch, post, put } from "./client"

/*
 * ══ 可用清单的统一过滤层 ══
 *
 * agents/skills 的 available() 是所有「用户可见」入口（学生端、聊天选择器、
 * 广场/技能中心、卡片协议 advertise）的唯一数据源，过滤放在这一层可以
 * 一处生效、处处生效，不用每个视图各写一遍。
 *
 * ── 无条件隐藏清单（产品决策，不受任何开关控制）──
 *   - 情侣空间相关：技能/智能体/工具全部滤掉；菜单与路由也已整体移除
 *     （见 router/routes.ts 的说明），藏就藏干净——协议提示词也不再广告它。
 *   - 人文之光：editorial-guide 智能体与其检索技能/工具，从用户可见入口移除。
 * 人文之光在管理端 list() 同样隐藏；后端统一拦截旧 ID 与旧绑定。
 */
const HIDDEN_PATTERNS: RegExp[] = [
  // 情侣空间族
  /情侣|恋人|爱人|loveline|love[-_]?line|couple/i,
  // 人文之光族（agent key editorial-guide，展示名含「人文之光」）
  /人文之光|editorial/i
]

interface FilterableItem {
  key?: string | null
  name?: string | null
  description?: string | null
}

function isHidden(item: FilterableItem): boolean {
  if (/^(ucass-kb-(survival|takeout)|kb-)/.test(item.key||"")) return true
  const hay = `${item.key || ""} ${item.name || ""} ${item.description || ""}`
  return HIDDEN_PATTERNS.some((re) => re.test(hay))
}

function filterAvailable<T extends FilterableItem>(list: T[]): T[] {
  return list.filter((x) => !isHidden(x))
}
function filterRetired<T extends FilterableItem>(list:T[]):T[]{return list.filter(item=>!/人文之光|editorial|loveline|love[-_]?line|couple|情侣空间|心屿/i.test(`${item.key||''} ${item.name||''} ${item.description||''}`))}
import type {
  AgentItem,
  AuthUser,
  AuditLog,
  BrowserActionResult,
  BrowserCommandItem,
  BrowserSession,
  BrowserStep,
  BuiltinTool,
  CampusCategories,
  CampusFrame,
  CampusGuideHit,
  CampusGuideMode,
  CampusMeta,
  CampusOpenResult,
  CampusRun,
  CampusRunDetail,
  CampusRunStats,
  CampusSearchResult,
  CampusStepHint,
  ConversationItem,
  DashboardRankings,
  DashboardSummary,
  DashboardTrendPoint,
  LoginResult,
  MessageFeedback,
  MessageItem,
  ModelItem,
  MyDashboard,
  Paged,
  PermissionCatalog,
  ProviderApiKey,
  ProviderItem,
  PublicSettings,
  QuotaDetail,
  QuotaRow,
  QuotaStatus,
  RoleItem,
  SettingItem,
  SkillItem,
  SkillRun,
  SkillType,
  SubmitFeedbackInput,
  TestModelResult,
  UsageByModel,
  UsageByUser,
  UsageOverview,
  UsageRecord,
  UsageTrendPoint,
  UserDetail,
  UserItem,
  UserQuota,
  AgentLearning,
  LearningOverview,
} from "./types"

// ---------------- 认证 ----------------

export const authApi = {
  login: (payload: { email: string; password: string }) =>
    post<LoginResult>("/auth/login", payload),
  register: (payload: {
    email: string
    password: string
    name: string
    department?: string
    studentNo?: string
  }) => post<LoginResult>("/auth/register", payload),
  me: () => get<AuthUser>("/auth/me"),
  profile: () => get<AuthUser & { quota: QuotaStatus }>("/auth/profile"),
  updateProfile: (payload: {
    name?: string
    avatar?: string
    department?: string
    studentNo?: string
    phone?: string
  }) => patch<AuthUser>("/auth/profile", payload),
  changePassword: (payload: { oldPassword: string; newPassword: string }) =>
    post<{ success: boolean }>("/auth/change-password", payload),
  logout: (refreshToken: string) =>
    post<{ success: boolean }>("/auth/logout", { refreshToken }),
  logoutAll: () => post<{ success: boolean }>("/auth/logout-all"),
}

export type SettingGroupKey =
  | "general"
  | "chat"
  | "security"
  | "browser"
  | "skill"
  | string

export const settingsApi = {
  publicSettings: () => get<PublicSettings>("/settings/public"),
  /** 按分组返回：{ general: SettingItem[], chat: [...] } */
  grouped: () => get<Record<SettingGroupKey, SettingItem[]>>("/settings"),
  flat: () => get<Record<string, unknown>>("/settings/flat"),
  update: (payload: Record<string, unknown>) =>
    put<Record<string, unknown>>("/settings", payload),
}

// ---------------- 用户 / 角色 ----------------

export interface UserQuery {
  keyword?: string
  status?: string
  role?: string
  department?: string
  page?: number
  pageSize?: number
}

export const usersApi = {
  list: (params: UserQuery) => get<Paged<UserItem>>("/users", params),
  departments: () => get<string[]>("/users/departments"),
  detail: (id: string) => get<UserDetail>(`/users/${id}`),
  create: (payload: Record<string, unknown>) => post<UserItem>("/users", payload),
  update: (id: string, payload: Record<string, unknown>) =>
    patch<UserItem>(`/users/${id}`, payload),
  remove: (id: string) => del<{ success: boolean }>(`/users/${id}`),
  setStatus: (id: string, status: string) =>
    patch<UserItem>(`/users/${id}/status`, { status }),
  resetPassword: (id: string, password: string) =>
    post<{ success: boolean }>(`/users/${id}/reset-password`, { password }),
}

export const rolesApi = {
  list: () => get<RoleItem[]>("/roles"),
  detail: (id: string) => get<RoleItem>(`/roles/${id}`),
  permissionCatalog: () => get<PermissionCatalog>("/roles/permissions"),
  create: (payload: Record<string, unknown>) => post<RoleItem>("/roles", payload),
  update: (id: string, payload: Record<string, unknown>) =>
    patch<RoleItem>(`/roles/${id}`, payload),
  remove: (id: string) => del<{ success: boolean }>(`/roles/${id}`),
}

// ---------------- 供应商 / 模型 ----------------

export const providersApi = {
  list: () => get<ProviderItem[]>("/providers"),
  detail: (id: string) => get<ProviderItem>(`/providers/${id}`),
  create: (payload: Record<string, unknown>) =>
    post<ProviderItem>("/providers", payload),
  update: (id: string, payload: Record<string, unknown>) =>
    patch<ProviderItem>(`/providers/${id}`, payload),
  toggle: (id: string, enabled: boolean) =>
    patch<ProviderItem>(`/providers/${id}/toggle`, { enabled }),
  remove: (id: string) => del<{ success: boolean }>(`/providers/${id}`),

  // ---------- Key 池（多 Key 轮询 + 失效自动切换） ----------

  /** 列出某供应商的 Key（只返回掩码） */
  keys: (id: string) => get<ProviderApiKey[]>(`/providers/${id}/keys`),

  /** Key 池健康概览 */
  keyStats: (id: string) =>
    get<{
      total: number
      available: number
      byStatus: Record<string, number>
      totalSuccess: number
      totalFailure: number
    }>(`/providers/${id}/keys/stats`),

  /** 新增一把 Key */
  addKey: (
    id: string,
    payload: { apiKey: string; label?: string; enabled?: boolean }
  ) => post<ProviderApiKey>(`/providers/${id}/keys`, payload),

  /** 编辑 Key：换密钥 / 改备注 / 启停 / 重置状态（status=ACTIVE 清冷却） */
  updateKey: (
    id: string,
    keyId: string,
    payload: {
      apiKey?: string
      label?: string
      enabled?: boolean
      status?: "ACTIVE" | "COOLDOWN" | "INVALID" | "DISABLED"
      sort?: number
    }
  ) => patch<ProviderApiKey>(`/providers/${id}/keys/${keyId}`, payload),

  removeKey: (id: string, keyId: string) =>
    del<{ success: boolean }>(`/providers/${id}/keys/${keyId}`),

  /** 把旧的单 Key 迁移进池 */
  migrateLegacyKey: (id: string) =>
    post<ProviderApiKey>(`/providers/${id}/keys/migrate-legacy`, {}),
}

export interface ModelQuery {
  keyword?: string
  providerId?: string
  enabled?: string
}

export const modelsApi = {
  list: (params: ModelQuery = {}) => get<ModelItem[]>("/models", params),
  available: () => get<ModelItem[]>("/models/available"),
  detail: (id: string) => get<ModelItem>(`/models/${id}`),
  create: (payload: Record<string, unknown>) => post<ModelItem>("/models", payload),
  update: (id: string, payload: Record<string, unknown>) =>
    patch<ModelItem>(`/models/${id}`, payload),
  toggle: (id: string, enabled: boolean) =>
    patch<ModelItem>(`/models/${id}/toggle`, { enabled }),
  setDefault: (id: string) => patch<ModelItem>(`/models/${id}/default`),
  remove: (id: string) => del<{ success: boolean }>(`/models/${id}`),
  test: (payload: { modelId: string; prompt?: string }) =>
    post<TestModelResult>("/chat/test-model", payload),
}

// ---------------- 会话 / 消息 ----------------

export interface ConversationQuery {
  keyword?: string
  userId?: string
  status?: string
  page?: number
  pageSize?: number
}

export interface MessageQuery {
  beforeId?: string
  latest?: "true" | "false"
  beforeSeq?: number
  keyword?: string
  conversationId?: string
  userId?: string
  role?: string
  flagged?: string
  from?: string
  to?: string
  page?: number
  pageSize?: number
}

export const conversationsApi = {
  mine: (params: ConversationQuery = {}) =>
    get<Paged<ConversationItem>>("/conversations", params),
  /**
   * 建会话。
   *
   * @param payload.systemPrompt 会话级系统提示词。后端在 chat.service 里
   *   把它拼进 systemPrompts 并随每条消息发送，因此只需在建会话时传一次。
   *   学生端用它注入「卡片协议」—— 只影响学生端会话，
   *   不去改服务端全局的 default_system_prompt（那由管理员在后台配置，
   *   且会波及管理端所有用户）。
   */
  create: (payload: {
    title?: string
    modelId?: string
    agentId?: string
    systemPrompt?: string
  }) => post<ConversationItem>("/conversations", payload),
  detail: (id: string) =>
    get<ConversationItem & { messages: MessageItem[] }>(`/conversations/${id}`),
  messages: (id: string, params: MessageQuery = {}) =>
    get<Paged<MessageItem> & { hasMore?: boolean; nextBeforeSeq?: number | null; nextBeforeId?: string | null }>(`/conversations/${id}/messages`, params),
  update: (
    id: string,
    payload: { title?: string; modelId?: string; pinned?: boolean; status?: string; systemPrompt?:string }
  ) => patch<ConversationItem>(`/conversations/${id}`, payload),
  remove: (id: string) => del<{ success: boolean }>(`/conversations/${id}`),
  // 后台审计
  adminAll: (params: ConversationQuery) =>
    get<Paged<ConversationItem>>("/conversations/admin/all", params),
  adminMessages: (params: MessageQuery) =>
    get<Paged<MessageItem>>("/conversations/admin/messages", params),
  flagMessage: (id: string, flagged: boolean, note?: string) =>
    post<MessageItem>(`/conversations/admin/messages/${id}/flag`, { flagged, note }),
  export: (id: string) => get<Record<string, unknown>>(`/conversations/admin/${id}/export`),
}

// ---------------- 用量 / 配额 ----------------

export interface UsageQuery {
  userId?: string
  providerKey?: string
  modelKey?: string
  source?: string
  from?: string
  to?: string
  page?: number
  pageSize?: number
}

export const usageApi = {
  mine: (params: UsageQuery = {}) =>
    get<{
      overview: UsageOverview
      trend: UsageTrendPoint[]
      byModel: UsageByModel[]
    }>("/usage/me", params),
  myRecords: (params: UsageQuery = {}) =>
    get<Paged<UsageRecord>>("/usage/me/records", params),
  myQuota: () => get<QuotaDetail>("/usage/me/quota"),

  overview: (params: UsageQuery = {}) =>
    get<{
      overview: UsageOverview
      trend: UsageTrendPoint[]
      source: UsageOverview["bySource"]
      byModel: UsageByModel[]
      byUser: UsageByUser[]
    }>("/usage/overview", params),
  records: (params: UsageQuery = {}) =>
    get<Paged<UsageRecord>>("/usage/records", params),
  quotas: (params: { keyword?: string; page?: number; pageSize?: number } = {}) =>
    get<Paged<QuotaRow>>("/usage/quotas", params),
  quota: (userId: string) => get<QuotaDetail>(`/usage/quotas/${userId}`),
  setQuota: (userId: string, payload: Record<string, unknown>) =>
    patch<UserQuota>(`/usage/quotas/${userId}`, payload),
  batchQuota: (payload: Record<string, unknown>) =>
    post<{ success: boolean; count: number }>("/usage/quotas/batch", payload),
}

// ---------------- 技能 ----------------

export const skillsApi = {
  // available 走统一过滤层（情侣相关完全隐藏）；管理端 list() 同样隐藏已下线能力
  available: () => get<SkillItem[]>("/skills/available").then(filterAvailable),
  list: (params: Record<string, unknown> = {}) => get<SkillItem[]>("/skills", params).then(filterRetired),
  detail: (id: string) => get<SkillItem>(`/skills/${id}`),
  create: (payload: Record<string, unknown>) => post<SkillItem>("/skills", payload),
  /** 内置工具目录（配置 TOOL 型技能时选工具用） */
  tools: () => get<BuiltinTool[]>("/skills/tools").then(filterRetired),
  /**
   * 导入技能。dryRun=true 时只解析不落库，返回解析结果与 warnings 供确认。
   */
  import: (payload: {
    content: string
    dryRun?: boolean
    onConflict?: "rename" | "skip" | "overwrite"
    fallbackName?: string
    agentIds?: string[]
  }) =>
    post<{
      key: string
      name: string
      description: string
      type: SkillType
      category: string
      icon: string | null
      systemPrompt: string | null
      warnings: string[]
      format: "json" | "markdown" | "text" | "zip"
      files?: string[]
      dryRun?: boolean
      exists?: boolean
      existingId?: string | null
      created?: boolean
      overwritten?: boolean
      skipped?: boolean
      reason?: string
      skill?: SkillItem
    }>("/skills/import", payload),

  /**
   * 从 zip 技能包导入。
   *
   * 用 multipart 上传（zip 是二进制，不能塞进 JSON），
   * dryRun 与 onConflict 通过表单字段传递。
   */
  importZip: (
    file: File,
    options: { dryRun?: boolean; onConflict?: "rename" | "skip" | "overwrite" } = {}
  ) => {
    const form = new FormData()
    form.append("file", file)
    if (options.dryRun) form.append("dryRun", "true")
    if (options.onConflict) form.append("onConflict", options.onConflict)

    return post<{
      key: string
      name: string
      description: string
      type: SkillType
      category: string
      icon: string | null
      systemPrompt: string | null
      warnings: string[]
      format: "zip"
      files?: string[]
      dryRun?: boolean
      exists?: boolean
      existingId?: string | null
      created?: boolean
      overwritten?: boolean
      skipped?: boolean
      reason?: string
      skill?: SkillItem
    }>("/skills/import-zip", form)
  },

  update: (id: string, payload: Record<string, unknown>) =>
    patch<SkillItem>(`/skills/${id}`, payload),
  toggle: (id: string, enabled: boolean) =>
    patch<SkillItem>(`/skills/${id}/toggle`, { enabled }),
  bindAgents: (id: string, agentIds: string[]) =>
    patch<SkillItem>(`/skills/${id}/agents`, { agentIds }),
  remove: (id: string) => del<{ success: boolean }>(`/skills/${id}`),
  run: (id: string, input: Record<string, unknown>, conversationId?: string) =>
    post<{
      runId: string
      success: boolean
      output?: unknown
      error?: string
      durationMs: number
    }>(`/skills/${id}/run`, { input, conversationId }),
  myRuns: (params: Record<string, unknown> = {}) =>
    get<Paged<SkillRun>>("/skills/runs/mine", params),
  runs: (params: Record<string, unknown> = {}) =>
    get<Paged<SkillRun>>("/skills/runs", params),
  stats: (days = 7) =>
    get<{
      total: number
      success: number
      failed: number
      avgDurationMs: number
      byStatus: { status: string; count: number }[]
      bySkill: {
        skill: { id: string; name: string; key: string } | null
        runs: number
        success: number
        failed: number
        avgDurationMs: number
      }[]
      byDay: { date: string; runs: number; failed: number }[]
    }>("/skills/stats", { days }),
}

// ---------------- 浏览器 ----------------

export const browserApi = {
  sessions: (params: Record<string, unknown> = {}) =>
    get<Paged<BrowserSession>>("/browser/sessions", params),
  create: (payload: {
    name?: string
    startUrl?: string
    headless?: boolean
    /** LOCAL 用户本地浏览器（默认）｜SERVER 服务端浏览器（需服务器内存充足） */
    executor?: "LOCAL" | "SERVER"
    /** 本地客户端类型：WEB 网页端直连｜EXTENSION 浏览器扩展 */
    clientKind?: "WEB" | "EXTENSION"
  }) => post<BrowserSession>("/browser/sessions", payload),
  detail: (id: string) =>
    get<
      BrowserSession & {
        steps: BrowserStep[]
        commands: BrowserCommandItem[]
        clientOnline: boolean
      }
    >(`/browser/sessions/${id}`),
  steps: (id: string, sinceSeq = 0) =>
    get<BrowserStep[]>(`/browser/sessions/${id}/steps`, { sinceSeq }),
  action: (
    id: string,
    payload: {
      action: string
      selector?: string
      /** goto 传目标地址；type 传输入文本；evaluate 传脚本；press 传按键；scroll 传方向或像素 */
      value?: string
      timeout?: number
    }
  ) => post<BrowserActionResult>(`/browser/sessions/${id}/actions`, payload),
  close: (id: string) => del<{ success: boolean }>(`/browser/sessions/${id}`),

  // ---------- 本地浏览器执行通道 ----------

  /** 下发一条指令给本地浏览器（服务端只入队，不渲染） */
  enqueue: (
    id: string,
    payload: { action: string; selector?: string; value?: string; timeout?: number }
  ) => post<BrowserCommandItem>(`/browser/sessions/${id}/commands`, payload),

  /** 指令队列：前端展示执行进度 */
  commands: (id: string, sinceSeq = 0) =>
    get<{ items: BrowserCommandItem[] }>(`/browser/sessions/${id}/commands`, {
      sinceSeq
    }),

  /** 本地客户端心跳 */
  heartbeat: (id: string, clientKind: "WEB" | "EXTENSION" = "WEB") =>
    post<{ success: boolean }>(`/browser/sessions/${id}/heartbeat`, { clientKind }),
}

// ---------------- 智能体 ----------------

export const agentsApi = {
  // available 走统一过滤层（理由同 skillsApi.available）
  available: () => get<AgentItem[]>("/agents/available").then(filterAvailable),
  list: (params: Record<string, unknown> = {}) =>
    get<AgentItem[]>("/agents", params).then(filterRetired),
  detail: (id: string) => get<AgentItem>(`/agents/${id}`),
  create: (payload: Record<string, unknown>) => post<AgentItem>("/agents", payload),
  update: (id: string, payload: Record<string, unknown>) =>
    patch<AgentItem>(`/agents/${id}`, payload),
  toggle: (id: string, enabled: boolean) =>
    patch<AgentItem>(`/agents/${id}/toggle`, { enabled }),
  remove: (id: string) => del<{ success: boolean }>(`/agents/${id}`),
}

// ---------------- 语义路由 ----------------

/** 语义路由建议：id 一定在真实清单里（后端已校验），reason 可能为空串 */
export interface AgentSuggestion {
  agentId: string
  name: string
  reason: string
}

export const chatApi = {
  /**
   * 让后端结合上下文判断「这更像该找谁」。
   * 判不出来时 suggestion 为 null —— 前端不展示任何提示。
   */
  suggestAgent: (payload: { conversationId?: string; content: string }) =>
    post<{ suggestion: AgentSuggestion | null }>("/chat/suggest-agent", payload)
}

// ---------------- 看板 ----------------

export const dashboardApi = {
  mine: () => get<MyDashboard>("/dashboard/mine"),
  summary: () => get<DashboardSummary>("/dashboard/summary"),
  trends: (days = 14) => get<DashboardTrendPoint[]>("/dashboard/trends", { days }),
  rankings: () => get<DashboardRankings>("/dashboard/rankings"),
  activity: (limit = 15) => get<AuditLog[]>("/dashboard/activity", { limit }),
}

// ---------------- 审计 ----------------

export const auditApi = {
  list: (params: Record<string, unknown> = {}) =>
    get<Paged<AuditLog>>("/audit-logs", params),
  facets: () =>
    get<{
      actions: { value: string; count: number }[]
      resources: { value: string; count: number }[]
    }>("/audit-logs/facets"),
  detail: (id: string) => get<AuditLog>(`/audit-logs/${id}`),
}

// ---------------- 校园导览（UCASS） ----------------

export const campusApi = {
  library:(params:Record<string,unknown>={})=>get<Paged<CampusGuideHit>>('/campus/library',params),
  activities:(params:Record<string,unknown>={})=>get<Paged<import('./types').CampusActivity>>('/campus/activities',params),
  activityStats:(days=14)=>get<import('./types').CampusActivityStats>('/campus/activity/stats',{days}),
  collections:()=>get<{value:string;label:string;count:number}[]>('/campus/collections'),
  meta: () => get<CampusMeta>("/campus/meta"),
  categories: () => get<CampusCategories>("/campus/categories"),

  /** 检索办理指引；mode=full 需要 campus:full 权限，后端会自动降级 */
  search: (params: { q: string; mode?: CampusGuideMode; limit?: number;collection?:string }) =>
    get<CampusSearchResult>("/campus/search", params),

  /** 纯文本指引，供对话与技能复用 */
  answer: (params: { q: string; mode?: CampusGuideMode; limit?: number }) =>
    get<{ query: string; mode: CampusGuideMode; text: string }>("/campus/answer", params),

  items: (params: Record<string, unknown> = {}) =>
    get<Paged<CampusGuideHit>>("/campus/items", params),

  item: (id: string) => get<CampusGuideHit>(`/campus/items/${id}`),

  filter: (params: {
    key: "dept" | "access" | "detailStatus" | "type"
    value: string
    limit?: number
  }) => get<CampusGuideHit[]>("/campus/filter", params),

  /** 打开导览页面：只打开 + 指路，不代填表、不代提交 */
  open: (payload: {
    itemId?: string
    url?: string
    reuse?: boolean
    headless?: boolean
    width?: number
    height?: number
  }) => post<CampusOpenResult>("/campus/runs", payload),

  runs: (params: Record<string, unknown> = {}) =>
    get<Paged<CampusRun>>("/campus/runs", params),

  runDetail: (id: string) => get<CampusRunDetail>(`/campus/runs/${id}`),

  /** 轮询最新画面 */
  frame: (id: string, fullPage = false) =>
    get<CampusFrame>(`/campus/runs/${id}/frame`, { fullPage }),

  /** 勾选某一步已完成（由学生自己操作） */
  advance: (id: string, step: number, done = true, note?: string) =>
    post<{
      run: CampusRun
      hints: CampusStepHint[]
      doneCount: number
      total: number
    }>(`/campus/runs/${id}/steps`, { step, done, note }),

  /** 只做视觉标注：指哪里，不点哪里。selector 与 text 二选一 */
  highlight: (
    id: string,
    payload: { selector?: string; text?: string; label?: string; clear?: boolean }
  ) =>
    post<{
      cleared?: boolean
      matched: number
      error?: string
      screenshotPath?: string
      frame?: CampusFrame | null
    }>(`/campus/runs/${id}/highlight`, payload),

  /** 学生主动滚动导览页面（只移动视口，不点击） */
  scroll: (id: string, y = 600) =>
    post<{ success: boolean; frame?: CampusFrame | null }>(`/campus/runs/${id}/scroll`, { y }),

  reload: (id: string) => post<BrowserActionResult & { frame?: CampusFrame | null }>(`/campus/runs/${id}/reload`),
  close: (id: string) => post<{ success: boolean }>(`/campus/runs/${id}/close`),
  stats: (days = 14) => get<CampusRunStats>("/campus/runs/stats", { days }),
}

// ---------------- 自学习反馈 ----------------

export const learningApi = {
  /** 可选的点踩原因（供前端下拉） */
  reasons: () => get<string[]>("/learning/reasons"),

  /** 对某条助手回复点赞/点踩 */
  submit: (payload: SubmitFeedbackInput) =>
    post<{ feedbackId: string; createdLearning: number }>("/learning/feedback", payload),

  /** 查询当前用户对某条消息的评价 */
  forMessage: (messageId: string) =>
    get<MessageFeedback | null>(`/learning/feedback/${messageId}`),

  /** 撤销自己的评价 */
  revoke: (messageId: string) =>
    del<{ success: boolean }>(`/learning/feedback/${messageId}`),

  // ---------- 管理侧 ----------

  /** 学习概览 */
  overview: (days = 7) => get<LearningOverview>("/learning/overview", { days }),

  /** 学习条目列表 */
  list: (params: { agentId?: string; status?: string; page?: number; pageSize?: number } = {}) =>
    get<Paged<AgentLearning>>("/learning/items", params),

  /** 审核学习条目 */
  review: (
    id: string,
    payload: {
      status: "APPROVED" | "REJECTED"
      instruction?: string
      kind?: "CORRECTION" | "PREFERENCE" | "FAQ"
      pinAnswer?:boolean
      fixedAnswer?:string
    }
  ) => patch<AgentLearning>(`/learning/items/${id}`, payload),

  /** 删除学习条目 */
  remove: (id: string) => del<{ success: boolean }>(`/learning/items/${id}`),
}
