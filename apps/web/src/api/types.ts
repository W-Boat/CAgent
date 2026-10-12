import type {StudentDisplaySettings} from "@/utils/student-display"
/** 与后端 Prisma 模型对应的前端类型定义 */

export interface ApiEnvelope<T> {
  code: number
  message: string
  data: T
}

export interface Paged<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

// ---------- 认证 ----------

export interface AuthUser {
  id: string
  email: string
  username?: string | null
  name: string
  avatar?: string | null
  status: UserStatus
  department?: string | null
  studentNo?: string | null
  phone?: string | null
  roles: string[]
  roleNames?: string[]
  permissions: string[]
  lastLoginAt?: string | null
  createdAt?: string
}

export interface LoginResult {
  accessToken: string
  refreshToken: string
  expiresIn: number
  user: AuthUser
}

export interface UserQuota {
  id?: string
  userId?: string
  enabled: boolean
  dailyTokenLimit: number
  monthlyTokenLimit: number
  dailyRequestLimit: number
  rpmLimit: number
  note?: string | null
}

export interface QuotaStatus {
  allowed: boolean
  reason?: string
  used: {
    dailyTokens: number
    monthlyTokens: number
    dailyRequests: number
  }
  limits: {
    dailyTokenLimit: number
    monthlyTokenLimit: number
    dailyRequestLimit: number
    rpmLimit: number
  }
}

/** GET /usage/me/quota 与 /usage/quotas/:userId 的返回结构 */
export interface QuotaDetail {
  user: { id: string; email: string; name: string }
  quota: UserQuota
  allowed: boolean
  reason?: string
  /** 后端管理端接口使用 usage；部分接口也会回传 used，二者同义 */
  usage: QuotaStatus["used"]
  used?: QuotaStatus["used"]
  limits: QuotaStatus["limits"]
}

// ---------- 用户 / 角色 ----------

export type UserStatus = "ACTIVE" | "DISABLED" | "PENDING"

export interface UserItem {
  id: string
  email: string
  username?: string | null
  name: string
  avatar?: string | null
  status: UserStatus
  department?: string | null
  studentNo?: string | null
  phone?: string | null
  lastLoginAt?: string | null
  createdAt: string
  roles: { key: string; name: string }[]
  quota?: UserQuota | null
}

export interface UserDetail extends UserItem {
  usage: QuotaStatus
  stats: { conversations: number; messages: number }
}

export interface RoleItem {
  id: string
  key: string
  name: string
  description?: string | null
  isSystem: boolean
  sort: number
  userCount?: number
  permissionCount?: number
  /** 权限码列表 */
  permissions?: string[]
  users?: {
    id: string
    email: string
    name: string
    avatar?: string | null
    status: UserStatus
  }[]
}

/** 权限目录：按业务分组 */
export interface PermissionCatalog {
  groups: {
    key: string
    name: string
    permissions: {
      code: string
      name: string
      group: string
      description?: string | null
    }[]
  }[]
  total: number
}

// ---------- 供应商 / 模型 ----------

export type ProviderType =
  | "OPENAI_COMPATIBLE"
  | "ANTHROPIC"
  | "GOOGLE"
  | "OLLAMA"
  | "AZURE_OPENAI"

export interface ProviderItem {
  id: string
  key: string
  name: string
  type: ProviderType
  baseUrl?: string | null
  apiKeyMasked?: string | null
  hasApiKey?: boolean
  enabled: boolean
  isSystem: boolean
  sort: number
  description?: string | null
  modelCount?: number
  models?: ModelItem[]
}

/** Key 池中单把 Key 的健康状态 */
export type ApiKeyStatus = "ACTIVE" | "COOLDOWN" | "INVALID" | "DISABLED"

/**
 * 供应商 Key 池条目。
 *
 * 多把 Key 轮询使用：分摊配额、单 Key 失效时自动切换。
 * 后端只回传掩码（masked），明文永不出现。
 */
export interface ProviderApiKey {
  id: string
  providerId: string
  label?: string | null
  enabled: boolean
  status: ApiKeyStatus
  sort: number
  failureCount: number
  successCount: number
  lastUsedAt?: string | null
  lastErrorAt?: string | null
  lastError?: string | null
  /** 冷却截止时间；到期前不参与轮询 */
  cooldownUntil?: string | null
  createdAt: string
  updatedAt: string
  masked: string
}

export interface ModelItem {
  id: string
  key: string
  name: string
  providerId: string
  providerKey?: string
  providerName?: string
  /** 后台列表接口返回的嵌套供应商信息 */
  provider?: {
    id: string
    key: string
    name: string
    type: ProviderType
    enabled: boolean
  }
  providerType?: ProviderType
  /** 模型与供应商同时启用时才可用 */
  available?: boolean
  enabled: boolean
  isDefault: boolean
  sort: number
  contextWindow: number
  maxOutputTokens: number
  supportsVision: boolean
  supportsTools: boolean
  supportsStream: boolean
  inputPricePerM: number
  outputPricePerM: number
  description?: string | null
  conversationCount?: number
  extra?: Record<string, unknown> | null
}

export interface TestModelResult {
  ok: boolean
  model: string
  provider: string
  latencyMs: number
  reply: string
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
  error: string | null
}

// ---------- 会话 / 消息 ----------

export type MessageRole = "system" | "user" | "assistant" | "tool"
export type MessageStatus =
  | "PENDING"
  | "STREAMING"
  | "SUCCESS"
  | "FAILED"
  | "ABORTED"

export interface ConversationItem {
  id: string
  title: string
  userId: string
  user?: { id: string; name: string; email: string; avatar?: string | null }
  modelId?: string | null
  modelName?: string | null
  /** 管理端列表会附带关联模型 */
  model?: { id: string; key: string; name: string } | null
  agentId?: string | null
  agentName?: string | null
  /** 管理端列表会附带关联智能体 */
  agent?: { id: string; name: string } | null
  systemPrompt?: string | null
  temperature: number
  status: "ACTIVE" | "ARCHIVED" | "DELETED"
  pinned: boolean
  messageCount: number
  totalTokens: number
  lastMessageAt?: string | null
  createdAt: string
  updatedAt: string
  /** 部分接口返回 _count 而不是 messageCount */
  _count?: { messages: number }
}

export interface MessageItem {
  id: string
  conversationId: string
  userId: string
  role: MessageRole
  content: string
  reasoning?: string | null
  status: MessageStatus
  seq: number
  modelId?: string | null
  providerKey?: string | null
  modelKey?: string | null
  promptTokens: number
  completionTokens: number
  totalTokens: number
  latencyMs: number
    attachments?: { images?: string[];knowledgeSources?:import('./chat-stream').KnowledgeSource[];agentRun?:import('./chat-stream').AgentRunMetrics } | null
  toolCalls?: { id?:string;name: string; arguments: string; result?: string;status?:string;cached?:boolean;durationMs?:number }[] | null
  error?: string | null
  finishReason?: string | null
  flagged: boolean
  flagNote?: string | null
  createdAt: string
}

// ---------- 用量 ----------

export interface UsageOverview {
  totals: {
    requests: number
    promptTokens: number
    completionTokens: number
    totalTokens: number
    costUsd: number
    avgLatencyMs: number
    failedRequests: number
    successRate: number
  }
  bySource: {
    source: string
    requests: number
    totalTokens: number
    costUsd: number
  }[]
}

export interface UsageTrendPoint {
  date: string
  tokens: number
  promptTokens: number
  completionTokens: number
  costUsd: number
  requests: number
  /** 部分接口会附带失败数 */
  failed?: number
}

export interface UsageByModel {
  providerKey: string
  modelKey: string
  requests: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costUsd: number
  avgLatencyMs: number
}

export interface UsageByUser {
  userId: string
  user: { id: string; email: string; name: string; department?: string | null } | null
  requests: number
  totalTokens: number
  costUsd: number
}

export interface UsageRecord {
  id: string
  userId: string
  user?: { id: string; email: string; name: string; department?: string | null }
  conversationId?: string | null
  messageId?: string | null
  modelId?: string | null
  model?: { id: string; name: string; key: string } | null
  providerKey: string
  modelKey: string
  source: "CHAT" | "SKILL" | "BROWSER" | "EMBEDDING"
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costUsd: number
  latencyMs: number
  success: boolean
  errorCode?: string | null
  createdAt: string
}

export interface QuotaRow {
  id: string
  email: string
  name: string
  department?: string | null
  studentNo?: string | null
  status: UserStatus
  quota?: UserQuota | null
  roles: { key: string; name: string }[]
  usage: {
    dailyTokens: number
    dailyRequests: number
    monthlyTokens?: number
    monthlyRequests?: number
  }
}

// ---------- Skill ----------

export type SkillType = "PROMPT" | "TOOL" | "HTTP" | "BROWSER"

export interface SkillItem {
  id: string
  key: string
  name: string
  description: string
  type: SkillType
  category: string
  enabled: boolean
  isSystem: boolean
  icon?: string | null
  sort: number
  systemPrompt?: string | null
  inputSchema?: Record<string, any> | null
  config?: Record<string, any> | null
  permissionCode?: string | null
  /** 管理备注（仅后台可见） */
  note?: string | null
  runCount?: number
  agentCount?: number
  agents?: { id: string; name: string }[]
  createdAt: string
  updatedAt: string
}

export interface SkillRun {
  id: string
  skillId: string
  skill?: { id: string; name: string; key: string; type: SkillType }
  userId: string
  user?: { id: string; name: string; email: string }
  conversationId?: string | null
  status: "RUNNING" | "SUCCESS" | "FAILED" | "CANCELLED"
  input?: Record<string, any> | null
  output?: any
  error?: string | null
  steps?: { step: number; action: string; detail?: string; durationMs?: number }[]
  startedAt: string
  finishedAt?: string | null
  durationMs: number
}

// ---------- 浏览器 ----------

export type BrowserSessionStatus = "ACTIVE" | "CLOSED" | "CRASHED"

/** 浏览器执行位置：服务端 Chromium 还是用户本地浏览器 */
export type BrowserExecutor = "SERVER" | "LOCAL"
/** 本地客户端类型：网页端直连 / 浏览器扩展 */
export type BrowserClientKind = "WEB" | "EXTENSION"

/** 本地浏览器指令的执行状态 */
export type BrowserCommandStatus =
  | "PENDING"
  | "RUNNING"
  | "DONE"
  | "FAILED"
  | "EXPIRED"

/** 下发给本地浏览器的一条指令 */
export interface BrowserCommandItem {
  id: string
  seq: number
  action: string
  selector?: string | null
  value?: string | null
  timeout?: number
  status: BrowserCommandStatus
  result?: unknown
  error?: string | null
  url?: string | null
  title?: string | null
  durationMs?: number
  screenshotPath?: string | null
  createdAt?: string
}

export interface BrowserSession {
  id: string
  userId: string
  user?: { id: string; name: string; email: string }
  name: string
  status: BrowserSessionStatus
  headless: boolean
  /** LOCAL：网页渲染与操控在用户本地浏览器执行（默认，服务器不装 Chromium） */
  executor?: BrowserExecutor
  clientKind?: string | null
  /** 本地客户端最后心跳，用于判断在线状态 */
  lastSeenAt?: string | null
  /** 由后端计算的「本地浏览器是否在线」 */
  clientOnline?: boolean
  startUrl?: string | null
  currentUrl?: string | null
  userAgent?: string | null
  alive?: boolean
  skillRunId?: string | null
  createdAt: string
  closedAt?: string | null
  steps?: BrowserStep[]
  stepCount?: number
  /** 列表接口返回的 Prisma 计数 */
  _count?: { steps: number }
}

/** 单次动作执行结果 */
export interface BrowserActionResult {
  ok: boolean
  action: string
  url?: string
  title?: string
  data?: unknown
  screenshotPath?: string
  error?: string
  durationMs: number
}

export interface BrowserStep {
  id: string
  sessionId: string
  seq: number
  action: string
  selector?: string | null
  value?: string | null
  status: string
  error?: string | null
  url?: string | null
  title?: string | null
  screenshotPath?: string | null
  snapshot?: Record<string, any> | null
  durationMs: number
  createdAt: string
}

// ---------- 智能体 ----------

export type AgentVisibility = "PRIVATE" | "CAMPUS" | "PUBLIC"
export type AgentMode = "CHAT" | "AGENT"

/** 内置工具目录项（GET /skills/tools） */
export interface BuiltinTool {
  key: string
  name: string
  description: string
  category: string
  icon: string
  requiresKey?: boolean
  needsNetwork?: boolean
  parameters: Record<
    string,
    { type: string; description: string; enum?: string[]; default?: unknown }
  >
  required?: string[]
}

export interface AgentItem {
  id: string
  key: string
  name: string
  description?: string | null
  avatar?: string | null
  systemPrompt?: string
  greeting?: string | null
  starters?: string[] | null
  modelId?: string | null
  model?: { id: string; name: string; key: string } | null
  modelName?: string | null
  temperature?: number
  maxContextMessages?: number
  visibility: AgentVisibility
  enabled?: boolean
  isSystem?: boolean
  allowBrowser?: boolean
  /** 应用模式：CHAT 纯对话不给工具；AGENT 由模型自主调用工具 */
  mode?: AgentMode
  /** 单轮最多工具调用轮数 */
  maxToolRounds?: number
  /** 管理备注（仅后台可见） */
  note?: string | null
  sort?: number
  skills: {
    id: string
    key: string
    name: string
    description?: string
    type: SkillType
    icon?: string | null
  }[]
  conversationCount?: number
  createdAt?: string
  updatedAt?: string
}

// ---------- 设置 / 审计 / 看板 ----------

export interface SettingItem {
  key: string
  label: string
  description?: string
  type: "string" | "number" | "boolean" | "json" | "text"
  options?: { label: string; value: unknown }[]
  value: unknown
  updatedAt?: string
}

export interface AuditLog {
  id: string
  userId?: string | null
  user?: { id: string; name: string; email: string; avatar?: string | null } | null
  actor?: string | null
  action: string
  resource: string
  resourceId?: string | null
  detail?: Record<string, any> | null
  ip?: string | null
  userAgent?: string | null
  success: boolean
  createdAt: string
}

export interface DashboardSummary {
  users: { total: number; active: number; disabled: number; newToday: number }
  conversations: { total: number; today: number }
  messages: { total: number; today: number; flagged: number }
  usage: {
    requestsToday: number
    tokensToday: number
    tokensWeek: number
    tokensMonth: number
    costMonthUsd: number
    failedToday: number
  }
  providers: { total: number; enabled: number }
  models: { total: number; enabled: number }
  skills: { total: number; enabled: number; runsToday: number }
  browser: { activeSessions: number }
  agents: { enabled: number }
}

export interface DashboardTrendPoint {
  date: string
  tokens: number
  costUsd: number
  requests: number
  messages: number
  newUsers: number
  skillRuns: number
}

export interface DashboardRankings {
  users: {
    user: { id: string; name: string; email?: string; department?: string | null }
    requests: number
    tokens: number
  }[]
  models: { modelKey: string; requests: number; tokens: number }[]
  skills: { skill: { id: string; name: string; key?: string }; runs: number }[]
  agents: { agent: { id: string; name: string }; conversations: number }[]
}

export interface MyDashboard {
  stats: {
    conversations: number
    messages: number
    requestsToday: number
    tokensToday: number
    costTodayUsd: number
  }
  quota: UserQuota
  featuredSkills: {
    id: string
    key: string
    name: string
    description: string
    icon?: string | null
    category: string
  }[]
  recentConversations: {
    id: string
    title: string
    updatedAt: string
    messageCount: number
  }[]
}

export interface PublicSettings extends StudentDisplaySettings {
  timetable_enabled?: boolean
  site_name: string
  site_description: string
  allow_registration: boolean
  enable_stream: boolean
  enable_tools: boolean
  skill_enabled: boolean
  browser_enabled: boolean
  memory_enabled?:boolean
  onboarding_enabled?:boolean
  default_system_prompt: string
  default_temperature: number
  /** 学生端右上角学校 Logo 图片地址；空串/缺省 = 不显示（管理端可配） */
  student_logo_url?: string
  /** 全局默认强调色（十六进制）；用户个人选择优先于此设置 */
  default_accent_color?: string
  /** 学生端默认使用的模型 ID；空 = 平台默认（管理端可配） */
  student_default_model_id?: string
  /** 学生端出错时轮换使用的模型 ID；空 = 不轮换（管理端可配） */
  student_fallback_model_id?: string
}

// ---------- 校园导览（UCASS） ----------

export type CampusGuideMode = "guide" | "full"

/** 条目完整度：决定话术与是否需要下载附件 */
export type CampusDetailStatus =
  | "full"
  | "basic"
  | "rendered"
  | "verified"
  | "attachment_only"
  | "link_only"
  | "unavailable"

export interface CampusKeyFact {
  kind: string
  value: string
}

export interface CampusGuideHit {
  contentFormat?:string;entryMode?:string;contentCard?:Record<string,unknown>
  id: string
  externalId: number
  score: number
  title: string
  url: string
  cat: string
  type: string
  source: string
  dept?: string | null
  place?: string | null
  tel?: string | null
  campus?: string | null
  form?: string | null
  officeTime?: string | null
  contact?: string | null
  login?: string | null
  /** 公网 / 校园网/VPN / 已合并下线 */
  access?: string | null
  detailStatus: CampusDetailStatus
  subtype?: string | null
  summaryShort: string
  steps: string[]
  keyFacts: CampusKeyFact[]
  verifiedAt?: string | null
  note?: string | null
  views: number
  /** 后端判定的注意事项（VPN、附件、未启用等） */
  warnings: string[]
  canEmbed: boolean
  /** 仅 full 模式返回 */
  detail?: string | null
  detailParts?: Record<string, any> | null
  provenance?:{file:string;locator:string;trust:string;collection:string;entryKind:string;updatedAt:string|null}
  related?:CampusGuideHit[]
  matchReasons?:string[]
}

export interface CampusSearchResult {
  guidance?:{stage:'clarify'|'ready'|'not_found';intent:string;prompt:string;choices:{label:string;query:string}[];missingFields:string[];conflicts:string[]}
  query: string
  mode: CampusGuideMode
  hits: CampusGuideHit[]
  meta: { verifiedAt: string | null; total: number; schema: string }
  tip: string
}

export interface CampusMeta {
  schema: string
  verifiedAt: string | null
  builtAt: string | null
  total: number
  cats: Record<string, number>
  types: Record<string, number>
  detailStatus: Record<string, number>
  sources: Record<string, string>
  knownErrors: string[]
}

export interface CampusCategories {
  cats: { value: string; count: number }[]
  detailStatus: { value: string; count: number }[]
  access: { value: string; count: number }[]
  types: { value: string; count: number }[]
  depts: { value: string; count: number }[]
}

/** 分步提示：网页下方悬浮框逐条展示 */
export interface CampusStepHint {
  index: number
  text: string
  tip: string
  facts: CampusKeyFact[]
  done: boolean
}

/** 浏览器实时画面 */
export interface CampusFrame {
  sessionId: string
  url: string
  title: string
  screenshotPath: string
  width: number
  height: number
  capturedAt: string
  /** 本次截图失败，画面是上一帧（页面可能正在跳转） */
  stale?: boolean
}

export interface CampusPolicy {
  openOnly: boolean
  autoFill: boolean
  autoSubmit: boolean
  message: string
}

export interface CampusOpenResult {
  runId: string
  /** 服务端浏览器会话 ID；服务器不装浏览器时为 null */
  sessionId: string | null
  mode: CampusGuideMode
  hit: CampusGuideHit
  hints: CampusStepHint[]
  banner: string
  warnings: string[]
  currentStep: number
  pageOk: boolean
  openError: string | null
  frame: CampusFrame | null
  /**
   * 服务端是否给出了实时画面。
   * false 表示服务器不渲染页面，前端应展示「入口卡片 + 指引」而非画面。
   */
  hasLiveFrame?: boolean
  policy: CampusPolicy
}

export interface CampusRun {
  id: string
  userId: string
  user?: { id: string; name: string; email: string }
  itemId: string
  item?: {
    id: string
    externalId: number
    title: string
    url: string
    cat: string
    dept?: string | null
    access?: string | null
    detailStatus: CampusDetailStatus
  }
  mode: "GUIDE" | "FULL"
  currentStep: number
  completed: boolean
  browserSessionId?: string | null
  visitedUrls?: string[] | null
  stepProgress?: Record<string, boolean> | null
  note?: string | null
  createdAt: string
  updatedAt: string
  closedAt?: string | null
}

export interface CampusRunDetail {
  run: CampusRun
  hit: CampusGuideHit | null
  hints: CampusStepHint[]
  banner: string
  /** 注意事项，含「画面停在统一身份认证登录页」这类落点提示 */
  warnings: string[]
  currentStep: number
  alive: boolean
  frame: CampusFrame | null
}

export interface CampusRunStats {
  total: number
  completed: number
  completionRate: number
  trend: { date: string; runs: number }[]
  byAccess: { access: string; count: number }[]
  topItems: {
    item: { id: string; title: string; url: string; dept?: string | null }
    opens: number
  }[]
}

// ---------- 自学习反馈 ----------

export type FeedbackSource = "EXPLICIT" | "IMPLICIT"
export type LearningKind = "CORRECTION" | "PREFERENCE" | "FAQ"
export type LearningStatus = "PENDING" | "APPROVED" | "REJECTED"

export interface MessageFeedback {
  id: string
  messageId: string
  userId: string
  agentId?: string | null
  positive: boolean
  source: FeedbackSource
  reason?: string | null
  correction?: string | null
  createdAt: string
}

export interface AgentLearning {
  id: string
  agentId: string
  kind: LearningKind
  status: LearningStatus
  instruction: string
  evidence?: Record<string, any> | null
  sampleQuestion?: string | null
  supportCount: number
  injectedCount: number
  reviewedById?: string | null
  reviewedBy?: { id: string; name: string; email: string } | null
  reviewedAt?: string | null
  agent?: { id: string; key: string; name: string; avatar?: string | null } | null
  createdAt: string
  updatedAt: string
}

export interface LearningOverview {
  pending: number
  approved: number
  rejected: number
  feedbackTotal: number
  negative: number
  positive: number
  negativeRate: number
  byDay: { date: string; positive: number; negative: number }[]
  topAgents: {
    agentId: string | null
    name: string
    avatar?: string | null
    negative: number
  }[]
}

export interface SubmitFeedbackInput {
  messageId: string
  positive: boolean
  reason?: string
  correction?: string
}

export interface CampusActivity {
 id:string;eventType:string;origin:string;entryId?:string;title:string;query:string;collection:string;url:string;resultCount:number;createdAt:string;success:boolean
 user?:{id:string;name:string;email:string}|null
 references?:{id?:string;title?:string;collection?:string;used?:boolean;component?:string;errorType?:string;retryMode?:string;attempt?:number;messageId?:string}[]
}
export interface CampusActivityStats {
 since:string;startedAt?:string|null;days:number;queries:number;contentViews:number;linkClicks:number;mapViews:number;users:number;renderErrors?:number;renderRecovered?:number
 byOrigin:{origin:string;eventType:string;count:number}[]
 trend:{date:string;QUERY:number;CONTENT_VIEW:number;LINK_CLICK:number;MAP_VIEW:number;RENDER_ERROR?:number;RENDER_RECOVERED?:number}[]
 byCollection:{collection:string;matches:number;used:number}[]
 topItems:{id:string;title:string;collection:string;views:number;clicks:number;maps:number}[]
}
