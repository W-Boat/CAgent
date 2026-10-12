<script setup lang="ts">
import AnswerVersions from '@/components/AnswerVersions.vue'
import ImageTransferProgress from '@/components/ImageTransferProgress.vue'
import {useImageAttachments} from '@/composables/useImageAttachments'
import {regenerateChat,type ChatStreamHandlers} from '@/api/chat-stream'
import {stripToolMarkup} from '@/utils/output-boundary'
import OutputPreferenceSelect from "@/components/OutputPreferenceSelect.vue"
import {useOutputPreference} from "@/composables/useOutputPreference"
const {outputPreference}=useOutputPreference()
import { composerKeys } from '@/utils/composer'
import { useConversationHistory } from '@/composables/useConversationHistory'
import { useConversationDraft } from '@/composables/useConversationDraft' 
import AgentRunDetails from '@/components/AgentRunDetails.vue'
import type {AgentRunProgress,AgentRunMetrics} from '@/api/chat-stream'

import {cleanAnswerReferences} from '@/utils/answer-references'
import KnowledgeSources from '@/components/KnowledgeSources.vue'
import KnowledgeShortcuts from '@/components/KnowledgeShortcuts.vue'
import {normalizeKnowledgeSources} from '@/utils/knowledge-sources'
import type {KnowledgeSource} from '@/api/chat-stream'

/**
 * 管理端聊天 · 新版界面（next）。
 *
 * 行为与经典版 ChatView.vue 1:1 对齐：路由联动、元数据并发加载、SSE 全套
 * 事件、rAF 批量刷新、会话重命名/置顶/导出/删除、反馈弹窗等全部照搬；
 * 差别只在视觉 —— 令牌来自 styles/next.css（.nx-root 作用域），Codex 风格
 * 窄内容列 + 发丝线分层。
 *
 * 正文通过共享 CardMessage 渲染地图、知识与彩蛋卡片；会话仍由后端
 * 在 onMeta 时自动建立并回填 id，历史不会自动播放全屏效果。
 */
defineOptions({ name: "chat" })

import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { useRoute, useRouter } from "vue-router"
import { agentsApi, conversationsApi, modelsApi, skillsApi } from "@/api"
import { streamChat } from "@/api/chat-stream"
import {
  copyText,
  downloadJson,
  formatCost,
  formatDuration,
  formatTokens,
  fromNow,
  truncate
} from "@/utils/format"
import { registerClosable } from "@/utils/back-navigation"
import { dedupeSkills } from "@/utils/skills"
import {
  AUTO_SKILL_PREFIXES,
  RECOMMENDED_SKILL_PREFIXES,
  pickDefaultModel,
  pickSkillKeysByPrefix
} from "@/utils/skill-presets"
import { createStreamTyper } from "@/utils/stream-typewriter"
import { toastError, toastOk } from "@/api/client"
import { useAuthStore } from "@/stores/auth"
import { useCampusNetStore } from "@/stores/campus-net"
import MarkdownView from "@/components/MarkdownView.vue"
const CardMessage=defineAsyncComponent(()=>import('@/components/CardMessage.vue'))
import FeedbackDialog from "@/components/FeedbackDialog.vue"
import CAgentMark from "@/components/CAgentMark.vue"
import type {
  AgentItem,
  ConversationItem,
  MessageItem,
  ModelItem,
  SkillItem
} from "@/api/types"

interface ToolEvent {
  id: string
  name: string
  args?: Record<string, unknown>
  result?: string
  state: "running" | "done" | "failed" | "stopped"
  cached?:boolean
  durationMs?:number
}

interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  reasoning?: string
  createdAt: string
  status?: string
  error?: string
  flagged?: boolean
  streaming?: boolean
  kbHits?: KnowledgeSource[]
  runProgress?:AgentRunProgress
  runMetrics?:AgentRunMetrics
  images?: string[]
  toolEvents?: ToolEvent[]
  usage?: { totalTokens: number; costUsd?: number; latencyMs: number }
  modelName?: string
  /** 视图态：思维链折叠块是否展开（跟着消息对象走，id 回填后也不丢） */
  reasoningOpen?: boolean
}

/**
 * avatar 字段是「图片地址 / emoji / 空」三态 —— 库里存的多为表情符号，
 * 直接当 <img> 的 src 会得到碎图，必须先判断是不是图片地址再分流。
 */
function isImageUrl(value?: string | null): boolean {
  if (!value) return false
  const v = value.trim()
  return (
    /^data:image\//i.test(v) ||
    /^https?:\/\//i.test(v) ||
    // 站内静态资源（后端截图等）
    v.startsWith("/")
  )
}

const auth = useAuthStore()
const campusNet = useCampusNetStore()
const route = useRoute()
const router = useRouter()

const conversations = ref<ConversationItem[]>([])
const messages = ref<ChatMessage[]>([])
const models = ref<ModelItem[]>([])
const agents = ref<AgentItem[]>([])
const allSkills = ref<SkillItem[]>([])

const keyword = ref("")
const activeId = ref<string>("")
const selectedModelId = ref<string>("")

/**
 * 所选模型是否支持视觉（图片理解）。校内本地模型与 deepseek 均为纯文本，
 * 不支持时隐藏图片入口（发了图模型必然答错）；字段缺失按支持处理不误伤。
 */
const visionSupported = computed(
  () => models.value.find((m) => m.id === selectedModelId.value)?.supportsVision !== false
)
const selectedAgentId = ref<string>("")
const pickedSkills = ref<string[]>([])
const draft = ref("")
const pendingImages = ref<string[]>([])
const {imagePreparing,imageTransfer,prepare:prepareImages,beginUpload,uploadProgress,finishUpload}=useImageAttachments(pendingImages,activeId,message=>ElMessage.warning(message))
const streaming = ref(false)
const loadingConversations = ref(false)
/** 侧栏显隐：桌面常驻，≤860px 转抽屉后才生效 */
const sidebarHidden = ref(false)

const scrollEl = ref<HTMLElement>()
const inputEl = ref<HTMLTextAreaElement>()
const fileInput = ref<HTMLInputElement>()
const composer = composerKeys(send)
useConversationDraft(activeId, draft, pendingImages)
watch(draft, () => void nextTick(autoGrow))
const { loadingMessages, historyError, loadingEarlier, hasEarlier, loadMessages, loadEarlier } =
  useConversationHistory(activeId, messages, scrollEl, toChatMessage, (id) => {
    const conv = conversations.value.find(c => c.id === id)
    if (conv?.modelId) selectedModelId.value = conv.modelId
    selectedAgentId.value = conv?.agentId || ''
  }, scrollToBottom)

// 反馈相关状态（经典版同款：弹窗由 FeedbackDialog 承担）
const feedbackState = ref<Record<string, "positive" | "negative" | null>>({})
const feedbackDialogVisible = ref(false)
const feedbackMessageId = ref("")
const feedbackPositive = ref(true)

let abortStream: (() => void) | null = null
let searchTimer: number | undefined

/** 用户是否还贴在会话底部（决定流式输出时要不要自动跟随） */
const pinnedToBottom = ref(true)

/** 窄屏：会话列表转为浮层抽屉 */
const narrowQuery =
  typeof window !== "undefined" ? window.matchMedia("(max-width: 860px)") : null
const isNarrow = ref(narrowQuery?.matches ?? false)
let onNarrowCleanup: (() => void) | undefined

/**
 * 流式输出走打字机平滑器（utils/stream-typewriter.ts）：
 * 网络到达的全文先累计，rAF 循环按自适应步长逐帧「写」进正文 ——
 * 突发不整块灌入、网络结束后续播完才撤光标；onFrame 与文字写入
 * 严格同帧，把贴底滚动挂上去后自动滚动是连续的。
 *
 * ⚠️ write 里必须写**响应式代理**：push 进 messages 的原始对象不触发渲染，
 * 所以这里按 id 从 messages.value 取回代理再赋值。
 */
const typer = createStreamTyper({
  write: (raw, text) => {
    const id = (raw as ChatMessage).id
    const proxy = messages.value.find((m) => m.id === id) ?? (raw as ChatMessage)
    proxy.content = text
  },
  onFrame: () => scrollIfPinned()
})

const activeConversation = computed(() =>
  conversations.value.find((c) => c.id === activeId.value)
)

const activeAgent = computed(() =>
  agents.value.find((a) => a.id === selectedAgentId.value)
)

const starters = computed(() => {
  const list = activeAgent.value?.starters
  return Array.isArray(list) ? (list as string[]) : []
})

/**
 * 顶栏只展示实际工具技能；参考资料通过知识库自动检索。
 */
const enabledSkills = computed(() =>
  // 技能面板数据源去重：/skills/available 不去重（同名技能会被重复导入多份）
  dedupeSkills(allSkills.value.filter((s) => s.type !== "PROMPT")).slice(
    0,
    14
  )
)

/** 已勾选技能的展示信息（输入区上方可摘除的 chips） */
const pickedSkillItems = computed(() =>
  // 同样按 name+description 去重，避免重复导入的技能在 chips 里摆两份
  dedupeSkills(
    pickedSkills.value
      .map((key) => allSkills.value.find((s) => s.key === key))
      .filter((s): s is SkillItem => Boolean(s))
  )
)

/**
 * 全量去重技能清单：技能预设的前缀匹配源。
 * 不能用 enabledSkills —— 推荐知识包（kb-*）全部是 PROMPT 型，
 * 被技能面板数据源排除，匹配不到任何一个（与学生端 uniqueSkills 同源同判据）。
 */
const uniqueSkills = computed(() => dedupeSkills(allSkills.value))

/** 命中「推荐」前缀的技能 key，「本次启用」chips 据此挂小标记 */
const recommendedSkillKeys = computed(() =>
  new Set(pickSkillKeysByPrefix(uniqueSkills.value, RECOMMENDED_SKILL_PREFIXES))
)

/**
 * 技能预设：新对话开始时按前缀配置预勾选（见 utils/skill-presets.ts）。
 * 后端机制是「出现在 skills 里才注入」，所以这里只是把命中的 key 放进
 * pickedSkills —— 用户可随时在「本次启用」chips 上摘除，不是强制锁定。
 */
function applySkillPresets() {
  const keys = [
    ...pickSkillKeysByPrefix(uniqueSkills.value, AUTO_SKILL_PREFIXES),
    ...pickSkillKeysByPrefix(uniqueSkills.value, RECOMMENDED_SKILL_PREFIXES)
  ]
  for (const k of keys) {
    if (!pickedSkills.value.includes(k)) pickedSkills.value.push(k)
  }
}

// ---------------- 会话多选管理 ----------------

/** 侧栏管理模式：行点击变为切换勾选，支持批量/全部删除 */
const manageMode = ref(false)
const checkedConvIds = ref<string[]>([])

/** 是否当前列表（搜索过滤后的结果）已全部勾选 */
const allChecked = computed(
  () =>
    conversations.value.length > 0 &&
    conversations.value.every((c) => checkedConvIds.value.includes(c.id))
)

function toggleManageMode() {
  if (manageMode.value) {
    exitManageMode()
    return
  }
  manageMode.value = true
  checkedConvIds.value = []
}

function exitManageMode() {
  manageMode.value = false
  checkedConvIds.value = []
}

function toggleChecked(id: string) {
  const idx = checkedConvIds.value.indexOf(id)
  if (idx >= 0) checkedConvIds.value.splice(idx, 1)
  else checkedConvIds.value.push(id)
}

/** 全选/全不选只作用于当前列表（搜索过滤后的结果） */
function toggleSelectAll() {
  if (allChecked.value) {
    checkedConvIds.value = []
  } else {
    checkedConvIds.value = conversations.value.map((c) => c.id)
  }
}

/** 管理模式下点击行 = 切换勾选，不进入会话 */
function onConvClick(conv: ConversationItem) {
  if (manageMode.value) {
    toggleChecked(conv.id)
    return
  }
  void openConversation(conv.id)
}

/** 删除所选：allSettled 保证单个失败不中断其余；删到当前会话则清空消息区回 /chat */
async function removeChecked() {
  const ids = [...checkedConvIds.value]
  if (!ids.length) return
  const results = await Promise.allSettled(ids.map((id) => conversationsApi.remove(id)))
  const failed = results.filter((r) => r.status === "rejected").length
  if (ids.includes(activeId.value)) {
    activeId.value = ""
    messages.value = []
    if (route.params.id) router.replace("/chat")
  }
  checkedConvIds.value = []
  await loadConversations()
  if (failed) {
    ElMessage.warning(`${ids.length - failed} 个已删除，${failed} 个删除失败`)
  } else {
    toastOk(`已删除 ${ids.length} 个对话`)
  }
}

/** 全部删除：搜索过滤态下只删过滤结果；二次确认后清空并退出管理模式 */
async function removeAllConversations() {
  const ids = conversations.value.map((c) => c.id)
  if (!ids.length) {
    ElMessage.info("没有可删除的会话")
    return
  }
  const scopeHint = keyword.value
    ? `当前处于搜索过滤状态，只删除筛选出的 ${ids.length} 个对话`
    : `将删除全部 ${ids.length} 个对话`
  try {
    await ElMessageBox.confirm(`${scopeHint}，删除后不可恢复，确定继续吗？`, "全部删除", {
      type: "warning",
      confirmButtonText: "全部删除",
      cancelButtonText: "取消"
    })
  } catch {
    return
  }
  const results = await Promise.allSettled(ids.map((id) => conversationsApi.remove(id)))
  const failed = results.filter((r) => r.status === "rejected").length
  if (ids.includes(activeId.value)) {
    activeId.value = ""
    messages.value = []
    if (route.params.id) router.replace("/chat")
  }
  checkedConvIds.value = []
  manageMode.value = false
  await loadConversations()
  if (failed) {
    ElMessage.warning(`${ids.length - failed} 个已删除，${failed} 个删除失败`)
  } else {
    toastOk(`已删除 ${ids.length} 个对话`)
  }
}

// ---------------- 数据加载 ----------------

let listRequest = 0
async function loadConversations() {
  const request = ++listRequest
  // 已有数据时不再显示骨架屏，避免搜索时列表整块闪动
  if (!conversations.value.length) loadingConversations.value = true
  try {
    const page = await conversationsApi.mine({
      page: 1,
      pageSize: 50,
      keyword: keyword.value || undefined
    })
    if (request === listRequest) conversations.value = page.items
  } catch (error) {
    toastError(error, "会话列表加载失败")
  } finally {
    if (request === listRequest) loadingConversations.value = false
  }
}

/** loadMeta 自动挑中的默认模型 id：用户手动改过之后不再被校园网应答覆盖 */
let autoPickedModelId = ""

/** 元数据三个接口互不依赖，并发拉取；单个失败不影响其余 */
async function loadMeta() {
  await Promise.all([
    modelsApi
      .available()
      .then((list) => {
        models.value = list
        if (!selectedModelId.value) {
          // 校园网模式下默认模型优先校内本地部署（pickDefaultModel 内含回落）
          const def = pickDefaultModel(list, campusNet.campus)
          if (def) {
            selectedModelId.value = def.id
            autoPickedModelId = def.id
          }
        }
      })
      .catch(() => undefined),
    agentsApi
      .available()
      .then((list) => {
        agents.value = list
      })
      .catch(() => undefined),
    skillsApi
      .available()
      .then((list) => {
        allSkills.value = list
        // 清单到手后立即按前缀配置预勾选推荐/自动技能
        applySkillPresets()
      })
      .catch(() => undefined)
  ])
}

async function openConversation(id: string) {
  if (streaming.value) {
    ElMessage.warning("生成中，请先停止当前回复")
    return
  }
  // 打开会话自动退出管理模式
  manageMode.value = false
  checkedConvIds.value = []
  activeId.value = id
  // 窄屏下会话列表是浮层，选完要收起来才能看到消息
  if (isNarrow.value) sidebarHidden.value = true
  if (route.params.id !== id) router.replace(`/chat/${id}`)
  await loadMessages(id)
}


function toChatMessage(item: MessageItem): ChatMessage {
  const images = (item.attachments as { images?: string[] } | null)?.images
  const toolCalls = item.toolCalls || []
  return {
    id: item.id,
    role: item.role === "user" ? "user" : "assistant",
    content: item.role==='assistant'?cleanAnswerReferences(item.content || "",new Set((item.attachments?.knowledgeSources||[]).flatMap(s=>s.citationId?[s.citationId]:[]))):item.content || "",
    reasoning: item.reasoning || undefined,
    createdAt: item.createdAt,
    status: item.status,
    error: item.error || undefined,
    flagged: item.flagged,
    images: images?.length ? images : undefined,
    kbHits: normalizeKnowledgeSources(item.attachments?.knowledgeSources),
    runMetrics:item.attachments?.agentRun,
    modelName: item.modelKey || undefined,
    toolEvents: toolCalls.map((t, i) => ({
      id: `hist-${i}`,
      name: t.name,
      args: safeParse(t.arguments),
      result: t.result,
      state: (t.status==='FAILED'?'failed':t.status==='ABORTED'?'stopped':'done') as ToolEvent['state'],cached:t.cached,durationMs:t.durationMs
    })),
    usage: item.totalTokens
      ? { totalTokens: item.totalTokens, latencyMs: item.latencyMs || 0 }
      : undefined
  }
}

function safeParse(raw?: string): Record<string, unknown> | undefined {
  if (!raw) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return { raw }
  }
}

// ---------------- 滚动 ----------------

/**
 * 事件后的贴底（新消息入列、切会话）。打字期间的逐帧跟随由
 * typer 的 onFrame → scrollIfPinned 负责，与文字写入严格同帧；
 * 这里的 smooth 参数只服务「一次性的大跳」（发送、点回到底部）。
 */
async function scrollToBottom(smooth = false) {
  await nextTick()
  pinnedToBottom.value = true
  const el = scrollEl.value
  if (!el) return
  if (smooth) {
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
  } else {
    scrollIfPinned()
  }
}

/**
 * 「是否贴底」只能由滚动事件记录：在写入时现算的话，
 * 内容刚长高距底值已变大，会把贴底的用户误判成在翻历史而停止跟随。
 */
function scrollIfPinned() {
  const el = scrollEl.value
  if (!el || !pinnedToBottom.value) return
  el.scrollTop = el.scrollHeight
}

function onScroll() {
  const el = scrollEl.value
  if (!el) return
  const distance = el.scrollHeight - el.scrollTop - el.clientHeight
  pinnedToBottom.value = distance < 48
}

function onSearch() {
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => void loadConversations(), 320)
}

// ---------------- 会话操作 ----------------

/**
 * 新建对话等破坏性操作在流式中一律拦下（经典版策略）：
 * 与学生端「先停流再清空」不同，管理端把「停止」做成显式按钮，
 * 避免误触侧栏时静默丢掉正在生成的回答。
 */
async function newConversation() {
  if (streaming.value) {
    ElMessage.warning("生成中，请先停止当前回复")
    return
  }
  // 新建对话自动退出管理模式
  manageMode.value = false
  checkedConvIds.value = []
  activeId.value = ""
  messages.value = []
  // 新对话回到预设态：清掉上一轮手动勾选，重新应用推荐/自动技能
  pickedSkills.value = []
  applySkillPresets()
  if (isNarrow.value) sidebarHidden.value = true
  if (route.params.id) router.replace("/chat")
  void nextTick(() => inputEl.value?.focus())
}

async function onConvCommand(command: string, conv: ConversationItem) {
  if (command === "rename") {
    try {
      const { value } = await ElMessageBox.prompt("请输入新的会话标题", "重命名", {
        inputValue: conv.title,
        confirmButtonText: "保存",
        cancelButtonText: "取消",
        inputValidator: (v) => (v && v.trim().length > 0 ? true : "标题不能为空")
      })
      await conversationsApi.update(conv.id, { title: value.trim() })
      conv.title = value.trim()
      toastOk("已重命名")
    } catch {
      /* 取消 */
    }
  } else if (command === "pin") {
    try {
      await conversationsApi.update(conv.id, { pinned: !conv.pinned })
      await loadConversations()
    } catch (error) {
      toastError(error)
    }
  } else if (command === "export") {
    try {
      const data = await conversationsApi.export(conv.id)
      downloadJson(data, `conversation-${conv.id}.json`)
    } catch (error) {
      toastError(error)
    }
  } else if (command === "delete") {
    try {
      await ElMessageBox.confirm(`确定删除会话「${conv.title}」吗？`, "删除会话", {
        type: "warning",
        confirmButtonText: "删除",
        cancelButtonText: "取消"
      })
    } catch {
      return
    }
    try {
      await conversationsApi.remove(conv.id)
      if (activeId.value === conv.id) {
        activeId.value = ""
        messages.value = []
        if (route.params.id) router.replace("/chat")
      }
      await loadConversations()
      ElMessage.success("已删除")
    } catch (error) {
      toastError(error)
    }
  }
}

function clearView() {
  messages.value = []
  toastOk("已清空当前显示")
}

function openFeedback(messageId: string, positive: boolean) {
  feedbackMessageId.value = messageId
  feedbackPositive.value = positive
  feedbackDialogVisible.value = true
}

function onFeedbackSubmitted() {
  // 更新本地状态，标记该消息已反馈
  feedbackState.value[feedbackMessageId.value] = feedbackPositive.value
    ? "positive"
    : "negative"
}

function pickAgent(agent: AgentItem) {
  selectedAgentId.value = agent.id
  onAgentChange(agent.id)
}

function onAgentChange(id: string) {
  if (!id) return
  const agent = agents.value.find((a) => a.id === id)
  if (agent?.greeting && messages.value.length === 0) {
    ElMessage.info(agent.greeting)
  }
}

function useStarter(text: string) {
  draft.value = text
  void nextTick(() => {
    autoGrow()
    inputEl.value?.focus()
  })
}

// ---------------- 输入 ----------------

function toggleSkill(key: string) {
  const idx = pickedSkills.value.indexOf(key)
  if (idx >= 0) pickedSkills.value.splice(idx, 1)
  else pickedSkills.value.push(key)
}

/** 自适应高度：先归零再读 scrollHeight，否则高度只会增不会减 */
function autoGrow() {
  const el = inputEl.value
  if (!el) return
  el.style.height = "auto"
  el.style.height = `${Math.min(el.scrollHeight, 190)}px`
}

function pickImage() {
  // 双保险：入口已隐藏，但仍防键盘/插件触发（当前模型无视觉时直接忽略）
  if (!visionSupported.value || streaming.value || imagePreparing.value) return
  fileInput.value?.click()
}

async function onFilesPicked(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ""
  if(streaming.value || !visionSupported.value)return
  await prepareImages(files)
}

// ---------------- 发送 / 流式 ----------------

/**
 * 发送（模板入口）必须**零参**：模板事件会把 PointerEvent 传进首参，
 * 一旦给 send 加形参，事件对象恒为真值，后续基于首参的判断全会被带歪。
 * 带逻辑的实现放 runSend / runRegenerate，模板只碰零参包装。
 */
async function send() {
  await runSend()
}

async function runSend(bypassCache=false,revision?:ChatMessage) {
  const originalUser=revision?messages.value.slice(0,messages.value.indexOf(revision)).reverse().find(m=>m.role==='user'):undefined
  const content = revision?originalUser?.content||'重新生成原回答':draft.value.trim()
  if (!content || streaming.value || imagePreparing.value || loadingMessages.value || (historyError.value && !messages.value.length)) return

  const userMsg: ChatMessage = {
    id: `local-user-${Date.now()}`,
    role: "user",
    content,
    createdAt: new Date().toISOString(),
    images: pendingImages.value.length ? [...pendingImages.value] : undefined
  }
  const assistantMsg: ChatMessage = {
    id: `local-assistant-${Date.now()}`,
    role: "assistant",
    content: "",
    createdAt: new Date().toISOString(),
    streaming: true,
    toolEvents: []
  }
  if(!revision)messages.value.push(userMsg)

  const payload = {
    conversationId: activeId.value || undefined,
    content,
    outputPreference:outputPreference.value,bypassCache,
    modelId: selectedModelId.value || undefined,
    agentId: selectedAgentId.value || undefined,
    images: pendingImages.value.length ? [...pendingImages.value] : undefined,
    skills: pickedSkills.value.length ? [...pickedSkills.value] : undefined
  }

  if(revision){assistantMsg.id=revision.id;messages.value.splice(messages.value.indexOf(revision),1,assistantMsg)}else messages.value.push(assistantMsg)

  if(!revision){draft.value = "";pendingImages.value = []}
  void nextTick(autoGrow)
  streaming.value = true
  // 刚发出的消息做一次平滑滚落（后续的逐帧跟随由 typer 驱动）
  await scrollToBottom(true)

  // target 取自响应式数组即代理；typer 以它为键（引用稳定，不受 onMeta 改 id 影响）
  const userMsgRef = originalUser || userMsg
  const target = revision?messages.value.find(m=>m.id===revision.id)!:messages.value[messages.value.length - 1]

  const request=(handlers:ChatStreamHandlers)=>revision?regenerateChat({conversationId:activeId.value!,messageId:revision.id,modelId:selectedModelId.value||undefined,outputPreference:outputPreference.value},handlers):streamChat(payload,handlers)
  if(!revision&&payload.images?.length)beginUpload()
  const { abort, done } = request({
    onUploadProgress:uploadProgress,
    onRuntime:p=>{target.runProgress=p},
    onKb: p=>{target.kbHits=normalizeKnowledgeSources(p.hits)},
    onMeta: (meta) => {
      // 新会话的首条消息：后端此刻才建会话，把真实 id 同步进 URL
      if (!activeId.value) {
        activeId.value = meta.conversationId
        router.replace(`/chat/${meta.conversationId}`)
        void loadConversations()
      }
      userMsgRef.id = meta.userMessageId
      target.id = meta.assistantMessageId
      target.modelName = meta.model.name
      if (meta.title && meta.conversationId === activeId.value && activeConversation.value) activeConversation.value.title = meta.title
    },
    onText: (text) => {
      typer.push(target, text)
    },
    onReasoning: (text) => {
      target.reasoning = (target.reasoning || "") + text
    },
    onToolStart: (p) => {
      target.toolEvents = target.toolEvents || []
      target.toolEvents.push({
        id: p.id,
        name: p.name,
        args: p.arguments,
        state: "running"
      })
      if (pinnedToBottom.value) void scrollToBottom()
    },
    onToolResult: (p) => {
      const ev = target.toolEvents?.find((t) => t.id === p.id)
      if (ev) {
        ev.result = p.result
        ev.state = p.isError?'failed':'done'
        ev.cached=p.cached;ev.durationMs=p.durationMs
      }
      if (p.name === "browser_control" && !p.isError) {
        ElMessage.success("浏览器操作已执行，可在「浏览器操控」查看步骤")
      }
    },
    onUsage: (usage) => {
      target.usage = {
        totalTokens: usage.totalTokens,
        costUsd: usage.costUsd,
        latencyMs: usage.latencyMs
      }
    },
    onDone: (result) => {
      finishUpload(result.status)
      target.status = result.status
      target.runMetrics=result.runtime
      for(const tool of target.toolEvents||[])if(tool.state==='running')tool.state=result.status==='ABORTED'?'stopped':'failed'
      if (result.status === "FAILED" && !target.error) {
        target.error = "生成失败，请稍后重试"
      }
      if (result.flagged) target.flagged = true
      // 网络侧结束：已收文本按打字机节奏播完，播完才撤光标（streaming）
      typer.end(target, () => {
        target.streaming = false
      })
    },
    onError: (message) => {
      // 出错就完整落盘，不再播动画（错误信息要立刻可见）
      typer.flush(target)
      target.error = message
      if(revision&&!target.content){target.content=revision.content;target.reasoning=revision.reasoning;target.kbHits=revision.kbHits}
      target.streaming = false
    }
  })

  abortStream = abort

  try {
    await done
  } finally {
    streaming.value = false
    abortStream = null
    // target.streaming 由 typer.end 的播完回调撤下，这里不能提前关
    // 标题可能由后端自动生成，拉一次列表让侧栏跟上
    await loadConversations().catch(() => undefined)
    if (pinnedToBottom.value) await scrollToBottom()
  }
}

function stop() {
  abortStream?.()
  abortStream = null
  // 用户主动停止：剩余文本立即完整落盘，不再播打字机动画
  typer.flushAll()
  for(const message of messages.value)if(message.streaming){message.streaming=false;message.status='ABORTED'}
  ElMessage.info("已停止生成")
}

/** 重新生成（模板入口，零参，理由见 send） */
async function regenerate() {
  await runRegenerate()
}

async function runRegenerate(selected?:ChatMessage){
 const target=selected||[...messages.value].reverse().find(m=>m.role==='assistant');if(!activeId.value||streaming.value||!target)return
 await runSend(true,target)
}

async function copyMessage(text: string) {
  await copyText(text)
  toastOk("已复制到剪贴板")
}

/** 顶栏「更多」菜单：重新生成 / 清空当前显示 */
function onHeadCommand(command: string) {
  if (command === "regenerate") void regenerate()
  else if (command === "clear") clearView()
}

// ---------------- 生命周期 ----------------

/**
 * 窄屏会话列表是浮层抽屉，接住返回键。
 *
 * 展开时按返回键应收起列表而不是退出对话。登记一次即可，
 * 打开状态由 isOpen 现场求值（避免登记/注销的时序竞争）。
 */
const unregisterSidebar = registerClosable({
  name: "chat-sidebar",
  isOpen: () => isNarrow.value && !sidebarHidden.value,
  close: () => {
    sidebarHidden.value = true
  }
})

onMounted(async () => {
  // 窄屏进来先收起会话列表，把宽度让给消息
  if (isNarrow.value) sidebarHidden.value = true
  const onNarrowChange = (e: MediaQueryListEvent) => {
    isNarrow.value = e.matches
    // 从窄屏切回宽屏时把列表放出来，避免「菜单不见了」
    sidebarHidden.value = e.matches
  }
  narrowQuery?.addEventListener("change", onNarrowChange)
  onNarrowCleanup = () => narrowQuery?.removeEventListener("change", onNarrowChange)

  await loadMeta()
  await loadConversations()

  // 进入时按路由参数恢复会话
  const routeId = route.params.id as string | undefined
  if (routeId) {
    activeId.value = routeId
    await loadMessages(routeId)
  }

  // 从智能体广场跳转过来时预选智能体
  const presetAgent = route.query.agentId as string | undefined
  if (presetAgent) selectedAgentId.value = presetAgent
})

// 路由参数切换会话（顶栏新建、浏览器前进后退都会走到这里）
watch(
  () => route.params.id,
  (id) => {
    const next = (id as string) || ""
    if (next !== activeId.value) {
      activeId.value = next
      if (next) void loadMessages(next)
      else messages.value = []
    }
  }
)

/*
 * 校园网模式变化后重挑默认模型。
 * 弹窗通常在挂载早期应答，但可能与清单加载竞态；这里兜住「清单先到、
 * 稍后才应答校园网」的情况 —— 仅在当前选中的还是自动挑的那个（未被用户
 * 手动改过）时才覆盖，尊重用户的显式选择。
 */
watch(
  () => campusNet.campus,
  () => {
    const cur = models.value.find((m) => m.id === selectedModelId.value)
    if (selectedModelId.value && cur && cur.id !== autoPickedModelId) return
    const def = pickDefaultModel(models.value, campusNet.campus)
    if (def) {
      selectedModelId.value = def.id
      autoPickedModelId = def.id
    }
  }
)

onBeforeUnmount(() => {
  window.clearTimeout(searchTimer)
  typer.dispose()
  unregisterSidebar()
  onNarrowCleanup?.()
  abortStream?.()
})
</script>

<template>
  <!--
    新版管理端聊天。所有 next 令牌挂 .nx-root（styles/next.css），
    暗色由 html.dark 自动生效。页面在 AppLayoutNext 的 fullscreen 内容区里，
    高度吃满内容区（外壳顶栏仍可见）。
  -->
  <div class="nx-root nx-admin-chat">
    <!-- 窄屏抽屉遮罩：点击收起会话列表 -->
    <div v-if="isNarrow && !sidebarHidden" class="ac-backdrop" @click="sidebarHidden = true"></div>

    <!-- ============ 侧栏：新建 / 搜索 / 会话列表 ============ -->
    <aside class="ac-side" :class="{ 'is-hidden': sidebarHidden }">
      <div class="ac-side-actions">
        <button type="button" class="nx-btn nx-btn-primary ac-new-btn" @click="newConversation">
          <el-icon><Plus /></el-icon>
          新建对话
        </button>
        <!-- 管理模式切换：批量勾选/删除会话 -->
        <button type="button" class="nx-btn nx-btn-secondary" @click="toggleManageMode">
          {{ manageMode ? "完成" : "管理" }}
        </button>
      </div>

      <!-- 管理模式操作条：全选 / 批量删除 / 全部删除 -->
      <div v-if="manageMode" class="ac-manage-bar">
        <button type="button" class="nx-btn nx-btn-sm nx-btn-secondary" @click="toggleSelectAll">
          {{ allChecked ? "全不选" : "全选" }}
        </button>
        <button
          type="button"
          class="nx-btn nx-btn-sm nx-btn-danger"
          :disabled="!checkedConvIds.length"
          @click="removeChecked"
        >
          删除所选({{ checkedConvIds.length }})
        </button>
        <button
          type="button"
          class="nx-btn nx-btn-sm nx-btn-danger"
          @click="removeAllConversations"
        >
          全部删除
        </button>
        <button type="button" class="nx-btn nx-btn-sm nx-btn-ghost" @click="exitManageMode">
          取消
        </button>
      </div>

      <OutputPreferenceSelect/>
      <div class="ac-side-search">
        <div class="nx-search">
          <el-icon><Search /></el-icon>
          <input
            v-model="keyword"
            type="search"
            class="nx-input"
            placeholder="搜索会话标题"
            aria-label="搜索会话标题"
            @input="onSearch"
          />
        </div>
      </div>

      <div class="ac-convs">
        <!-- 首次加载用骨架屏占位，避免列表轮廓跳动 -->
        <div v-if="loadingConversations && !conversations.length" class="ac-conv-skel">
          <div v-for="i in 6" :key="i" class="nx-skel ac-conv-skel-row"></div>
        </div>

        <template v-else>
          <div v-if="!conversations.length" class="ac-empty">
            {{ keyword ? "没有匹配的会话" : "还没有会话" }}
          </div>

          <div
            v-for="conv in conversations"
            :key="conv.id"
            class="ac-conv"
            :class="{ 'is-active': conv.id === activeId }"
            role="button"
            tabindex="0"
            @click="onConvClick(conv)"
            @keydown.enter.prevent="onConvClick(conv)"
          >
            <!-- 管理模式：自绘勾选框（next.css 无 checkbox 原语）；点击行也只切换勾选 -->
            <span
              v-if="manageMode"
              class="ac-check"
              :class="{ 'is-checked': checkedConvIds.includes(conv.id) }"
              aria-hidden="true"
              @click.stop="toggleChecked(conv.id)"
            >
              <el-icon v-if="checkedConvIds.includes(conv.id)"><Check /></el-icon>
            </span>
            <div class="ac-conv-body">
              <div class="ac-conv-title">
                <el-icon v-if="conv.pinned" class="ac-pin"><Star /></el-icon>
                {{ conv.title }}
              </div>
              <div class="ac-conv-meta">
                {{ conv.messageCount }} 条 · {{ fromNow(conv.lastMessageAt || conv.updatedAt) }}
              </div>
            </div>
            <el-dropdown v-if="!manageMode" trigger="click" @command="(c: string) => onConvCommand(c, conv)">
              <button
                type="button"
                class="nx-icon-btn ac-conv-more"
                aria-label="会话操作"
                @click.stop
              >
                <el-icon><MoreFilled /></el-icon>
              </button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="rename">
                    <el-icon><EditPen /></el-icon>重命名
                  </el-dropdown-item>
                  <el-dropdown-item command="pin">
                    <el-icon><Star /></el-icon>{{ conv.pinned ? "取消置顶" : "置顶" }}
                  </el-dropdown-item>
                  <el-dropdown-item command="export">
                    <el-icon><Download /></el-icon>导出 JSON
                  </el-dropdown-item>
                  <el-dropdown-item command="delete" divided>
                    <el-icon><Delete /></el-icon>删除
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </template>
      </div>
    </aside>

    <!-- ============ 主区 ============ -->
    <section class="ac-main">
      <header class="ac-top">
        <button
          v-if="isNarrow"
          type="button"
          class="nx-icon-btn"
          aria-label="打开会话列表"
          @click="sidebarHidden = false"
        >
          <el-icon><Expand /></el-icon>
        </button>

        <div class="ac-title">{{ activeConversation?.title || "新对话" }}</div>

        <div class="ac-top-tools">
          <el-select
            v-model="selectedModelId"
            placeholder="选择模型"
            class="ac-model"
            :disabled="streaming"
            aria-label="选择模型"
          >
            <el-option v-for="m in models" :key="m.id" :label="m.name" :value="m.id">
              <span>{{ m.name }}</span>
              <span class="ac-opt-hint">{{ m.providerName || m.providerKey }}</span>
            </el-option>
          </el-select>

          <el-select
            v-model="selectedAgentId"
            placeholder="智能体"
            class="ac-agent"
            clearable
            :disabled="streaming"
            aria-label="选择智能体"
            @change="onAgentChange"
          >
            <el-option v-for="a in agents" :key="a.id" :label="a.name" :value="a.id" />
          </el-select>

          <!-- 技能开关：多选面板，勾选结果以 chips 形式落在输入区上方 -->
          <el-popover placement="bottom-end" :width="264" trigger="click">
            <template #reference>
              <button
                type="button"
                class="nx-icon-btn"
                :class="{ 'is-on': pickedSkills.length > 0 }"
                aria-label="选择技能"
                title="技能"
              >
                <el-icon><MagicStick /></el-icon>
              </button>
            </template>
            <div class="ac-skill-pop">
              <div v-if="!enabledSkills.length" class="ac-pop-empty">没有可用技能</div>
              <button
                v-for="s in enabledSkills"
                :key="s.key"
                type="button"
                class="ac-skill-row"
                @click="toggleSkill(s.key)"
              >
                <span class="ac-skill-name">{{ s.name }}</span>
                <el-icon v-if="pickedSkills.includes(s.key)" class="ac-skill-check"><Check /></el-icon>
              </button>
            </div>
          </el-popover>

          <el-dropdown trigger="click" @command="onHeadCommand">
            <button type="button" class="nx-icon-btn" aria-label="更多操作" title="更多操作">
              <el-icon><MoreFilled /></el-icon>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item
                  command="regenerate"
                  :disabled="streaming || !activeId || messages.length === 0"
                >
                  <el-icon><RefreshRight /></el-icon>重新生成上一条回复
                </el-dropdown-item>
                <el-dropdown-item command="clear" :disabled="streaming">
                  <el-icon><Brush /></el-icon>清空当前显示
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </header>

      <!-- 滚动舞台：悬浮的「回到底部」挂在同一层 -->
      <div class="ac-stage">
        <div ref="scrollEl" class="ac-scroll" @scroll.passive="onScroll">
          <div class="ac-body">
            <div v-if="loadingMessages" class="history-state" role="status"><span class="history-pulse"></span>正在加载对话…</div>
            <div v-if="historyError" class="history-state history-failed" role="alert"><span>{{ historyError }}</span><button type="button" class="nx-btn nx-btn-secondary" @click="messages.length ? loadEarlier() : loadMessages(activeId)">重试加载</button></div>
            <div v-if="hasEarlier && !loadingMessages" class="history-more"><button type="button" class="nx-btn nx-btn-secondary" :disabled="loadingEarlier || streaming" @click="loadEarlier">{{ loadingEarlier ? '正在加载…' : '加载更早的消息' }}</button></div>
            <!-- 空态：品牌问候 + 开场建议 + 智能体卡片 -->
            <div v-if="messages.length === 0 && !loadingMessages && !historyError" class="ac-welcome">
              <CAgentMark :size="44" class="ac-welcome-logo" />
              <h1 class="ac-welcome-title">{{ activeAgent?.name || auth.siteName }}</h1>
              <p class="ac-welcome-desc">
                {{
                  activeAgent?.description ||
                  "选择下方智能体或直接提问，支持技能调用与浏览器操控。"
                }}
              </p>

              <div v-if="activeAgent?.greeting" class="ac-greeting">
                <MarkdownView :content="activeAgent.greeting" />
              </div>

              <div v-if="starters.length" class="nx-starters ac-starters">
                <button
                  v-for="(s, i) in starters"
                  :key="i"
                  type="button"
                  class="nx-starter"
                  @click="useStarter(s)"
                >
                  {{ s }}
                </button>
              </div>

              <div v-if="agents.length" class="ac-agents">
                <div
                  v-for="a in agents.slice(0, 6)"
                  :key="a.id"
                  class="ac-agent-card"
                  :class="{ 'is-on': a.id === selectedAgentId }"
                  role="button"
                  tabindex="0"
                  @click="pickAgent(a)"
                  @keydown.enter.prevent="pickAgent(a)"
                >
                  <div class="ac-agent-avatar">
                    <!-- avatar 三态：URL / emoji / 首字，直接当 img 会碎图 -->
                    <img v-if="isImageUrl(a.avatar)" :src="a.avatar!" alt="" />
                    <template v-else-if="a.avatar">{{ a.avatar }}</template>
                    <template v-else>{{ a.name.slice(0, 1) }}</template>
                  </div>
                  <div class="ac-agent-meta">
                    <div class="ac-agent-name">{{ a.name }}</div>
                    <div class="ac-agent-desc">{{ truncate(a.description, 42) }}</div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 消息流：用户右对齐气泡，助手通栏正文 -->
            <div
              v-for="msg in messages"
              :key="msg.id"
              class="nx-msg"
              :class="msg.role === 'user' ? 'nx-msg-user' : 'nx-msg-ai'"
            >
              <!-- 用户消息 -->
              <template v-if="msg.role === 'user'">
                <div v-if="msg.images?.length" class="nx-msg-images ac-msg-images">
                  <img v-for="(img, i) in msg.images" :key="i" :src="img" alt="已发送的图片" />
                </div>
                <div class="nx-msg-bubble">{{ msg.content }}</div>
              </template>

              <!-- 助手消息 -->
              <template v-else>
                <div class="nx-msg-head">
                  <span class="ac-msg-badge" aria-hidden="true">
                    <el-icon><MagicStick /></el-icon>
                  </span>
                  <span class="nx-msg-name">{{ msg.modelName || "助手" }}</span>
                  <span class="nx-msg-time">{{ fromNow(msg.createdAt) }}</span>
                  <span v-if="msg.status === 'FAILED'" class="nx-msg-status">· 失败</span>
                  <span v-else-if="msg.status === 'ABORTED'" class="nx-msg-status">· 已中断</span>
                  <span v-if="msg.flagged" class="ac-flag">敏感标记</span>
                </div>

                <!-- 思维链：默认收起，flat 折叠块 -->
                <div v-if="msg.reasoning" class="ac-reasoning">
                  <button
                    type="button"
                    class="ac-reasoning-toggle"
                    :aria-expanded="msg.reasoningOpen ? 'true' : 'false'"
                    @click="msg.reasoningOpen = !msg.reasoningOpen"
                  >
                    <el-icon class="ac-reasoning-caret" :class="{ 'is-open': msg.reasoningOpen }">
                      <CaretRight />
                    </el-icon>
                    思考过程
                  </button>
                  <div v-if="msg.reasoningOpen" class="ac-reasoning-body">{{ stripToolMarkup(msg.reasoning) }}</div>
                </div>

                <AgentRunDetails :progress="msg.runProgress" :metrics="msg.runMetrics" :tools="msg.toolEvents" :status="msg.streaming ? 'STREAMING' : msg.status" detailed/>

                <KnowledgeSources :sources="msg.kbHits"/>
                <div class="nx-msg-body">
                  <CardMessage :effect-key="msg.id" :content="msg.content" :streaming="!!msg.streaming" :has-knowledge-sources="!!msg.kbHits?.length" :knowledge-sources="msg.kbHits" @ask="draft=$event"/>
                  <span v-if="msg.streaming" class="nx-caret" aria-hidden="true"></span>
                </div>

                <!-- 用量：tokens / 成本 / 耗时 -->
                <div v-if="msg.usage" class="nx-muted ac-usage">
                  {{ formatTokens(msg.usage.totalTokens) }} tokens
                  <template v-if="msg.usage.costUsd !== undefined">
                    · {{ formatCost(msg.usage.costUsd) }}
                  </template>
                  · {{ formatDuration(msg.usage.latencyMs) }}
                </div>

                <div v-if="msg.error" class="nx-msg-error">{{ msg.error }}</div>

                <!-- 消息操作：悬停才出现，不干扰阅读 -->
                <div v-if="!msg.streaming && msg.content" class="ac-msg-actions">
                  <button
                    type="button"
                    class="nx-icon-btn"
                    aria-label="复制回答"
                    title="复制"
                    @click="copyMessage(msg.content)"
                  >
                    <el-icon><CopyDocument /></el-icon>
                  </button>
                  <AnswerVersions :conversation-id="activeId || ''" :message-id="msg.id" :disabled="streaming" @selected="Object.assign(msg,toChatMessage($event))" @generate="runRegenerate(msg)" />
                  <button
                    type="button"
                    class="nx-icon-btn"
                    :class="{ 'is-on': feedbackState[msg.id] === 'positive' }"
                    aria-label="点赞"
                    title="点赞"
                    @click="openFeedback(msg.id, true)"
                  >
                    <el-icon><Top /></el-icon>
                  </button>
                  <button
                    type="button"
                    class="nx-icon-btn"
                    :class="{ 'is-on': feedbackState[msg.id] === 'negative' }"
                    aria-label="点踩"
                    title="点踩"
                    @click="openFeedback(msg.id, false)"
                  >
                    <el-icon><Bottom /></el-icon>
                  </button>
                </div>
              </template>
            </div>
          </div>
        </div>

        <!-- 回到底部 -->
        <button
          v-if="!pinnedToBottom && messages.length"
          type="button"
          class="ac-tobottom"
          aria-label="回到最新消息"
          @click="scrollToBottom(true)"
        >
          <el-icon><Bottom /></el-icon>
        </button>
      </div>

      <!-- 输入区 -->
      <footer class="ac-composer">
        <div class="ac-composer-inner">
          <div class="ac-composer-box">
            <KnowledgeShortcuts :disabled="streaming" @ask="draft=$event"/>
            <!-- 已选技能 chips：点击摘除 -->
            <div v-if="pickedSkillItems.length" class="ac-skills">
              <span class="ac-skills-label">本次启用</span>
              <button
                v-for="s in pickedSkillItems"
                :key="s.key"
                type="button"
                class="nx-chip is-on"
                :aria-label="`停用技能 ${s.name}`"
                @click="toggleSkill(s.key)"
              >
                {{ s.name }}
                <!-- 前缀配置命中的推荐项：小字标记，与经典版同款语义 -->
                <span v-if="recommendedSkillKeys.has(s.key)" class="ac-chip-rec">推荐</span>
                <span class="ac-chip-x" aria-hidden="true">×</span>
              </button>
            </div>

            <ImageTransferProgress :state="imageTransfer"/>
            <div v-if="pendingImages.length" class="ac-previews">
              <div v-for="(img, i) in pendingImages" :key="i" class="ac-preview">
                <img :src="img" alt="待发送图片" />
                <button
                  type="button"
                  aria-label="移除图片"
                  @click="pendingImages.splice(i, 1)"
                >
                  ×
                </button>
              </div>
            </div>

            <textarea
              ref="inputEl"
              v-model="draft"
              class="ac-textarea"
              rows="1"
              placeholder="输入问题，Enter 发送，Shift + Enter 换行"
              aria-label="输入消息"
              :disabled="streaming || loadingMessages || (Boolean(historyError) && !messages.length)"
              @input="autoGrow"
              @keydown="composer.keydown" @compositionstart="composer.start" @compositionend="composer.end"
            ></textarea>

            <div class="ac-composer-foot">
              <div class="ac-composer-left">
                <button
                  v-if="visionSupported"
                  type="button"
                  class="nx-icon-btn"
                  aria-label="添加图片"
                  title="添加图片，自动压缩后发送"
                  :disabled="streaming || imagePreparing"
                  @click="pickImage"
                >
                  <el-icon><Picture /></el-icon>
                </button>
                <span class="ac-char">{{ draft.length }} 字</span>
              </div>

              <div class="ac-composer-right">
                <button
                  v-if="streaming"
                  type="button"
                  class="nx-btn nx-btn-secondary"
                  @click="stop"
                >
                  <el-icon><VideoPause /></el-icon>
                  停止生成
                </button>
                <button
                  v-else
                  type="button"
                  class="nx-btn nx-btn-primary"
                  :disabled="!draft.trim() || imagePreparing || loadingMessages || (Boolean(historyError) && !messages.length)"
                  @click="send"
                >
                  <el-icon><Promotion /></el-icon>
                  发送
                </button>
              </div>
            </div>
          </div>
        </div>

        <input
          ref="fileInput"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          class="ac-file"
          @change="onFilesPicked"
        />
      </footer>
    </section>

    <!-- 反馈对话框 -->
    <FeedbackDialog
      v-model="feedbackDialogVisible"
      :message-id="feedbackMessageId"
      :positive="feedbackPositive"
      @submitted="onFeedbackSubmitted"
    />
  </div>
</template>

<style scoped>
/*
 * 专属样式只写本视图的布局与细节；原语（按钮 / 输入 / chip / 消息骨架 /
 * 工具行 / starters / 过渡）全部来自 styles/next.css，此处不重复定义。
 */

.nx-root.nx-admin-chat {
  /* 任务规格：管理端聊天侧栏 280px（覆盖共享默认 248px，只影响本视图） */
  --nx-sidebar-width: 280px;

  position: relative;
  display: flex;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  /* 造一个独立堆叠上下文：抽屉/遮罩的 z-index 不与外壳侧栏互相干扰 */
  isolation: isolate;
  background: var(--nx-bg);
}

/* ═══════════ 侧栏 ═══════════ */

.ac-side {
  display: flex;
  flex-direction: column;
  flex: 0 0 var(--nx-sidebar-width);
  width: var(--nx-sidebar-width);
  min-height: 0;
  background: var(--nx-bg-soft);
  border-right: 1px solid var(--nx-border);
}

.ac-side-actions {
  display: flex;
  gap: 6px;
  padding: 14px 12px 6px;
}

/* 新建对话占满主列，管理切换保持内容宽度 */
.ac-new-btn {
  flex: 1;
}

.ac-side-actions .nx-btn svg,
.ac-side-actions .nx-btn .el-icon {
  font-size: 15px;
}

/* 管理模式操作条：全选 / 删除所选 / 全部删除 / 取消 */
.ac-manage-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 0 12px 6px;
}

.ac-side-search {
  padding: 8px 12px 6px;
}

.ac-convs {
  flex: 1;
  min-height: 0;
  padding: 4px 8px 12px;
  overflow-y: auto;
}

.ac-conv-skel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 4px 0;
}

.ac-conv-skel-row {
  height: 44px;
  border-radius: var(--nx-radius-sm);
}

.ac-empty {
  padding: 18px 8px;
  font-size: 12.5px;
  color: var(--nx-text-3);
  text-align: center;
}

/* flat 行：active 用悬停灰 + 左侧 2px accent 竖线 */
.ac-conv {
  position: relative;
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 8px 8px 8px 12px;
  cursor: pointer;
  border-radius: var(--nx-radius-sm);
  transition: background 0.15s ease;
}

.ac-conv:hover {
  background: var(--nx-surface-hover);
}

.ac-conv.is-active {
  background: var(--nx-surface-hover);
}

.ac-conv.is-active::before {
  position: absolute;
  top: 7px;
  bottom: 7px;
  left: 0;
  width: 2px;
  content: "";
  background: var(--nx-accent);
  border-radius: 1px;
}

.ac-conv:focus-visible {
  outline: none;
  box-shadow: var(--nx-focus-ring);
}

.ac-conv-body {
  flex: 1;
  min-width: 0;
}

.ac-conv-title {
  display: flex;
  gap: 5px;
  align-items: center;
  overflow: hidden;
  font-size: 13px;
  font-weight: 500;
  color: var(--nx-text);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.ac-pin {
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--nx-accent);
}

.ac-conv-meta {
  margin-top: 2px;
  overflow: hidden;
  font-size: 11.5px;
  color: var(--nx-text-3);
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* 行尾「…」：hover / 激活行才出现，平时保持列表干净 */
.ac-conv-more {
  flex: 0 0 24px;
  width: 24px;
  height: 24px;
  opacity: 0;
}

.ac-conv:hover .ac-conv-more,
.ac-conv.is-active .ac-conv-more,
.ac-conv-more:focus-visible {
  opacity: 1;
}

.ac-conv-more .el-icon {
  font-size: 14px;
}

/* 管理模式自绘勾选框：flat 方框 + accent 打勾（next.css 无 checkbox 原语） */
.ac-check {
  display: flex;
  flex: 0 0 16px;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: var(--nx-text-invert);
  background: var(--nx-surface);
  border: 1px solid var(--nx-border-strong);
  border-radius: 4px;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.ac-check.is-checked {
  background: var(--nx-accent);
  border-color: var(--nx-accent);
}

.ac-check .el-icon {
  font-size: 11px;
}

/* ═══════════ 主区 ═══════════ */

.ac-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--nx-bg);
}

.ac-top {
  display: flex;
  flex: 0 0 auto;
  gap: 10px;
  align-items: center;
  height: var(--nx-topbar-height);
  padding: 0 16px;
  background: var(--nx-bg);
  border-bottom: 1px solid var(--nx-border);
}

/* 标题 flex:1 + min-width:0 + 省略号：标题过长时先收缩，选择器不被挤压也不溢出 */
.ac-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 14px;
  font-weight: 600;
  color: var(--nx-text);
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* 工具按钮组保持最小宽度不换行：挤压时由标题（flex:1 + min-width:0）先收缩 */
.ac-top-tools {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: nowrap;
  gap: 6px;
  align-items: center;
}

.ac-model {
  /* 定宽防挤压标题；≤900px 断点再收窄（见文件末尾媒体查询） */
  width: 170px;
}

.ac-agent {
  width: 150px;
}

/* el-select 选中值/占位文本溢出省略；clearable 的清除钮悬浮出现时不挤压文本 */
.ac-model :deep(.el-select__selection),
.ac-agent :deep(.el-select__selection) {
  flex-wrap: nowrap;
  min-width: 0;
}

.ac-model :deep(.el-select__selected-item),
.ac-agent :deep(.el-select__selected-item) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ac-opt-hint {
  float: right;
  margin-left: 12px;
  font-size: 11.5px;
  color: var(--nx-text-3);
}

/* 滚动舞台：悬浮按钮与滚动区同层定位 */
.ac-stage {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
}

.ac-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

/* Codex 风格窄内容列，居中 + 充足留白 */
.ac-body {
  display: flex;
  flex-direction: column;
  gap: 28px;
  max-width: var(--nx-content-width);
  padding: 28px 24px 44px;
  margin: 0 auto;
}

.ac-tobottom {
  position: absolute;
  bottom: 14px;
  left: 50%;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  color: var(--nx-text-2);
  cursor: pointer;
  background: var(--nx-surface);
  border: 1px solid var(--nx-border-strong);
  border-radius: 999px;
  box-shadow: var(--nx-shadow-md);
  transform: translateX(-50%);
  transition: color 0.15s ease, background 0.15s ease;
}

.ac-tobottom:hover {
  color: var(--nx-text);
  background: var(--nx-surface-hover);
}

/* ---------- 欢迎空态 ---------- */

.ac-welcome {
  display: flex;
  flex-direction: column;
  gap: 14px;
  align-items: center;
  padding-top: 6vh;
  text-align: center;
}

.ac-welcome-logo {
  color: var(--nx-accent);
}

.ac-welcome-title {
  margin: 4px 0 0;
  font-size: 22px;
  font-weight: 650;
  letter-spacing: -0.01em;
  color: var(--nx-text);
}

.ac-welcome-desc {
  max-width: 40rem;
  margin: 0;
  font-size: 13.5px;
  line-height: 1.7;
  color: var(--nx-text-2);
}

.ac-greeting {
  width: 100%;
  padding: 12px 16px;
  font-size: 14px;
  color: var(--nx-text);
  text-align: left;
  background: var(--nx-surface);
  border: 1px solid var(--nx-border);
  border-radius: var(--nx-radius);
}

.ac-starters {
  width: 100%;
  margin-top: 6px;
}

/* 智能体卡片网格 */
.ac-agents {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 10px;
  width: 100%;
  margin-top: 18px;
}

/*
 * 智能体卡片：类名不能叫 ac-agent（与顶栏 el-select 的 .ac-agent 冲突，
 * 那里的 width:140px 会把卡片定宽、网格拉伸失效 → 高低参差的根源）。
 */
.ac-agent-card {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  /* 统一最小高度：名称/描述长短不再导致网格高低参差 */
  min-height: 66px;
  padding: 12px;
  cursor: pointer;
  text-align: left;
  background: var(--nx-surface);
  border: 1px solid var(--nx-border);
  border-radius: var(--nx-radius);
  transition: border-color 0.15s ease, background 0.15s ease;
}

.ac-agent-card:hover {
  background: var(--nx-surface-hover);
  border-color: var(--nx-border-strong);
}

/* 选中态：accent 描边统一（1px 边宽与默认态一致，不跳动） */
.ac-agent-card.is-on {
  background: var(--nx-accent-soft);
  border-color: var(--nx-accent);
}

.ac-agent-card:focus-visible {
  outline: none;
  box-shadow: var(--nx-focus-ring);
}

.ac-agent-avatar {
  display: flex;
  flex: 0 0 30px;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  font-size: 14px;
  font-weight: 600;
  color: var(--nx-text-2);
  background: var(--nx-bg-soft);
  border: 1px solid var(--nx-border);
  border-radius: 50%;
  overflow: hidden;
  user-select: none;
}

.ac-agent-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ac-agent-meta {
  flex: 1;
  min-width: 0;
}

.ac-agent-name {
  overflow: hidden;
  font-size: 13px;
  font-weight: 600;
  color: var(--nx-text);
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* 描述统一 2 行截断，配合 min-height 让每张卡片等高 */
.ac-agent-desc {
  display: -webkit-box;
  margin-top: 2px;
  overflow: hidden;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--nx-text-3);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

/* ---------- 消息流 ---------- */

/* 用户消息：图片挂在气泡上方，右对齐（对齐逻辑在 next.css） */
.nx-msg-user .ac-msg-images {
  margin-bottom: 8px;
}

/* 助手消息头的小方格身份牌 */
.ac-msg-badge {
  display: flex;
  flex: 0 0 22px;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  color: var(--nx-accent);
  user-select: none;
  background: var(--nx-accent-soft);
  border: 1px solid var(--nx-accent-border);
  border-radius: var(--nx-radius-sm);
}

.ac-msg-badge .el-icon {
  font-size: 12px;
}

/* 敏感标记：小面积 danger，不抢正文 */
.ac-flag {
  padding: 1px 8px;
  font-size: 11px;
  font-weight: 550;
  color: var(--nx-danger);
  background: var(--nx-danger-soft);
  border: 1px solid var(--nx-danger);
  border-radius: 999px;
}

/* 思维链折叠块：flat、muted、默认收起 */
.ac-reasoning {
  margin-bottom: 8px;
}

.ac-reasoning-toggle {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  padding: 3px 8px;
  font-family: inherit;
  font-size: 12px;
  color: var(--nx-text-3);
  cursor: pointer;
  background: transparent;
  border: 1px solid var(--nx-border);
  border-radius: var(--nx-radius-sm);
  transition: color 0.15s ease, background 0.15s ease, border-color 0.15s ease;
}

.ac-reasoning-toggle:hover {
  color: var(--nx-text-2);
  background: var(--nx-surface-hover);
  border-color: var(--nx-border-strong);
}

.ac-reasoning-toggle:focus-visible {
  outline: none;
  box-shadow: var(--nx-focus-ring);
}

.ac-reasoning-caret {
  font-size: 12px;
  transition: transform 0.15s ease;
}

.ac-reasoning-caret.is-open {
  transform: rotate(90deg);
}

.ac-reasoning-body {
  max-height: 260px;
  margin-top: 6px;
  padding: 8px 12px;
  overflow-y: auto;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--nx-text-2);
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--nx-bg-soft);
  border: 1px solid var(--nx-border);
  border-radius: var(--nx-radius-sm);
}

/* 工具行正文列：名称行 + 参数/结果详情 */
.ac-tool-main {
  flex: 1;
  min-width: 0;
}

.ac-tool-line {
  display: flex;
  gap: 8px;
  align-items: center;
}

.ac-tool-detail {
  margin-top: 4px;
  padding: 5px 8px;
  overflow-x: auto;
  font-family: var(--nx-font-mono);
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--nx-text-3);
  white-space: pre-wrap;
  word-break: break-all;
  background: var(--nx-surface);
  border-radius: var(--nx-radius-sm);
}

.ac-tool-result {
  max-height: 180px;
  overflow-y: auto;
}

/* 用量行 */
.ac-usage {
  margin-top: 6px;
}

/* 悬停操作条 */
.ac-msg-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
  margin-top: 4px;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.nx-msg-ai:hover .ac-msg-actions,
.ac-msg-actions:focus-within {
  opacity: 1;
}

.ac-msg-actions .nx-icon-btn:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

@media (hover: none), (pointer: coarse) {
  .ac-msg-actions { opacity: 1; }
}

/* ---------- 输入区 ---------- */

.ac-composer {
  flex: 0 0 auto;
  padding: 0 24px calc(16px + env(safe-area-inset-bottom));
  background: var(--nx-bg);
}

.ac-composer-inner {
  max-width: var(--nx-content-width);
  margin: 0 auto;
}

/* 聚焦态：accent 描边 + 焦点环（用 :focus-within，免去 JS 状态） */
.ac-composer-box {
  padding: 8px 12px;
  background: var(--nx-surface);
  border: 1px solid var(--nx-border-strong);
  border-radius: var(--nx-radius-lg);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.ac-composer-box:focus-within {
  border-color: var(--nx-accent);
  box-shadow: var(--nx-focus-ring);
}

.ac-skills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  padding: 2px 0 8px;
}

.ac-skills-label {
  font-size: 11.5px;
  color: var(--nx-text-3);
}

.ac-chip-x {
  margin-left: 2px;
  font-size: 13px;
  line-height: 1;
  opacity: 0.7;
}

button.nx-chip:hover .ac-chip-x {
  opacity: 1;
}

/* chips 内的「推荐」小字：muted 层级，标记预设来源，不抢技能名 */
.ac-chip-rec {
  margin-left: 4px;
  font-size: 11px;
  color: var(--nx-text-3);
}

.ac-previews {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 2px 0 8px;
}

.ac-preview {
  position: relative;
  width: 56px;
  height: 56px;
  overflow: hidden;
  border: 1px solid var(--nx-border);
  border-radius: var(--nx-radius);
}

.ac-preview img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ac-preview button {
  position: absolute;
  top: 2px;
  right: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  font-size: 13px;
  line-height: 1;
  color: #fff;
  cursor: pointer;
  background: rgba(0, 0, 0, 0.55);
  border: 0;
  border-radius: 50%;
}

.ac-preview button:hover {
  background: rgba(0, 0, 0, 0.75);
}

.ac-textarea {
  display: block;
  width: 100%;
  max-height: 190px;
  padding: 6px 2px 4px;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.65;
  color: var(--nx-text);
  background: transparent;
  border: 0;
  outline: none;
  resize: none;
}

.ac-textarea::placeholder {
  color: var(--nx-text-3);
}

.ac-textarea:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.ac-composer-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 2px;
}

.ac-composer-left,
.ac-composer-right {
  display: flex;
  gap: 8px;
  align-items: center;
}

.ac-char {
  font-size: 11.5px;
  color: var(--nx-text-3);
  font-variant-numeric: tabular-nums;
}

.ac-file {
  display: none;
}

/* ---------- 技能开关面板（popover 内） ---------- */

.ac-pop-empty {
  padding: 10px 4px;
  font-size: 12.5px;
  color: var(--nx-text-3);
  text-align: center;
}

.ac-skill-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 7px 8px;
  font-family: inherit;
  font-size: 13px;
  color: var(--nx-text-2);
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: var(--nx-radius-sm);
  transition: background 0.15s ease, color 0.15s ease;
}

.ac-skill-row:hover {
  color: var(--nx-text);
  background: var(--nx-surface-hover);
}

.ac-skill-row:focus-visible {
  outline: none;
  box-shadow: var(--nx-focus-ring);
}

.ac-skill-name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.ac-skill-check {
  flex: 0 0 auto;
  font-size: 13px;
  color: var(--nx-accent);
}

/* ═══════════ 窄屏：侧栏转抽屉 ═══════════ */

@keyframes ac-fade {
  from {
    opacity: 0;
  }
}

.ac-backdrop {
  position: absolute;
  inset: 0;
  z-index: 30;
  background: rgba(24, 24, 27, 0.42);
  animation: ac-fade 0.18s ease-out;
}

/*
 * ≤900px：主区减去侧栏后变窄，先收窄两个选择器给标题让位
 * （标题 flex:1 + min-width:0 + 省略号继续吃剩余宽度）。
 * 必须放在 ≤860 抽屉断点之前：≤860 时选择器转弹性换行布局，后者要赢。
 */
@media (max-width: 900px) {
  .ac-model {
    width: 138px;
  }

  .ac-agent {
    width: 118px;
  }

  /* 智能体卡片网格 ≤900px 两列 */
  .ac-agents {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 860px) {
  /* 侧栏转为抽屉浮层，不再挤压消息区；用 transform 移出避免回流 */
  .ac-side {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    z-index: 31;
    width: min(84vw, 300px);
    flex-basis: auto;
    /* 抽屉全高：底部让出 iOS 安全区，列表底部内容不被 home 条遮住 */
    padding-bottom: env(safe-area-inset-bottom);
    box-shadow: var(--nx-shadow-lg);
    transition: transform 0.24s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .ac-side.is-hidden {
    transform: translateX(-102%);
    pointer-events: none;
  }

  /* 顶栏允许换行：标题一行，选择器占满下一行 */
  .ac-top {
    flex-wrap: wrap;
    height: auto;
    min-height: var(--nx-topbar-height);
    padding: 8px 12px;
  }

  .ac-title {
    flex: 1 1 auto;
  }

  .ac-top-tools {
    flex-wrap: wrap;
    gap: 6px;
    width: 100%;
  }

  .ac-model,
  .ac-agent {
    flex: 1 1 132px;
    width: auto;
    min-width: 0;
  }

  .ac-body {
    gap: 22px;
    padding: 18px 14px 32px;
  }

  .ac-composer {
    padding: 0 12px calc(12px + env(safe-area-inset-bottom));
  }

  /* 移动端用户气泡放宽到 88%（next.css 统一为 min(85%, 34rem)；共享文件不动，此处覆盖） */
  .nx-msg-user .nx-msg-bubble {
    max-width: 88%;
  }

  /* markdown 表格在窄屏横向滚动，避免撑破气泡 */
  .ac-body :deep(.markdown-body table) {
    display: block;
    overflow-x: auto;
  }

  .ac-body :deep(.markdown-body pre) {
    font-size: 12px;
  }
}

/*
 * ≤640px：选择器降为弹性下限（两枚 + 两枚图标钮可收进一行，约 300px），
 * 防极窄屏横向溢出；重新生成/清空等次要操作已在顶栏「…」菜单里，无需再藏按钮。
 */
@media (max-width: 640px) {
  .ac-model,
  .ac-agent {
    flex: 1 1 104px;
    width: auto;
    min-width: 0;
  }
}

/* ≤560px：智能体卡片网格单列 */
@media (max-width: 560px) {
  .ac-agents {
    grid-template-columns: 1fr;
  }
}
</style>

<style scoped>
.history-state{display:flex;align-items:center;justify-content:center;gap:12px;padding:24px 16px;color:var(--nx-text-2);font-size:14px;flex-wrap:wrap}.history-failed{color:var(--nx-danger);background:var(--nx-danger-soft);border-radius:12px;overflow-wrap:anywhere}.history-more{text-align:center;margin:0 0 24px}.history-pulse{width:8px;height:8px;border-radius:50%;background:var(--nx-accent);animation:history-pulse 1.2s ease-in-out infinite}@keyframes history-pulse{50%{opacity:.3}}@media(prefers-reduced-motion:reduce){.history-pulse{animation:none}}
</style>
