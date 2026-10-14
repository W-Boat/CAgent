<script setup lang="ts">
import AnswerVersions from '@/components/AnswerVersions.vue'
import ImageTransferProgress from '@/components/ImageTransferProgress.vue'
import {useImageAttachments} from '@/composables/useImageAttachments'
import {regenerateChat,type ChatStreamHandlers} from '@/api/chat-stream'
import OutputPreferenceSelect from "@/components/OutputPreferenceSelect.vue"
import {useOutputPreference} from "@/composables/useOutputPreference"
const {outputPreference}=useOutputPreference()
import { composerKeys } from '@/utils/composer'
import { useConversationHistory } from '@/composables/useConversationHistory'
import { useConversationDraft } from '@/composables/useConversationDraft' 
import {studentDisplay} from '@/utils/student-display'
import AgentRunDetails from '@/components/AgentRunDetails.vue'
import type {AgentRunProgress,AgentRunMetrics} from '@/api/chat-stream'

import {cleanAnswerReferences} from '@/utils/answer-references'
import KnowledgeSources from '@/components/KnowledgeSources.vue'
import {normalizeKnowledgeSources} from '@/utils/knowledge-sources'
import type {KnowledgeSource} from '@/api/chat-stream'

/**
 * 学生端聊天（唯一界面，next 设计系统）。
 *
 * 视觉令牌来自 styles/next.css（.nx-root 作用域），Codex 风格
 * 窄内容列 + 发丝线分层。卡片渲染复用 StudentCard —— 其 --sc-* 配色
 * 已在 .nx-root 上重映射到新版配色，无需任何适配。
 *
 * 顶栏刻意**不放**模型 / 智能体选择器（产品决策）：
 * 「用谁回答」由三处负责 —— loadMeta 的默认挑选、模型输出的 agents 卡、
 * 失败后的语义路由建议。学生只面对一个输入框。
 */
defineOptions({ name: "student-chat" })

import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { useRouter } from "vue-router"
import KnowledgeShortcuts from '@/components/KnowledgeShortcuts.vue'
import {
  agentsApi,
  chatApi,
  conversationsApi,
  learningApi,
  modelsApi,
  skillsApi,
  type AgentSuggestion
} from "@/api"
import { memoryApi } from "@/api/memory"
import { streamChat } from "@/api/chat-stream"
import { toastError, toastOk } from "@/api/client"
import { copyText, fromNow, truncate } from "@/utils/format"
import { useAuthStore } from "@/stores/auth"
import { useThemeStore } from "@/stores/theme"
import MarkdownView from "@/components/MarkdownView.vue"
/*
 * 结构化卡片：助手回复里的 ```card 围栏切成组件渲染（消息流内）。
 * 见 utils/card-segments.ts 与 components/student/StudentCard.vue。
 */
const FeedbackDialog=defineAsyncComponent(()=>import('@/components/FeedbackDialog.vue'))
const CardMessage=defineAsyncComponent(()=>import('@/components/CardMessage.vue'))
import { buildCardProtocol, KNOWLEDGE_CARD_PROTOCOL } from "@/utils/card-protocol"
import { dedupeSkills } from "@/utils/skills"
import {
  AUTO_SKILL_PREFIXES,
  RECOMMENDED_SKILL_PREFIXES,
  pickDefaultModel,
  pickSkillKeysByPrefix
} from "@/utils/skill-presets"
import { useCampusNetStore } from "@/stores/campus-net"
import { createStreamTyper } from "@/utils/stream-typewriter"
/* 学生端自己的轻量内联 SVG 图标，静态引用按需引入 */
import {
  IconCopy,
  IconDown,
  IconImage,
  IconLogout,
  IconMenu,
  IconMoon,
  IconPin,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSend,
  IconStop,
  IconSun,
  IconThumbDown,
  IconThumbUp,
  IconTrash
} from "@/components/student/icons"
import type { AgentItem, ConversationItem, MessageItem, ModelItem, SkillItem } from "@/api/types"

interface ToolEvent {
  id: string
  name: string
  state: "running" | "done" | "failed" | "stopped"
  cached?:boolean
  durationMs?:number
}

interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  createdAt: string
  status?: string
  error?: string
  streaming?: boolean
  liveEffect?: boolean
  images?: string[]
  toolEvents?: ToolEvent[]
  modelName?: string
  /** 知识库来源卡：只摘展示要用的字段，不整包 GuideHit（含 steps 等重字段） */
  kbHits?: KnowledgeSource[]
  runProgress?:AgentRunProgress
  runMetrics?:AgentRunMetrics
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
const theme = useThemeStore()
const display=computed(()=>studentDisplay(auth.settings))
const campusNet = useCampusNetStore()
const router = useRouter()

const conversations = ref<ConversationItem[]>([])
const messages = ref<ChatMessage[]>([])
const models = ref<ModelItem[]>([])
const agents = ref<AgentItem[]>([])
/** 技能清单：服务「切换卡」的真实 key 核对与输入区上方的启用条 */
const skills = ref<SkillItem[]>([])
/** 本次请求启用的技能 key */
const pickedSkills = ref<string[]>([])

const keyword = ref("")
const activeId = ref("")
const selectedModelId = ref("")

/**
 * 所选模型是否支持视觉（图片理解）。
 * 校内本地模型与 deepseek 均为纯文本 —— 不支持时隐藏图片入口，
 * 避免用户发了图、模型必然答错。字段缺失（旧数据）按支持处理，不误伤。
 */
const visionSupported = computed(
  () => models.value.find((m) => m.id === selectedModelId.value)?.supportsVision !== false
)
const selectedAgentId = ref("")

/** 管理模式：批量勾选/删除会话；打开会话或新建对话时自动退出 */
const manageMode = ref(false)
/** 管理模式下勾选中的会话 id。用 Set：勾选/去重判断都是 O(1) */
const selectedConvIds = ref(new Set<string>())

/** 自动切换提示（成功切换后展示，可撤回） */
const routeNotice = ref<{
  text: string
  /** 切回时恢复到哪个智能体；为 null 表示这次切换不可撤回 */
  undoAgentId: string | null
} | null>(null)
/** 本次会话里已走过路由处理的助手消息 id，避免对同一条反复判定 */
const autoRoutedMsgs = new Set<string>()
/**
 * 语义路由的建议（等待学生确认）。
 * 只给意见、不代替学生决定；带 question 是为了采纳后能重问同一句。
 */
const agentSuggestion = ref<(AgentSuggestion & { question: string }) | null>(null)
/** 学生拒绝过的目标智能体，同一会话内不再推荐 */
const refusedAgentIds = new Set<string>()

const draft = ref("")
const pendingImages = ref<string[]>([])
const {imagePreparing,imageTransfer,prepare:prepareImages,beginUpload,uploadProgress,finishUpload}=useImageAttachments(pendingImages,activeId,message=>ElMessage.warning(message))
const streaming = ref(false)
const loadingConversations = ref(false)
const sideHidden = ref(false)
const pinnedToBottom = ref(true)

const scrollEl = ref<HTMLElement>()
/** 会话列表滚动容器：用于把当前项滚进可视区 */
const convScrollEl = ref<HTMLElement>()
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

const feedbackState = ref<Record<string, "positive" | "negative">>({})
const feedbackVisible=ref(false),feedbackMessageId=ref('')

let abortStream: (() => void) | null = null
let searchTimer: number | undefined

/**
 * 印章字：取站名里的**第一个汉字**（默认站名得到「校」），
 * 站名全为西文时才退回首字母。
 */
const sealChar = computed(() => {
  const name = (auth.siteName || "").trim()
  // CJK 统一表意文字基本区，覆盖日常汉字
  const cjk = name.match(/[\u4e00-\u9fa5]/)
  if (cjk) return cjk[0]
  return name.slice(0, 1) || "智"
})

/** 窄屏判定：侧栏转抽屉（与经典版同一断点） */
const narrowQuery =
  typeof window !== "undefined" ? window.matchMedia("(max-width: 860px)") : null
const isNarrow = ref(narrowQuery?.matches ?? false)

const activeConversation = computed(() =>
  conversations.value.find((c) => c.id === activeId.value)
)

const activeAgent = computed(() => agents.value.find((a) => a.id === selectedAgentId.value))

const starters = computed(() => {
  const list = display.value.questions.length?display.value.questions:activeAgent.value?.starters
  return Array.isArray(list) ? list : []
})

/** 助手消息头的小方格：优先当前智能体首字，没有则用站印 */
const assistantBadge = computed(() => activeAgent.value?.name.slice(0, 1) || sealChar.value)

// ---------------- 流式文本平滑输出（打字机） ----------------

/**
 * 网络到达的文本先累计在 typer 里，由它按自适应步长逐帧「写」进正文：
 * 突发不整块灌入、网络结束后续播完才撤光标。滚动钩子与文字写入严格
 * 同帧（onFrame → scrollIfPinned），自动滚动因此是连续的而不是跳变。
 *
 * ⚠️ write 里必须写**响应式代理**：push 进 messages 的原始对象不触发渲染，
 * 所以这里按 id 从 messages.value 取回代理再赋值。
 * ⚠️ 状态按键是 target 对象引用：onMeta 会在流中途回填真实 id，按 id 键控
 * 会断档（见 stream-typewriter.ts 的说明）。
 */
const typer = createStreamTyper({
  write: (raw, text) => {
    const id = (raw as ChatMessage).id
    const proxy = messages.value.find((m) => m.id === id) ?? (raw as ChatMessage)
    proxy.content = text
  },
  onFrame: () => scrollIfPinned()
})

// ---------------- 卡片渲染 ----------------

// CardMessage owns per-message reactive parsing and preserves card interactions.
/** 卡片代表用户发一条消息 */
function askFromCard(text: string) {
  if (!text || streaming.value) return
  draft.value = text
  void send()
}

/**
 * 卡片里的「切换智能体」。
 * id 来自模型输出，属于不可信输入 —— 必须先在真实清单里核对，
 * 否则切到不存在的 id 会让后续请求 404 且界面毫无提示。
 */
function switchAgentFromCard(id: string) {
  const target = agents.value.find((a) => a.id === id)
  if (!target) {
    ElMessage.warning("这个智能体当前不可用")
    return
  }
  selectedAgentId.value = target.id
  pickAgent(target)
}

/**
 * 切换智能体并给出提示（自动路由与撤回共用）。
 * 刻意**不用** pickAgent()：那会清空消息（它服务的是迎宾页主动换人，
 * 等同开新对话）。这里换人发生在一次已经发生的问答之后，
 * 清空会让学生刚提的问题凭空消失，以为程序崩了。
 */
function switchAgentWithNotice(
  agentId: string,
  text: string,
  opts: { undoAgentId?: string | null } = {}
) {
  const target = agents.value.find((a) => a.id === agentId)
  if (!target) return false
  selectedAgentId.value = target.id
  routeNotice.value = { text, undoAgentId: opts.undoAgentId ?? null }
  return true
}

/** 撤回自动切换：回到原智能体，并记下「学生拒绝过」，避免来回拉锯 */
function undoRouteSwitch() {
  const back = routeNotice.value?.undoAgentId
  if (!back) {
    routeNotice.value = null
    return
  }
  const target = agents.value.find((a) => a.id === back)
  if (!target) {
    routeNotice.value = null
    return
  }
  refusedAgentIds.add(selectedAgentId.value)
  selectedAgentId.value = target.id
  routeNotice.value = { text: `已切回「${target.name}」`, undoAgentId: null }
  void nextTick(() => inputEl.value?.focus())
}

/**
 * 回复落定后的语义路由：只在**失败**时请后端给「意见」，学生点头才切。
 *
 * 判定顺序是硬约束：先看 error 再看 status —— 流意外断开时 chat-stream
 * 会在 finally 里兜底回调 onDone({status:"ABORTED"})，与用户主动停止同状态；
 * 只有在**没有 error** 时 ABORTED 才算用户主动停止。
 *
 * @param allowRetry 防循环：重试自己发起的那轮传 false，失败就停在第二次。
 */
async function autoRouteAfterReply(msg: ChatMessage, allowRetry: boolean) {
  if (autoRoutedMsgs.has(msg.id)) return
  autoRoutedMsgs.add(msg.id)

  /*
   * 智能体清单是跨网络拉的，模型回复可能更快 —— 线上实测「先到回复、
   * 后到清单」时路由会静默跳过。这里等一个有限上限，区分
   * 「清单还没到」与「确实没得换」，不无限阻塞。
   */
  if (!agents.value.length && metaPromise) {
    await Promise.race([
      metaPromise.catch(() => undefined),
      new Promise((r) => setTimeout(r, 8000))
    ])
  }

  const failed = Boolean(msg.error) || msg.status === "FAILED"
  const userAborted = !msg.error && msg.status === "ABORTED"

  // 用户自己按了停止：不是在报错，不该换人重试
  if (userAborted) return
  if (!failed) return
  if (!allowRetry) return

  // 只有一个智能体时换人没有意义
  if (agents.value.length < 2) return

  const question = lastUserContentBefore(msg)
  if (!question) return

  const suggestion = await fetchRouteSuggestion(question)
  if (!suggestion) return
  if (suggestion.agentId === selectedAgentId.value) return
  if (refusedAgentIds.has(suggestion.agentId)) return

  agentSuggestion.value = { ...suggestion, question }
}

/** 取这条助手回复之前的那条用户消息（就是没答上来的那个问题） */
function lastUserContentBefore(msg: ChatMessage): string {
  const idx = messages.value.findIndex((m) => m.id === msg.id)
  for (let i = idx - 1; i >= 0; i--) {
    const m = messages.value[i]
    if (m?.role === "user" && m.content.trim()) return m.content.trim()
  }
  return ""
}

/** 路由判定是增强项，失败一律当作「没有建议」，不在界面冒错误弹窗 */
async function fetchRouteSuggestion(question: string): Promise<AgentSuggestion | null> {
  try {
    const res = await chatApi.suggestAgent({
      conversationId: activeId.value || undefined,
      content: question
    })
    return res?.suggestion || null
  } catch {
    return null
  }
}

/** 采纳建议：切过去，并把没答上来的那个问题重问一遍 */
async function acceptSuggestion() {
  const s = agentSuggestion.value
  if (!s || streaming.value) return
  const target = agents.value.find((a) => a.id === s.agentId)
  if (!target) {
    agentSuggestion.value = null
    return
  }
  const from = selectedAgentId.value
  agentSuggestion.value = null
  const ok = switchAgentWithNotice(
    target.id,
    `已交给「${target.name}」，重新问一次`,
    { undoAgentId: from }
  )
  if (ok) await runRegenerate(true)
}

/** 拒绝建议：记下来，同一会话内不再推荐它 */
function dismissSuggestion() {
  const s = agentSuggestion.value
  if (s) refusedAgentIds.add(s.agentId)
  agentSuggestion.value = null
}

/** 卡片里的「启用技能」，同样要核对真实 key */
function useSkillFromCard(key: string) {
  const target = skills.value.find((s) => s.key === key)
  if (!target) {
    ElMessage.warning("这个技能当前不可用")
    return
  }
  if (!pickedSkills.value.includes(key)) pickedSkills.value.push(key)
}

function toggleSkill(key: string) {
  const i = pickedSkills.value.indexOf(key)
  if (i >= 0) pickedSkills.value.splice(i, 1)
  else pickedSkills.value.push(key)
}

/**
 * 卡片协议提示词：只在**新建会话**时随 create 落库一次，
 * 后端每条消息自动拼进 systemPrompts。
 * 清单必须是真实 id/key —— 模型不知道这些 id，不给就会编。
 */
const cardProtocol = computed(() =>
  buildCardProtocol({
    agents: agents.value.map((a) => ({ id: a.id, name: a.name, description: a.description })),
    skills: uniqueSkills.value.map((s) => ({ key: s.key, name: s.name }))
  })
)

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
    toastError(error, "对话列表加载失败")
  } finally {
    if (request === listRequest) loadingConversations.value = false
  }
}

/**
 * 元数据加载中的 Promise，供「自动路由」等待。
 * 模型回复可能比清单更早返回；不等待会把「还没到」误判成「没得换」。
 */
let metaPromise: Promise<void> | null = null

async function loadMeta() {
  // 三个接口互不依赖，并发拉取；单个失败不影响其余
  await Promise.all([
    modelsApi
      .available()
      .then((list) => {
        models.value = list
        if (!selectedModelId.value) {
          // 管理端指定的学生端默认模型优先；校园网模式下再回落校内本地部署（pickDefaultModel 内含回落）
          const def = pickDefaultModel(
            list,
            campusNet.campus,
            auth.settings?.student_default_model_id
          )
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
        /*
         * 默认智能体：学生没有选择器，必须加载时就定人，
         * 否则首条回答没有署名。挑选只认 key 里最中性的
         * general/assistant/default/campus，命中不了退化第一个，
         * 不做更花哨的猜测。
         */
        if (!selectedAgentId.value && list.length) {
          const generic =
            list.find((a) => /general|assistant|default|campus/i.test(a.key || "")) || list[0]
          selectedAgentId.value = generic.id
        }
      })
      .catch(() => undefined),
    skillsApi
      .available()
      .then((list) => {
        skills.value = list
        // 清单到手后立即按前缀配置预勾选推荐/自动技能
        applySkillPresets()
      })
      .catch(() => undefined)
  ])
}

/**
 * 去重后的技能清单（协议只 advertise 这些 key）。
 * 必须去重：available 接口混着两套 key 与误导入副本，判据「名字 + 描述」
 * 收敛在 utils/skills.ts，与经典版/管理端共用一份。
 */
const uniqueSkills = computed(() => dedupeSkills(skills.value))

/** 输入区仅展示用户已选用的实际工具技能。 */
const skillChips = computed(() => {
  const out: { key: string; name: string; on: boolean }[] = []
  const seen = new Set<string>()
  for (const s of uniqueSkills.value) {
    const picked = pickedSkills.value.includes(s.key)
    if (!picked || /^(ucass-kb-(survival|takeout)|kb-)/.test(s.key)) continue
    if (seen.has(s.key)) continue
    seen.add(s.key)
    out.push({ key: s.key, name: s.name, on: picked })
  }
  return out
})

/**
 * 技能预设：新对话开始时按前缀配置预勾选（见 utils/skill-presets.ts）。
 * 后端机制是「出现在 skills 里才注入」，所以这里只是把命中的 key 放进
 * pickedSkills —— 用户可随时在输入框上方摘除，不是强制锁定。
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

/**
 * 已启用技能条查**全量**清单而不是去重后的：
 * 模型可能回显等价 key（couple-context vs couple_context），
 * 按去重清单查会「生效了但看不见、也关不掉」。
 */

async function openConversation(id: string) {
  if (streaming.value) return
  // 打开会话即离开管理模式（需求：浏览会话时不应停留在批量选择态）
  exitManageMode()
  activeId.value = id
  if (isNarrow.value) sideHidden.value = true
  await loadMessages(id)
}


function toChatMessage(item: MessageItem): ChatMessage {
  const images = (item.attachments as { images?: string[] } | null)?.images
  const toolCalls = item.toolCalls || []
  return {
    id: item.id,
    role: item.role === "user" ? "user" : "assistant",
    content: item.role==='assistant'?cleanAnswerReferences(item.content || "",new Set((item.attachments?.knowledgeSources||[]).flatMap(s=>s.citationId?[s.citationId]:[]))):item.content || "",
    createdAt: item.createdAt,
    status: item.status,
    error: item.error || undefined,
    streaming: false,
    images: images?.length ? images : undefined,
    kbHits: normalizeKnowledgeSources(item.attachments?.knowledgeSources),
    runMetrics:item.attachments?.agentRun,
    modelName: item.modelKey || undefined,
    toolEvents: toolCalls.map((t, i) => ({
      id: `hist-${i}`,
      name: t.name,
      state: (t.status==='FAILED'?'failed':t.status==='ABORTED'?'stopped':'done') as ToolEvent['state'],cached:t.cached,durationMs:t.durationMs
    }))
  }
}

// ---------------- 滚动 ----------------

/**
 * 事件后的贴底（新消息入列、切会话）。
 * 打字期间每一帧的跟随滚动由 typer 的 onFrame → scrollIfPinned 负责，
 * 与文字写入严格同帧，因此是连续的；这里的平滑只服务「一次性的大跳」。
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
 * 内容刚长高距底值已变大，会把贴底的用户误判成在翻历史。
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
  pinnedToBottom.value = distance < 56
}

function onSearch() {
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => void loadConversations(), 320)
}

/**
 * 会话切换/新挂载后，把当前项滚进可视区。
 * block:"nearest"：已可见时不动，只在当前项被滚出列表时才滚动 ——
 * 流式期间列表刷新不会把用户的滚动位置拽走。
 */
function scrollActiveConvIntoView() {
  void nextTick(() => {
    convScrollEl.value
      ?.querySelector(".st-conv.is-active")
      ?.scrollIntoView({ block: "nearest" })
  })
}

// activeId 变化（打开会话/新建后回传 id）都会走到这里，覆盖挂载与切换两种时机
watch(activeId, () => scrollActiveConvIntoView())

/*
 * 校园网模式变化后重挑默认模型。
 * 弹窗通常在挂载早期应答，但可能与清单加载竞态；这里兜住「清单先到、
 * 稍后才应答校园网」的情况 —— 仅在当前选中的还是自动挑的那个（未被用户
 * 手动改过）时才覆盖，尊重学生的显式选择。
 */
let autoPickedModelId = ""
watch(
  [() => campusNet.campus, () => auth.settings?.student_default_model_id],
  () => {
    const cur = models.value.find((m) => m.id === selectedModelId.value)
    if (selectedModelId.value && cur && cur.id !== autoPickedModelId) return
    // 管理端指定的学生端默认模型优先，其次才是校园网本地模型（同 loadMeta）
    const def = pickDefaultModel(
      models.value,
      campusNet.campus,
      auth.settings?.student_default_model_id
    )
    if (def) {
      selectedModelId.value = def.id
      autoPickedModelId = def.id
    }
  }
)

// ---------------- 会话操作 ----------------

/**
 * 新建对话与管理端保持一致：先停止本轮回复，再切换，避免旧流覆盖新对话。
 */
async function newConversation() {
  // 新建对话同样退出管理模式：批量操作与「开新对话」是两个互斥的意图
  exitManageMode()
  if (streaming.value) { ElMessage.warning("生成中，请先停止当前回复"); return }
  activeId.value = ""
  messages.value = []
  // 新对话回到预设态：清掉上一轮手动勾选，重新应用推荐/自动技能
  pickedSkills.value = []
  applySkillPresets()
  if (isNarrow.value) sideHidden.value = true
  await nextTick()
  inputEl.value?.focus()
}

async function removeConversation(conv: ConversationItem) {
  let ok = false
  try {
    await ElMessageBox.confirm(`确定删除「${conv.title || "未命名对话"}」吗？`, "删除对话", {
      type: "warning",
      confirmButtonText: "删除",
      cancelButtonText: "取消"
    })
    ok = true
  } catch {
    return
  }
  if (!ok) return

  try {
    await conversationsApi.remove(conv.id)
    if (activeId.value === conv.id) {
      activeId.value = ""
      messages.value = []
    }
    await loadConversations()
    toastOk("已删除")
  } catch (error) {
    toastError(error)
  }
}

// ---------------- 会话管理（批量勾选/删除） ----------------

function toggleManageMode() {
  manageMode.value = !manageMode.value
  // 退出时清空勾选，避免残留的 id 指向已不在列表里的会话
  if (!manageMode.value) selectedConvIds.value.clear()
}

function exitManageMode() {
  manageMode.value = false
  selectedConvIds.value.clear()
}

/**
 * 行点击：管理模式下改为切换勾选，不再打开会话。
 * 勾选框是行内自绘元素而非独立按钮 —— 保证整行都是足够大的触控目标。
 */
function onConvRowClick(conv: ConversationItem) {
  if (manageMode.value) {
    if (selectedConvIds.value.has(conv.id)) selectedConvIds.value.delete(conv.id)
    else selectedConvIds.value.add(conv.id)
    return
  }
  void openConversation(conv.id)
}

const allConvSelected = computed(
  () => conversations.value.length > 0 && selectedConvIds.value.size === conversations.value.length
)

function toggleSelectAll() {
  if (allConvSelected.value) {
    selectedConvIds.value.clear()
    return
  }
  for (const c of conversations.value) selectedConvIds.value.add(c.id)
}

/**
 * 删除勾选的会话。
 * 用 allSettled 并发逐个调 remove：单个失败不该中断其余删除，
 * 结束后按**实际成功数**汇报，失败数单独提示。
 */
async function removeSelectedConversations() {
  const ids = [...selectedConvIds.value]
  if (!ids.length) return

  const results = await Promise.allSettled(ids.map((id) => conversationsApi.remove(id)))
  const okCount = results.filter((r) => r.status === "fulfilled").length
  const failedCount = ids.length - okCount

  // 删除包含当前会话时清空消息区，避免界面停在一条已不存在的会话上
  if (ids.includes(activeId.value)) {
    activeId.value = ""
    messages.value = []
  }
  selectedConvIds.value.clear()
  await loadConversations()

  if (okCount) toastOk(`已删除 ${okCount} 个对话`)
  if (failedCount) toastError(new Error("部分会话删除失败"), `${failedCount} 个对话删除失败`)
}

/**
 * 全部删除（二次确认）。
 * 删除范围是**当前列表**：搜索过滤态下只删筛选结果，确认文案里写明。
 * 完成后无条件清空消息区并退出管理模式 —— 列表已空，没有可停留的会话。
 */
async function removeAllConversations() {
  const targets = conversations.value
  if (!targets.length) return

  const scope = keyword.value
    ? `当前处于搜索过滤态，将只删除筛选出的 ${targets.length} 个对话`
    : `将删除全部 ${targets.length} 个对话`
  try {
    await ElMessageBox.confirm(`${scope}，删除后不可恢复，确定继续吗？`, "全部删除", {
      type: "warning",
      confirmButtonText: "全部删除",
      cancelButtonText: "取消"
    })
  } catch {
    return
  }

  const results = await Promise.allSettled(targets.map((c) => conversationsApi.remove(c.id)))
  const okCount = results.filter((r) => r.status === "fulfilled").length
  const failedCount = targets.length - okCount

  activeId.value = ""
  messages.value = []
  exitManageMode()
  await loadConversations()

  if (okCount) toastOk(`已删除 ${okCount} 个对话`)
  if (failedCount) toastError(new Error("部分会话删除失败"), `${failedCount} 个对话删除失败`)
}

function pickAgent(agent: AgentItem) {
  selectedAgentId.value = agent.id
  onAgentChange()
}

function onAgentChange() {
  // 切换智能体等同于开新对话：沿用旧上下文会让新人格接到不相干的历史
  if (messages.value.length) {
    messages.value = []
    activeId.value = ""
    toastOk("已切换智能体，开始新对话")
  }
  void nextTick(() => inputEl.value?.focus())
}

function useStarter(text: string) {
  draft.value = text
  void nextTick(() => {
    autoGrow()
    inputEl.value?.focus()
  })
}

// ---------------- 输入 ----------------

/** 自适应高度：先归零再读 scrollHeight，否则高度只会增不会减 */
function autoGrow() {
  const el = inputEl.value
  if (!el) return
  el.style.height = "auto"
  el.style.height = `${Math.min(el.scrollHeight, 190)}px`
}

function pickImage() {
  // 双保险：入口已隐藏，但仍防键盘/插件触发（当前无视觉模型时直接忽略）
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

// ---------------- 首次使用引导 ----------------

const MEMORY_ENABLED_KEY = "cagent-memory-enabled"

/** 引导弹窗可见性：进学生端且本用户没引导过时弹一次 */
const showOnboard = ref(false)
/** 引导里「自动记忆」的选择（点按钮即落盘，跳过路径也尊重已做的选择） */
const onboardMemory = ref(true)
/** 引导里选填的课表文本 */
const onboardSchedule = ref("")

/** payload 用的记忆开关：读不到/存储不可用按开启（默认体验优先） */
function memoryEnabledPref(): boolean {
  if(auth.settings?.memory_enabled===false)return false
  try {
    return localStorage.getItem(MEMORY_ENABLED_KEY) !== "0"
  } catch {
    return true
  }
}

/** 引导标记按用户隔离（id 优先，缺 id 用 email） */
function onboardedKey(): string {
  return "cagent-onboarded-" + (auth.user?.id || auth.user?.email || "")
}

/** onMounted 调用：storage 不可用就静默不弹，不能挡住聊天 */
watch(()=>display.value.onboarding,on=>{if(!on)showOnboard.value=false})
watch(()=>display.value.feedback,on=>{if(!on)feedbackVisible.value=false})
watch(()=>display.value.weather,on=>{if(on)void loadWelcomeWeather();else welcomeWeather.value=''})

function checkOnboard(): void {
  // 用户标识拿不到就无从隔离标记，宁可不弹也不能每个游客都弹
  if (!display.value.onboarding || !(auth.user?.id || auth.user?.email)) return
  try {
    if (!localStorage.getItem(onboardedKey())) {
      // 上次可能点过「不开启」但没走完引导：按钮态要与已落盘的偏好一致
      onboardMemory.value = memoryEnabledPref()
      showOnboard.value = true
    }
  } catch {
    /* localStorage 不可用：不弹引导 */
  }
}

/** 引导里点「开启/不开启」：立即写 localStorage（"1"/"0"） */
function chooseMemory(on: boolean): void {
  onboardMemory.value = on
  try {
    localStorage.setItem(MEMORY_ENABLED_KEY, on ? "1" : "0")
  } catch {
    /* 存不了就只在本次会话生效 */
  }
}

/**
 * 结束引导。skip=「跳过」：只写标记关弹窗，不动记忆开关与课表；
 * 正常完成：记忆开关在选择时/此时落盘，课表非空则存一条 context 记忆
 * （失败静默 —— 引导是增强项，不该因接口失败卡住学生）。
 */
function finishOnboard(skip: boolean): void {
  if (!skip) {
    chooseMemory(onboardMemory.value)
    const text = onboardSchedule.value.trim()
    if (text && auth.settings?.memory_enabled!==false) {
      // 截断 800 字符：课表粘贴常是整页表格，超长记忆没有检索价值还占配额
      void memoryApi
        .create({ content: ("用户课表：\n" + text).slice(0, 800), category: "context" })
        .catch(() => undefined)
    }
  }
  try {
    localStorage.setItem(onboardedKey(), "1")
  } catch {
    /* 写不进去就下次再弹一次，可接受 */
  }
  showOnboard.value = false
}

// ---------------- 迎宾页日期 + 天气 ----------------

/** 日期部分挂载时取一次即可：迎宾页的生命周期内跨天的概率可忽略 */
const WEEKDAY_CN = ["日", "一", "二", "三", "四", "五", "六"]
const welcomeDate = (() => {
  const d = new Date()
  return `${d.getMonth() + 1}月${d.getDate()}日 星期${WEEKDAY_CN[d.getDay()]}`
})()

const welcomeWeather = ref("")
const WEATHER_CACHE_KEY = "cagent-weather"
const WEATHER_TTL_MS = 30 * 60 * 1000

/** Open-Meteo 的 WMO weather_code → 中文短语（覆盖常用段即可） */
function weatherText(code: number): { emoji: string; desc: string } {
  if (code === 0) return { emoji: "☀️", desc: "晴" }
  if (code === 1) return { emoji: "⛅", desc: "大部晴" }
  if (code === 2) return { emoji: "⛅", desc: "多云" }
  if (code === 3) return { emoji: "☁️", desc: "阴" }
  if (code === 45 || code === 48) return { emoji: "🌫️", desc: "雾" }
  if (code >= 51 && code <= 67) return { emoji: "🌧️", desc: "雨" }
  if (code >= 71 && code <= 77) return { emoji: "❄️", desc: "雪" }
  if (code >= 80 && code <= 82) return { emoji: "🌦️", desc: "阵雨" }
  if (code === 85 || code === 86) return { emoji: "🌨️", desc: "阵雪" }
  if (code >= 95) return { emoji: "⛈️", desc: "雷雨" }
  return { emoji: "⛅", desc: "多云" }
}

/**
 * 良乡校区当前天气（Open-Meteo：免费无 key、支持 CORS）。
 * sessionStorage 缓存 30 分钟；失败/超时（3s）静默 —— 天气是锦上添花，
 * 迎宾行退化为只显示日期，不在界面上报错。
 */
async function loadWelcomeWeather(): Promise<void> {
  try {
    const raw = sessionStorage.getItem(WEATHER_CACHE_KEY)
    if (raw) {
      const cached = JSON.parse(raw) as { t?: number; line?: string }
      if (cached?.line && typeof cached.t === "number" && Date.now() - cached.t < WEATHER_TTL_MS) {
        welcomeWeather.value = cached.line
        return
      }
    }
  } catch {
    /* 缓存读不到/解析失败就走现拉 */
  }

  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), 3000)
  try {
    const res = await fetch(
      "https://api.open-meteo.com/v1/forecast?latitude=39.735&longitude=116.142&current=temperature_2m,weather_code&timezone=Asia%2FShanghai",
      { signal: ctrl.signal }
    )
    const data = (await res.json()) as {
      current?: { temperature_2m?: number; weather_code?: number }
    }
    const temp = data.current?.temperature_2m
    const code = data.current?.weather_code
    if (typeof temp !== "number" || typeof code !== "number") return
    const w = weatherText(code)
    welcomeWeather.value = `${w.emoji} ${Math.round(temp)}°C ${w.desc}`
    try {
      sessionStorage.setItem(
        WEATHER_CACHE_KEY,
        JSON.stringify({ t: Date.now(), line: welcomeWeather.value })
      )
    } catch {
      /* 存不了就每次现拉 */
    }
  } catch {
    /* 超时/网络失败：静默，只显示日期 */
  } finally {
    window.clearTimeout(timer)
  }
}

// ---------------- 知识库来源卡 ----------------

/** 来源卡的展开状态（按消息 id 键控；默认收起，不干扰阅读） */


// ---------------- 发送 ----------------

/**
 * 会话标题取首条消息的前 24 字 —— 与后端 makeTitle() 同一份逻辑，改要同步。
 * 学生端为带卡片协议必须抢在首条消息前自建会话；不重算标题的话，
 * 侧栏会全是同名「新对话」。
 */
function autoTitle(content: string): string {
  const clean = content.replace(/\s+/g, " ").trim()
  if (!clean) return "新对话"
  return clean.length > 24 ? `${clean.slice(0, 24)}…` : clean
}

/**
 * 确保有一个带「卡片协议」的会话，返回其 id。
 * 后端「无 conversationId 自动建会话」的路径**不写** systemPrompt，
 * 卡片永远出不来，所以首条消息前先建会话把协议落库。
 * 失败返回空串走后端兜底：提示词是增强项，不该变成发送的前置条件。
 */
async function ensureConversation(content: string): Promise<string> {
  if (activeId.value) {
    const conv=activeConversation.value
    if(conv?.systemPrompt?.startsWith('你有一个「卡片」能力') && !conv.systemPrompt.includes('【facts 信息卡】')) {
      const systemPrompt=conv.systemPrompt+'\n\n'+KNOWLEDGE_CARD_PROTOCOL
      try{await conversationsApi.update(conv.id,{systemPrompt});conv.systemPrompt=systemPrompt}catch{/* retry on the next send */}
    }
    return activeId.value
  }
  try {
    const conv = await conversationsApi.create({
      title: autoTitle(content),
      modelId: selectedModelId.value || undefined,
      agentId: selectedAgentId.value || undefined,
      systemPrompt: cardProtocol.value
    })
    activeId.value = conv.id
    return conv.id
  } catch {
    return ""
  }
}

/**
 * 发送（模板入口）必须**零参**：模板事件会把 PointerEvent 传进首参，
 * 若形参直接是 isAutoRetry，事件对象恒为真值，每次手动发送都会被
 * 误判成「自动重试」，失败后不再自动换人。
 */
async function send() {
  await runSend(false)
}

/** 发送实现；isAutoRetry 只决定失败后还能不能再自动重试（防无限套娃） */
async function runSend(isAutoRetry: boolean,bypassCache=false,revision?:ChatMessage) {
  const originalUser=revision?messages.value.slice(0,messages.value.indexOf(revision)).reverse().find(m=>m.role==='user'):undefined
  const content = revision?originalUser?.content||'重新生成原回答':draft.value.trim()
  if (!content || streaming.value || imagePreparing.value || loadingMessages.value || (historyError.value && !messages.value.length)) return

  const stamp = Date.now()
  const userMsg: ChatMessage = {
    id: `local-user-${stamp}`,
    role: "user",
    content,
    createdAt: new Date().toISOString(),
    images: pendingImages.value.length ? [...pendingImages.value] : undefined
  }
  const assistantMsg: ChatMessage = {
    id: `local-assistant-${stamp}`,
    role: "assistant",
    content: "",
    createdAt: new Date().toISOString(),
    streaming: true,
    liveEffect: true,
    toolEvents: []
  }
  if(revision){assistantMsg.id=revision.id;messages.value.splice(messages.value.indexOf(revision),1,assistantMsg)}else messages.value.push(userMsg, assistantMsg)

  if(!revision){draft.value = "";pendingImages.value = []}
  void nextTick(autoGrow)
  streaming.value = true
  // 刚发出的消息做一次平滑滚落（后续的逐帧跟随由 typer 驱动）
  await scrollToBottom(true)

  // 首条消息前先把会话建出来（带协议 + 用消息内容当标题）；已有会话则复用
  const conversationId = await ensureConversation(content)

  // 本轮实际所用的模型：失败轮换判断要以「发出去时」的模型为准，
  // 流式期间用户/会话切换都可能改写 selectedModelId
  const usedModelId = selectedModelId.value

  const payload = {
    conversationId: conversationId || undefined,
    content,
    outputPreference:outputPreference.value,bypassCache,
    modelId: usedModelId || undefined,
    agentId: selectedAgentId.value || undefined,
    images: userMsg.images,
    skills: pickedSkills.value.length ? [...pickedSkills.value] : undefined,
    // 自动记忆开关：引导里选过就按选择，没选过（读不到）按开启
    memoryEnabled: memoryEnabledPref()
  }

  /*
   * 之后所有流式状态的读写都走**响应式代理**：push 进数组的是原始对象，
   * 对原始对象赋值（streaming / toolEvents / error）不会触发渲染。
   * 取数组末两位即代理；typer 也以代理为键（引用稳定，不受 onMeta 改 id 影响）。
   */
  const userMsgRef = originalUser || userMsg
  const target = revision?messages.value.find(m=>m.id===revision.id)!:messages.value[messages.value.length - 1]

  const request=(handlers:ChatStreamHandlers)=>revision?regenerateChat({conversationId:activeId.value!,messageId:revision.id,modelId:selectedModelId.value||undefined,outputPreference:outputPreference.value},handlers):streamChat(payload,handlers)
  if(!revision&&payload.images?.length)beginUpload()
  const { abort, done } = request({
    onUploadProgress:uploadProgress,
    onRuntime:p=>{target.runProgress=p},
    onKb: p=>{target.kbHits=normalizeKnowledgeSources(p.hits)},
    onMeta: (meta) => {
      // 首条消息才创建会话，此时后端才回传真实 id
      if (!activeId.value) {
        activeId.value = meta.conversationId
        void loadConversations()
      }
      userMsgRef.id = meta.userMessageId
      target.id = meta.assistantMessageId
      target.modelName = meta.model.name
      if (meta.title && meta.conversationId === activeId.value && activeConversation.value) activeConversation.value.title = meta.title
    },
    onText: (text) => typer.push(target, text),
    onToolStart: (p) => {
      target.toolEvents = target.toolEvents || []
      target.toolEvents.push({ id: p.id, name: p.name, state: "running" })
      if (pinnedToBottom.value) void scrollToBottom()
    },
    onToolResult: (p) => {
      const ev = target.toolEvents?.find((t) => t.id === p.id)
      if (ev) Object.assign(ev,{state:p.isError?'failed':'done',cached:p.cached,durationMs:p.durationMs})
    },
    onDone: (result) => {
      finishUpload(result.status)
      target.status = result.status
      target.runMetrics=result.runtime
      for(const tool of target.toolEvents||[])if(tool.state==='running')tool.state=result.status==='ABORTED'?'stopped':'failed'
      if (result.status === "FAILED" && !target.error) target.error = "生成失败，请稍后重试"
      // 网络侧结束：已收文本按打字机节奏播完，播完才撤光标（streaming）
      typer.end(target, () => {
        target.streaming = false
      })
    },
    onError: (message) => {
      // 出错就完整落盘，不再播动画（错误信息要立刻可见）
      typer.flush(target)
      target.error = message
      if(revision&&!target.content){target.content=revision.content;target.kbHits=revision.kbHits}
      target.streaming = false
    }
  })

  abortStream = abort

  try {
    await done
  } finally {
    streaming.value = false
    abortStream = null
    // 注意：target.streaming 由 typer.end 的播完回调撤下，这里不能提前关，
    // 否则光标在文本还没播完时就消失了。
    // 标题可能由后端自动生成，拉一次列表让侧栏跟上
    await loadConversations().catch(() => undefined)
    if (pinnedToBottom.value) await scrollToBottom()
  }

  /*
   * 失败轮换与语义路由都放在 finally 之外、await done 之后：它们内部可能
   * 再次触发发送，写进 finally 会形成重入，streaming 与 abortStream 被内层
   * 覆盖，外层的清理反而把内层状态清掉。
   *
   * 轮换优先于路由建议：换模型重试与换智能体重试二选一，同时给两组提示
   * 学生看不懂；轮换发起的重试轮自己会走完整的失败处理。
   */
  const rotated = await rotateToFallbackIfNeeded(target, usedModelId, isAutoRetry)
  if (rotated) return
  await autoRouteAfterReply(target, !isAutoRetry)
}

/**
 * 已发起过轮换的助手消息 id：每条消息只轮换一次，防连环轮换
 * （重试轮本身 isAutoRetry=true 不再进这里，这是第二道保险）。
 */
const fallbackRotatedFor = ref("")

/**
 * 失败后自动轮换到管理端配置的备用模型并重发（复用 runRegenerate(true)，
 * 它会移除最后一轮问答再重发）。
 *
 * 触发条件全部满足才动手：本轮确实失败（FAILED 或带 error）、管理端配了
 * fallback、fallback 在可用清单里、本轮用的不是 fallback、会话已落库
 * （重发要靠会话 id），且本轮不是轮换/路由发起的重试（isAutoRetry=false
 * 的那轮才允许再轮换，防无限套娃）。
 *
 * @returns 是否已发起轮换重试（是则调用方直接返回，不再做语义路由）
 */
async function rotateToFallbackIfNeeded(
  target: ChatMessage,
  usedModelId: string,
  isAutoRetry: boolean
): Promise<boolean> {
  const failed = target.status === "FAILED" || Boolean(target.error)
  if (!failed || isAutoRetry) return false
  if (fallbackRotatedFor.value === target.id) return false

  const fallbackId = auth.settings?.student_fallback_model_id
  if (!fallbackId || fallbackId === usedModelId) return false
  // 备用模型必须在可用清单里：切到不存在的 id 只会让重试同样失败
  if (!models.value.some((m) => m.id === fallbackId)) return false
  if (!activeId.value) return false

  fallbackRotatedFor.value = target.id
  selectedModelId.value = fallbackId
  toastOk("已自动切换备用模型重试")
  await runRegenerate(true)
  return true
}

function stop() {
  abortStream?.()
  abortStream = null
  // 用户主动停止：剩余文本立即完整落盘，不再播打字机动画
  typer.flushAll()
  for(const message of messages.value)if(message.streaming){message.streaming=false;message.status='ABORTED'}
}

/** 重新生成（模板入口，同样必须零参，理由见 send） */
async function regenerate() {
  await runRegenerate(false)
}

async function runRegenerate(isAutoRetry:boolean,selected?:ChatMessage){
 const target=selected||[...messages.value].reverse().find(m=>m.role==='assistant');if(!activeId.value||streaming.value||!target)return
 await runSend(isAutoRetry,true,target)
}

async function copyMessage(text: string) {
  await copyText(text)
  toastOk("已复制")
}

/** 点赞点踩只提交不追问原因（轻交互）；再点一次同向是撤销 */
async function submitFeedback(messageId: string, positive: boolean) {
  const current = feedbackState.value[messageId]
  if (!positive && current !== 'negative') {feedbackMessageId.value=messageId;feedbackVisible.value=true;return}
  try {
    if (current === (positive ? "positive" : "negative")) {
      await learningApi.revoke(messageId)
      delete feedbackState.value[messageId]
      return
    }
    await learningApi.submit({ messageId, positive })
    feedbackState.value[messageId] = positive ? "positive" : "negative"
    toastOk(positive ? "感谢反馈" : "已记录，我们会改进")
  } catch (error) {
    toastError(error, "反馈提交失败")
  }
}

async function logout() {
  try {
    await ElMessageBox.confirm("确定退出登录吗？", "提示", {
      type: "warning",
      confirmButtonText: "退出",
      cancelButtonText: "取消"
    })
  } catch {
    return
  }
  await auth.logout()
  router.replace("/login")
}

// ---------------- 生命周期 ----------------

let stopNarrowWatch: (() => void) | undefined

// 抽屉打开时锁住 body 滚动：背景跟着手指滚会让抽屉像「没盖上」
watch(
  [sideHidden, isNarrow],
  ([hidden, narrow]) => {
    if (typeof document === "undefined") return
    document.body.style.overflow = narrow && !hidden ? "hidden" : ""
  },
  { immediate: true }
)

onMounted(async () => {
  if (isNarrow.value) sideHidden.value = true

  // 首次使用引导与迎宾天气都不依赖元数据，也不该阻塞列表加载：发出即走
  checkOnboard()
  if(display.value.weather)void loadWelcomeWeather()

  const onNarrowChange = (e: MediaQueryListEvent) => {
    isNarrow.value = e.matches
    // 回到宽屏时把侧栏放出来，避免「列表不见了」
    sideHidden.value = e.matches
  }
  narrowQuery?.addEventListener("change", onNarrowChange)
  stopNarrowWatch = () => narrowQuery?.removeEventListener("change", onNarrowChange)

  metaPromise = loadMeta()
  await metaPromise
  await loadConversations()

  // 直接复用上次的会话（置顶优先）：每次进来都面对空对话，历史就白存了
  const last = conversations.value.find((c) => c.pinned) || conversations.value[0]
  if (last) await openConversation(last.id)

  await nextTick()
  inputEl.value?.focus()
})

// 会话切换后把滚动位置拉到底（图片等异步内容会让高度继续变化）
watch(
  () => messages.value.length,
  () => {
    if (pinnedToBottom.value) void scrollToBottom()
  }
)

onBeforeUnmount(() => {
  window.clearTimeout(searchTimer)
  typer.dispose()
  stopNarrowWatch?.()
  abortStream?.()
  // 归还 body 滚动锁，避免离开页面后主体仍被锁死
  if (typeof document !== "undefined") document.body.style.overflow = ""
})
</script>

<template>
  <!--
    新版学生端外壳。所有 next 令牌挂 .nx-root（styles/next.css），
    暗色由 html.dark 自动生效；离开容器全部失效，与经典版互不影响。
  -->
  <div class="nx-root nx-student">
    <!-- 窄屏抽屉遮罩：Transition 包一层，关闭时也有淡出而不是瞬间消失 -->
    <Transition name="st-mask">
      <div v-if="isNarrow && !sideHidden" class="st-backdrop" @click="sideHidden = true"></div>
    </Transition>

    <!-- ============ 侧栏：品牌 / 新建 / 搜索 / 会话列表 / 用户条 ============ -->
    <aside class="st-side" :class="{ 'is-hidden': sideHidden }">
      <div class="st-brand">
        <div class="st-seal" aria-hidden="true">{{ sealChar }}</div>
        <div class="st-brand-text">
          <div class="st-brand-name">{{ auth.siteName }}</div>
          <div class="st-brand-sub">{{ display.subtitle }}</div>
        </div>
      </div>

      <div class="st-side-actions">
        <button type="button" class="nx-btn nx-btn-primary nx-btn-block st-new" @click="newConversation">
          <IconPlus />
          新建对话
        </button>
        <!-- 管理模式开关：批量勾选/删除会话；打开会话或新建对话时自动退出 -->
        <button
          type="button"
          class="nx-btn nx-btn-block st-manage"
          :class="{ 'is-on': manageMode }"
          :aria-pressed="manageMode"
          @click="toggleManageMode"
        >
          {{ manageMode ? "完成" : "管理" }}
        </button>
      </div>

      <OutputPreferenceSelect/>
      <div class="st-search">
        <div class="nx-search">
          <IconSearch />
          <input
            v-model="keyword"
            type="search"
            class="nx-input"
            placeholder="搜索历史对话"
            aria-label="搜索历史对话"
            @input="onSearch"
          />
        </div>
      </div>

      <!--
        管理模式操作条。
        只作用于**当前列表**：搜索过滤态下「全部删除」仅针对筛选结果。
      -->
      <div v-if="manageMode" class="st-bulk">
        <button type="button" class="nx-btn nx-btn-ghost nx-btn-sm" @click="toggleSelectAll">
          {{ allConvSelected ? "全不选" : "全选" }}
        </button>
        <button
          type="button"
          class="nx-btn nx-btn-danger nx-btn-sm"
          :disabled="!selectedConvIds.size"
          @click="removeSelectedConversations"
        >
          删除所选{{ selectedConvIds.size ? `（${selectedConvIds.size}）` : "" }}
        </button>
        <button
          type="button"
          class="nx-btn nx-btn-danger nx-btn-sm"
          :disabled="!conversations.length"
          @click="removeAllConversations"
        >
          全部删除
        </button>
        <button type="button" class="nx-btn nx-btn-ghost nx-btn-sm" @click="exitManageMode">
          取消
        </button>
      </div>

      <div ref="convScrollEl" class="st-convs">
        <!-- 首次加载用骨架屏占位，避免列表轮廓跳动 -->
        <div v-if="loadingConversations && !conversations.length" class="st-conv-skel">
          <div v-for="i in 6" :key="i" class="nx-skel st-conv-skel-row"></div>
        </div>

        <template v-else>
          <div v-if="!conversations.length" class="st-empty">
            {{ keyword ? "没有匹配的对话" : "还没有对话，从下面开始吧" }}
          </div>

          <div
            v-for="conv in conversations"
            :key="conv.id"
            class="st-conv"
            :class="{
              'is-active': conv.id === activeId,
              'is-checked': manageMode && selectedConvIds.has(conv.id)
            }"
            role="button"
            tabindex="0"
            @click="onConvRowClick(conv)"
            @keydown.enter.prevent="onConvRowClick(conv)"
          >
            <!-- 管理模式行首自绘勾选框：普通模式不渲染，行结构不变 -->
            <span
              v-if="manageMode"
              class="st-conv-check"
              :class="{ 'is-on': selectedConvIds.has(conv.id) }"
              aria-hidden="true"
            ></span>
            <div class="st-conv-body">
              <div class="st-conv-title">
                <IconPin v-if="conv.pinned" class="st-pin" />
                {{ conv.title || "未命名对话" }}
              </div>
              <div class="st-conv-meta">
                {{ conv.messageCount ?? conv._count?.messages ?? 0 }} 条 ·
                {{ fromNow(conv.lastMessageAt || conv.updatedAt) }}
              </div>
            </div>
            <!-- 管理模式下隐藏单删按钮，删除统一走操作条 -->
            <button
              v-if="!manageMode"
              type="button"
              class="st-conv-del"
              aria-label="删除对话"
              @click.stop="removeConversation(conv)"
            >
              <IconTrash />
            </button>
          </div>
        </template>
      </div>

      <div class="st-user">
        <RouterLink v-if="display.mapEntry" to="/map" class="nx-icon-btn" aria-label="校园地图" title="校园地图">⌖</RouterLink>
        <div class="nx-avatar st-user-avatar">
          <img v-if="isImageUrl(auth.user?.avatar)" :src="auth.user!.avatar!" alt="" />
          <template v-else>{{ (auth.user?.name || "同").slice(0, 1) }}</template>
        </div>
        <div class="st-user-meta">
          <div class="st-user-name">{{ auth.displayName }}</div>
          <div class="st-user-role">学生</div>
        </div>
        <button
          type="button"
          class="nx-icon-btn"
          v-if="theme.allowToggle" :aria-label="theme.isDark ? '切换到浅色' : '切换到深色'"
          @click="theme.toggle()"
        >
          <IconSun v-if="theme.isDark" />
          <IconMoon v-else />
        </button>
        <button type="button" class="nx-icon-btn" aria-label="退出登录" @click="logout">
          <IconLogout />
        </button>
      </div>
    </aside>

    <!-- ============ 主区 ============ -->
    <section class="st-main">
      <header class="st-top">
        <button
          v-if="isNarrow"
          type="button"
          class="nx-icon-btn"
          aria-label="打开对话列表"
          @click="sideHidden = false"
        >
          <IconMenu />
        </button>

        <div class="st-title-wrap">
          <div class="st-title">{{ activeConversation?.title || activeAgent?.name || "新的对话" }}</div>
          <div class="st-subtitle">
            {{ streaming ? "正在回复…" : activeAgent ? `由「${activeAgent.name}」回答` : "校园生活与办事助手" }}
          </div>
        </div>

        <!--
          这里刻意没有智能体 / 模型选择器（产品决策）：
          选人由 loadMeta 默认挑选、模型输出的 agents 卡、
          失败后的语义路由建议负责，不让学生面对技术选项。
        -->

        <!-- 自动切换提示：明确告知 + 可一键切回，避免「偷偷换了人」 -->
        <Transition name="nx-fade">
          <div v-if="routeNotice" class="nx-notice st-route-notice" role="status">
            <span class="st-notice-text">{{ routeNotice.text }}</span>
            <button
              v-if="routeNotice.undoAgentId !== null"
              type="button"
              class="nx-link-btn"
              @click="undoRouteSwitch"
            >
              切回
            </button>
            <button
              type="button"
              class="nx-icon-btn st-notice-close"
              aria-label="关闭提示"
              @click="routeNotice = null"
            >
              ×
            </button>
          </div>
        </Transition>

        <!-- 管理端配置的学校 Logo：右上角轻量露出，空配置不渲染 -->
        <img
          v-if="auth.settings?.student_logo_url"
          :src="auth.settings.student_logo_url"
          class="st-logo"
          alt="学校标识"
        />
      </header>

      <!-- 消息滚动区（悬浮的「回到底部」挂在同一层） -->
      <div class="st-stage">
        <div ref="scrollEl" class="st-scroll" @scroll.passive="onScroll">
          <div class="st-body">
            <div v-if="loadingMessages" class="history-state" role="status"><span class="history-pulse"></span>正在加载对话…</div>
            <div v-if="historyError" class="history-state history-failed" role="alert"><span>{{ historyError }}</span><button type="button" class="nx-btn nx-btn-secondary" @click="messages.length ? loadEarlier() : loadMessages(activeId)">重试加载</button></div>
            <div v-if="hasEarlier && !loadingMessages" class="history-more"><button type="button" class="nx-btn nx-btn-secondary" :disabled="loadingEarlier || streaming" @click="loadEarlier">{{ loadingEarlier ? '正在加载…' : '加载更早的消息' }}</button></div>
            <!-- 空态：迎宾 + 开场白 + 智能体网格 -->
            <div v-if="!messages.length && !loadingMessages && !historyError" class="st-welcome">
              <!-- 日期/天气行：muted 小字，天气拉不到就只显示日期 -->
              <div class="st-welcome-date">
                {{ welcomeDate }}<template v-if="display.weather && welcomeWeather"> · 良乡校区 {{ welcomeWeather }}</template>
              </div>
              <div class="st-welcome-seal" aria-hidden="true">{{ sealChar }}</div>
              <h1 class="st-welcome-title">{{ display.welcomeTitle || activeAgent?.name || "你好" }}</h1>
              <p class="st-welcome-desc">
                {{ display.welcomeDescription || activeAgent?.description || "我是校园智能助手，课程、办事、资料都能问我。" }}
              </p>

              <div v-if="activeAgent?.greeting" class="st-greeting">
                <MarkdownView :content="activeAgent.greeting" />
              </div>

              <div v-if="display.recommendations && starters.length" class="nx-starters st-starters">
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

              <!-- 卡片只由模型按 systemPrompt 的卡片协议输出，欢迎页不再渲染任何内置卡 -->

              <div v-if="display.agentCards && agents.length" class="st-agents">
                <div
                  v-for="a in agents.slice(0, 6)"
                  :key="a.id"
                  class="st-agent"
                  :class="{ 'is-on': a.id === selectedAgentId }"
                  role="button"
                  tabindex="0"
                  @click="pickAgent(a)"
                  @keydown.enter.prevent="pickAgent(a)"
                >
                  <div class="st-agent-avatar">
                    <img v-if="isImageUrl(a.avatar)" :src="a.avatar!" alt="" />
                    <template v-else-if="a.avatar">{{ a.avatar }}</template>
                    <template v-else>{{ a.name.slice(0, 1) }}</template>
                  </div>
                  <div class="st-agent-meta">
                    <div class="st-agent-name">{{ a.name }}</div>
                    <div class="st-agent-desc">{{ truncate(a.description, 38) }}</div>
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
                <div v-if="msg.images?.length" class="nx-msg-images st-msg-images">
                  <img v-for="(img, i) in msg.images" :key="i" :src="img" alt="已发送的图片" />
                </div>
                <div class="nx-msg-bubble">{{ msg.content }}</div>
              </template>

              <!-- 助手消息 -->
              <template v-else>
                <div class="nx-msg-head">
                  <span class="st-msg-badge" aria-hidden="true">{{ assistantBadge }}</span>
                  <span class="nx-msg-name">{{ msg.modelName || "助手" }}</span>
                  <span v-if="msg.status === 'FAILED'" class="nx-msg-status">· 失败</span>
                  <span v-else-if="msg.status === 'ABORTED'" class="nx-msg-status">· 已中断</span>
                </div>

                <AgentRunDetails v-if="display.toolActivity" :progress="msg.runProgress" :metrics="msg.runMetrics" :tools="msg.toolEvents" :status="msg.streaming ? 'STREAMING' : msg.status"/>

                <KnowledgeSources v-if="display.sources" :sources="msg.kbHits"/>

                <div class="nx-msg-body">
                  <!--
                    助手正文按「Markdown / 卡片」交替分段渲染。
                    卡片是组件，不能走 MarkdownView 的 v-html，必须先切开。
                  -->
                  <CardMessage :content="msg.content" :streaming="!!msg.streaming" :disabled="streaming" :auto-play="!!msg.liveEffect" :effect-key="msg.id" :has-knowledge-sources="!!msg.kbHits?.length" :knowledge-sources="msg.kbHits" @ask="askFromCard" @switch-agent="switchAgentFromCard" @use-skill="useSkillFromCard"/>
                  <span v-if="msg.streaming" class="nx-caret" aria-hidden="true"></span>
                </div>

                <div v-if="msg.error" class="nx-msg-error">{{ msg.error }}</div>

                <!-- 消息操作：悬停才出现，不干扰阅读 -->
                <div v-if="!msg.streaming && msg.content" class="st-msg-actions">
                  <button
                    type="button"
                    class="nx-icon-btn"
                    aria-label="复制回答"
                    title="复制"
                    @click="copyMessage(msg.content)"
                  >
                    <IconCopy />
                  </button>
                  <AnswerVersions :conversation-id="activeId || ''" :message-id="msg.id" :disabled="streaming" @selected="Object.assign(msg,toChatMessage($event))" @generate="runRegenerate(false,msg)" />
                  <button
                    type="button"
                    class="nx-icon-btn"
                    :class="{ 'is-on': feedbackState[msg.id] === 'positive' }"
                    v-if="display.feedback" aria-label="回答有帮助"
                    title="有帮助"
                    @click="submitFeedback(msg.id, true)"
                  >
                    <IconThumbUp />
                  </button>
                  <button
                    type="button"
                    class="nx-icon-btn"
                    :class="{ 'is-on': feedbackState[msg.id] === 'negative' }"
                    v-if="display.feedback" aria-label="回答没帮助"
                    title="没帮助"
                    @click="submitFeedback(msg.id, false)"
                  >
                    <IconThumbDown />
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
          class="st-tobottom"
          aria-label="回到最新消息"
          @click="scrollToBottom(true)"
        >
          <IconDown />
        </button>
      </div>

      <!-- 输入区 -->
      <footer class="st-composer">
        <div class="st-composer-inner">
          <!--
            语义路由建议：答不上来时由后端读上下文给**一条意见**，
            学生决定是否换人。放在输入框上方：决策点离输入更近更自然。
          -->
          <Transition name="nx-pop">
            <div v-if="agentSuggestion" class="nx-notice st-suggest" role="status">
              <div class="st-suggest-body">
                <div class="st-suggest-line">
                  这次没答上来。看上下文，建议交给「{{ agentSuggestion.name }}」
                </div>
                <div v-if="agentSuggestion.reason" class="st-suggest-reason">
                  {{ agentSuggestion.reason }}
                </div>
              </div>
              <div class="st-suggest-actions">
                <button
                  type="button"
                  class="nx-btn nx-btn-primary nx-btn-sm"
                  :disabled="streaming"
                  @click="acceptSuggestion"
                >
                  交给它
                </button>
                <button type="button" class="nx-btn nx-btn-ghost nx-btn-sm" @click="dismissSuggestion">
                  不用
                </button>
              </div>
            </div>
          </Transition>

          <div class="st-composer-box">
            <KnowledgeShortcuts v-if="display.knowledgeShortcuts" :disabled="streaming" @ask="draft=$event"/>
            <!--
              辛瓜指南、外卖经验已收录知识库，直接提问即可查询；这里仅显示已启用的工具技能。
              学生没有技能选择器，这里是他们使用技能的唯一入口（原「本次启用」条
              只显示已勾选项，等于没有入口）。卡片激活的技能也并入此行。
            -->
            <div v-if="skillChips.length" class="st-skills">
              <span class="st-skills-label">技能</span>
              <button
                v-for="c in skillChips"
                :key="c.key"
                type="button"
                class="nx-chip"
                :class="{ 'is-on': c.on }"
                :aria-label="`${c.on ? '停用' : '启用'}技能 ${c.name}`"
                @click="toggleSkill(c.key)"
              >
                {{ c.name }}
                <span v-if="c.on" class="st-chip-x" aria-hidden="true">×</span>
              </button>
            </div>

            <ImageTransferProgress :state="imageTransfer"/>
            <div v-if="pendingImages.length" class="st-previews">
              <div v-for="(img, i) in pendingImages" :key="i" class="st-preview">
                <img :src="img" alt="待发送图片" />
                <button type="button" aria-label="移除图片" @click="pendingImages.splice(i, 1)">×</button>
              </div>
            </div>

            <textarea
              ref="inputEl"
              v-model="draft"
              class="st-textarea"
              rows="1"
              :placeholder="display.placeholder"
              aria-label="输入消息"
              :disabled="streaming || loadingMessages || (Boolean(historyError) && !messages.length)"
              @input="autoGrow"
              @keydown="composer.keydown" @compositionstart="composer.start" @compositionend="composer.end"
            ></textarea>

            <div class="st-composer-foot">
              <div class="st-composer-left">
                <button
                  v-if="visionSupported"
                  type="button"
                  class="nx-icon-btn"
                  aria-label="添加图片"
                  title="添加图片"
                  :disabled="streaming || imagePreparing"
                  @click="pickImage"
                >
                  <IconImage />
                </button>
                <span class="st-char">{{ draft.length }} 字</span>
              </div>

              <div class="st-composer-right">
                <button v-if="streaming" type="button" class="nx-btn nx-btn-secondary st-send" @click="stop">
                  <IconStop />
                  停止
                </button>
                <button
                  v-else
                  type="button"
                  class="nx-btn nx-btn-primary st-send"
                  :disabled="!draft.trim() || imagePreparing || loadingMessages || (Boolean(historyError) && !messages.length)"
                  @click="send"
                >
                  <IconSend />
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
          class="st-file"
          @change="onFilesPicked"
        />
        <p v-if="display.footer" class="st-display-footer">{{ display.footer }}</p>
      </footer>
    </section>

    <!-- ============ 首次使用引导：每个用户只弹一次，点遮罩等同跳过 ============ -->
    <Transition name="st-mask">
      <div v-if="display.onboarding && showOnboard" class="st-ob-mask" @click.self="finishOnboard(true)">
        <div class="st-ob-card" role="dialog" aria-modal="true" aria-label="首次使用引导">
          <div class="st-ob-title">欢迎使用{{ auth.siteName }}</div>
          <div class="st-ob-sub">开始前花 30 秒设置两件小事</div>

          <!-- 自动记忆：点按钮即落盘，之后跳过也尊重已做的选择 -->
          <div v-if="auth.settings?.memory_enabled!==false" class="st-ob-section">
            <div class="st-ob-label">自动记忆</div>
            <p class="st-ob-desc">
              开启后，我会在对话中自动记住你告诉我的信息（比如年级、偏好），下次不用重复说。可以随时在「我的记忆」页查看与删除。
            </p>
            <div class="st-ob-choice">
              <button
                type="button"
                class="nx-btn st-ob-opt"
                :class="{ 'is-on': onboardMemory }"
                @click="chooseMemory(true)"
              >
                开启
              </button>
              <button
                type="button"
                class="nx-btn st-ob-opt"
                :class="{ 'is-on': !onboardMemory }"
                @click="chooseMemory(false)"
              >
                不开启
              </button>
            </div>
          </div>

          <div v-if="auth.settings?.memory_enabled!==false" class="st-ob-section">
            <div class="st-ob-label">课表信息（选填，可跳过）</div>
            <textarea
              v-model="onboardSchedule"
              class="st-ob-textarea"
              rows="4"
              placeholder="粘贴你的课表文本，选填"
              aria-label="粘贴课表文本"
            ></textarea>
          </div>

          <div class="st-ob-foot">
            <button type="button" class="nx-btn nx-btn-ghost" @click="finishOnboard(true)">
              跳过
            </button>
            <button type="button" class="nx-btn nx-btn-primary" @click="finishOnboard(false)">
              保存并完成
            </button>
          </div>
        </div>
      </div>
    </Transition>
    <FeedbackDialog v-if="feedbackVisible" v-model="feedbackVisible" :message-id="feedbackMessageId" :positive="false" :has-existing="feedbackState[feedbackMessageId]==='negative'" @submitted="state => { if(state) feedbackState[feedbackMessageId]=state; else delete feedbackState[feedbackMessageId] }"/>
  </div>
</template>

<style scoped src="./student-chat.css"></style>

<style scoped>
.history-state{display:flex;align-items:center;justify-content:center;gap:12px;padding:24px 16px;color:var(--nx-text-2);font-size:14px;flex-wrap:wrap}.history-failed{color:var(--nx-danger);background:var(--nx-danger-soft);border-radius:12px;overflow-wrap:anywhere}.history-more{text-align:center;margin:0 0 24px}.history-pulse{width:8px;height:8px;border-radius:50%;background:var(--nx-accent);animation:history-pulse 1.2s ease-in-out infinite}@keyframes history-pulse{50%{opacity:.3}}@media(prefers-reduced-motion:reduce){.history-pulse{animation:none}}
</style>
