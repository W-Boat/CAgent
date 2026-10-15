<script setup lang="ts">
import AnswerLoading from '@/components/presentation/AnswerLoading.vue'
import {retainCardReadingPosition} from "@/utils/chat-follow"
import OutputPreferenceSelect from "@/components/OutputPreferenceSelect.vue"
import AnswerVersionControls from '@/components/AnswerVersionControls.vue'
import {useOutputPreference} from "@/composables/useOutputPreference"
const {outputPreference}=useOutputPreference()
import { composerKeys } from '@/utils/composer'
import {requestSse} from '@/api/sse'
import KnowledgeShortcuts from '@/components/KnowledgeShortcuts.vue'
import {studentDisplay} from '@/utils/student-display'
import AgentRunDetails from '@/components/AgentRunDetails.vue'
import type {AgentRunProgress,AgentRunMetrics} from '@/api/chat-stream'

import KnowledgeSources from '@/components/KnowledgeSources.vue'
import {normalizeKnowledgeSources} from '@/utils/knowledge-sources'
import type {KnowledgeSource} from '@/api/chat-stream'

/** Anonymous transport with the same layout and design tokens as /student. */
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import MarkdownView from '@/components/MarkdownView.vue'
import { IconCopy, IconDown, IconLogout, IconMenu, IconMoon, IconPlus, IconRefresh, IconSearch, IconSend, IconStop, IconSun, IconThumbDown, IconThumbUp, IconTrash } from '@/components/student/icons'
const CardMessage=defineAsyncComponent({loader:()=>import('@/components/CardMessage.vue'),loadingComponent:AnswerLoading,delay:0})
import { createStreamTyper } from '@/utils/stream-typewriter'
import { copyText, fromNow } from '@/utils/format'

defineOptions({ name: 'trial-chat' })
const API = `${(import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '')}/trial`
const auth = useAuthStore(), theme = useThemeStore()
const display=computed(()=>studentDisplay(auth.settings))
const siteName = computed(() => auth.siteName)
const sealChar = computed(() => siteName.value.match(/[\u4e00-\u9fa5]/)?.[0] || siteName.value[0] || '校')
const welcomeDate = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())
const starters = computed(()=>display.value.questions.length?display.value.questions:['请假怎么办？', '借书周末能办吗？', '在读证明在哪开？', '校园卡丢了怎么办？'])
interface TrialMessage {
  serverId?:string; versions?:any[]; selectedVersion?:number;id: number; role: 'user' | 'assistant'; content: string; roundId?: string
  status?: string; error?: string; feedback?: number; liveEffect?: boolean
  kbHits?: KnowledgeSource[];runProgress?:AgentRunProgress;runMetrics?:AgentRunMetrics;toolEvents?:any[]
}
interface TrialSession { draft: string; id: number; title: string; conversationId: string; messages: TrialMessage[]; updatedAt: string }
let sequence = 0
const newSession = (): TrialSession => ({ draft: '', id: ++sequence, title: '新的对话', conversationId: '', messages: [], updatedAt: new Date().toISOString() })
// Page-local sessions only; never load account conversations or persist anonymous IDs.
const sessions = ref<TrialSession[]>([newSession()]), activeId = ref(sessions.value[0].id)
const activeSession = computed(() => sessions.value.find(s => s.id === activeId.value)!)
const messages = computed(() => activeSession.value.messages)
const keyword = ref(''), manageMode = ref(false), selectedIds = ref(new Set<number>())
const conversations = computed(() => sessions.value.filter(s => s.messages.length && s.title.toLowerCase().includes(keyword.value.toLowerCase())).slice().reverse())
const quota = reactive({ used: 0, max: 5, left: 5 }), loadingQuota = ref(true)
const input = ref(''), streaming = ref(false), notice = ref(''), pendingFeedback = ref<TrialMessage | null>(null)
const composer = composerKeys(send)
watch(input, value => { if (activeSession.value) activeSession.value.draft = value }, { flush: 'sync' })
watch(activeId, () => { input.value = activeSession.value?.draft || ''; void nextTick(autoGrow) }, { flush: 'sync' })
const quotaError = ref('')
const scrollEl = ref<HTMLElement>(), inputEl = ref<HTMLTextAreaElement>(), pinnedToBottom = ref(true)
const narrowQuery = window.matchMedia('(max-width: 860px)')
const isNarrow = ref(narrowQuery.matches), sideHidden = ref(narrowQuery.matches)
let abortStream: (()=>void) | null = null, disposed = false
const typer = createStreamTyper({ write: (target, text) => { (target as TrialMessage).content = text }, onFrame: () => scrollToBottom() })
const inputPlaceholder = computed(() => quota.left <= 0 ? '今日体验次数已用完，欢迎明天再来' : display.value.placeholder)

function onViewportChange(e: MediaQueryListEvent) { isNarrow.value = e.matches; sideHidden.value = e.matches }
function onScroll() { const el = scrollEl.value; if (el) pinnedToBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }
function scrollToBottom(force = false) {
  if (!force && !pinnedToBottom.value) return
  void nextTick(() => { const el = scrollEl.value;if(!el||!force&&!pinnedToBottom.value)return;if(!force&&retainCardReadingPosition(messages.value.at(-1)?.content||"",el.scrollHeight-el.scrollTop-el.clientHeight,el.clientHeight)){pinnedToBottom.value=false;return}el.scrollTop = el.scrollHeight })
  if (force) pinnedToBottom.value = true
}
function autoGrow() { const el = inputEl.value; if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 190)}px` } }
function newConversation() {
  if (streaming.value) return
  if (!activeSession.value.messages.length) { sideHidden.value = isNarrow.value; return }
  const s = newSession(); sessions.value.push(s); activeId.value = s.id
  input.value = ''; pendingFeedback.value = null; notice.value = ''; manageMode.value = false; selectedIds.value.clear()
  sideHidden.value = isNarrow.value; void nextTick(autoGrow)
}
function openConversation(s: TrialSession) {
  if (streaming.value) return
  if (manageMode.value) { const set = selectedIds.value; set.has(s.id) ? set.delete(s.id) : set.add(s.id); return }
  activeId.value = s.id; pendingFeedback.value = null; notice.value = ''; sideHidden.value = isNarrow.value; scrollToBottom(true)
}
function removeConversations(ids: number[]) {
  if (streaming.value) return
  sessions.value = sessions.value.filter(s => !ids.includes(s.id))
  if (!sessions.value.length) sessions.value.push(newSession())
  if (!sessions.value.some(s => s.id === activeId.value)) { activeId.value = sessions.value[sessions.value.length - 1].id; pendingFeedback.value = null; input.value = ''; notice.value = ''; void nextTick(autoGrow) }
  selectedIds.value.clear()
}
function selectAll() { selectedIds.value = selectedIds.value.size === conversations.value.length ? new Set() : new Set(conversations.value.map(s => s.id)) }
function useStarter(text: string) { if (streaming.value) return; pendingFeedback.value = null; input.value = text; void nextTick(() => { autoGrow(); inputEl.value?.focus() }) }
function askFromCard(text: string) { if (streaming.value || quota.left <= 0) return; input.value = text; void send() }
function explainLoginFeature() { notice.value = '登录后可以切换智能体并使用更多技能。' }
async function copyMessage(text: string) { try { await copyText(text); notice.value = '回答已复制' } catch { notice.value = '复制失败，请手动选择回答文字。' } }
let bypassNext=false
function regenerate(msg:TrialMessage) { if(streaming.value||quota.left<=0||!msg.serverId)return;void send(msg) }
function selectVersion(msg:TrialMessage,index:number){if(streaming.value||!msg.versions?.[index])return;Object.assign(msg,msg.versions[index],{selectedVersion:index})}

async function refreshQuota() {
  loadingQuota.value = true; quotaError.value = ''
  try {
    const r = await fetch(`${API}/quota`, { signal: AbortSignal.timeout(10000) })
    if (!r.ok) throw new Error('暂时无法获取体验额度，请重试')
    const b = await r.json(), q = b?.data
    if (!q || ![q.used, q.max, q.left].every(v => Number.isFinite(v) && v >= 0)) throw new Error('体验额度加载失败，请重试')
    Object.assign(quota, q)
  } catch { quotaError.value = '无法获取体验额度，请检查网络后重试' }
  finally { loadingQuota.value = false }
}
async function send(revision?:TrialMessage) {
  const content = revision?messages.value.slice(0,messages.value.indexOf(revision)).reverse().find(m=>m.role==='user')?.content||'':input.value.trim()
  if (!content || streaming.value || loadingQuota.value || quotaError.value || quota.left <= 0) return
  const session = activeSession.value
  notice.value = ''; pendingFeedback.value = null; if(!revision)input.value = ''; void nextTick(autoGrow)
  if (!session.messages.length) session.title = content.slice(0, 50)
  if(!revision)session.messages.push({ id: ++sequence, role: 'user', content }, { id: ++sequence, role: 'assistant', content: '', status: 'STREAMING', liveEffect: true })
  const target = revision||session.messages[session.messages.length - 1]
  if(revision){typer.reset(target);if((revision.versions?.length||0)>=12){notice.value='此回答已达到12个版本上限';return}const saved={content:revision.content,status:revision.status,kbHits:revision.kbHits,roundId:revision.roundId,feedback:revision.feedback,runMetrics:revision.runMetrics};revision.versions||=[];revision.versions[revision.selectedVersion??revision.versions.length]=saved;revision.selectedVersion=revision.versions.length;revision.content='';revision.status='STREAMING';revision.error=undefined;revision.feedback=undefined}
  streaming.value = true; sideHidden.value = isNarrow.value; scrollToBottom(true)
  let status = '', fullText = ''
  const event = (name:string,p:any) => {
    if (name === 'meta') {session.conversationId = p.conversationId || session.conversationId;target.serverId=p.assistantMessageId||target.serverId}
    else if (name === 'text' && typeof p.text === 'string') { fullText += p.text; typer.push(target, p.text) }
    else if (name === 'trial') { Object.assign(quota, { used: p.used, max: p.max, left: p.left }); target.roundId = p.roundId }
    else if (name === 'kb') target.kbHits = normalizeKnowledgeSources(p.hits)
    else if(name==='runtime')target.runProgress=p
    else if(name==='tool_start'){target.toolEvents||=[];target.toolEvents.push({id:p.id,name:p.name,state:'running'})}
    else if(name==='tool_result'){const tool=target.toolEvents?.find(t=>t.id===p.id);if(tool)Object.assign(tool,{state:p.isError?'failed':'done',cached:p.cached,durationMs:p.durationMs})}
    else if (name === 'done') status = p.status || ''
    else if (name === 'error') target.error = p.message || p.error || '这一轮回答未能完成，请稍后再试。'
  }
  try {
    const transport=requestSse({url:API+'/chat',body:{content,conversationId:session.conversationId||undefined,outputPreference:outputPreference.value,bypassCache:!!revision||bypassNext,revisionMessageId:revision?.serverId},onFrame:frame=>event(frame.event,frame.data),onError:message=>{target.error=message},onDone:result=>{status=result.status;target.runMetrics=result.runtime;for(const tool of target.toolEvents||[])if(tool.state==='running')tool.state=result.status==='ABORTED'?'stopped':'failed'}})
    bypassNext=false
    abortStream=transport.abort
    await transport.done
    await new Promise<void>(resolve => typer.end(target, resolve))
    if (status==='ABORTED') target.status = 'ABORTED'
    else if (status === 'SUCCESS' && fullText.trim()) { target.status = 'SUCCESS'; if (target.roundId) pendingFeedback.value = target }
    else { target.status = 'FAILED'; target.error ||= '这一轮回答未能完成，请稍后再试。' }
  } catch (e) {
    typer.flush(target)
    target.status = 'FAILED'
    target.error = e instanceof Error ? e.message : '网络异常，请稍后再试'
  } finally {
    if(revision){revision.versions![revision.selectedVersion!]={content:revision.content,status:revision.status,kbHits:revision.kbHits,roundId:revision.roundId,feedback:revision.feedback,runMetrics:revision.runMetrics};if(!revision.content)Object.assign(revision,revision.versions![Math.max(0,revision.selectedVersion!-1)],{selectedVersion:Math.max(0,revision.selectedVersion!-1),error:revision.error})}
    session.updatedAt = new Date().toISOString()
    if (!disposed) { streaming.value = false; abortStream = null; scrollToBottom(); void refreshQuota() }
  }
}
function stop() { abortStream?.(); typer.flushAll() }

const OVERALL_OPTIONS = [{ value: 5, label: '很满意' }, { value: 4, label: '满意' }, { value: 3, label: '一般' }, { value: 2, label: '不满意' }, { value: 1, label: '很不满意' }]
const PROBLEM_OPTIONS = ['信息不准确或有编造', '没有给出可点的入口链接', '内容太啰嗦', '内容太简略', '没理解我的问题', '排版格式混乱', '回答太慢', '其他']
const WANT_OPTIONS = ['办事材料清单', '办理入口链接', '办理时间/窗口', '咨询电话', '相关通知公告', '办理步骤卡片', '部门地点与地图', '其他']
const survey = reactive({ visible: false, overall: 0, problems: [] as string[], wants: [] as string[], advice: '' })
const surveyMessage = ref<TrialMessage | null>(null), submittingSurvey = ref(false), surveyError = ref('')
watch(()=>display.value.feedback,on=>{if(!on){survey.visible=false;pendingFeedback.value=null}})
function openSurvey(msg: TrialMessage, overall = 0) {
  if (msg.feedback || !msg.roundId || msg.status !== 'SUCCESS') return
  surveyMessage.value = msg; Object.assign(survey, { visible: true, overall, problems: [], wants: [], advice: '' }); surveyError.value = ''
}
function toggle(list: string[], item: string) { const i = list.indexOf(item); i >= 0 ? list.splice(i, 1) : list.push(item) }
async function submitSurvey() {
  if (!survey.overall || submittingSurvey.value || !surveyMessage.value?.roundId) return
  submittingSurvey.value = true; surveyError.value = ''
  try {
    const r = await fetch(`${API}/survey`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({roundId: surveyMessage.value.roundId, overall: survey.overall, problems: survey.problems, wants: survey.wants, advice: survey.advice}) })
    const b = await r.json()
    if (!r.ok || !b?.data?.saved) throw new Error(b?.data?.message || b?.message || '反馈提交失败，请重试')
    surveyMessage.value.feedback = survey.overall
    if (pendingFeedback.value?.id === surveyMessage.value.id) pendingFeedback.value = null
    survey.visible = false; notice.value = '收到，谢谢你的反馈！'
  } catch (e) { surveyError.value = e instanceof Error ? e.message : '网络异常，反馈尚未提交。' }
  finally { submittingSurvey.value = false }
}
onMounted(() => { void refreshQuota(); narrowQuery.addEventListener('change', onViewportChange) })
onBeforeUnmount(() => { disposed = true; abortStream?.(); typer.flushAll(); typer.dispose(); narrowQuery.removeEventListener('change', onViewportChange) })
</script>

<template>
  <div class="nx-root nx-student trial-app">
    <Transition name="st-mask"><div v-if="isNarrow && !sideHidden" class="st-backdrop" @click="sideHidden = true"></div></Transition>
    <aside class="st-side" :class="{ 'is-hidden': sideHidden }" :inert="isNarrow && sideHidden">
      <div class="st-brand"><div class="st-seal" aria-hidden="true">{{ sealChar }}</div><div class="st-brand-text"><div class="st-brand-name">{{ siteName }}</div><div class="st-brand-sub">{{ display.subtitle }} · 体验版</div></div></div>
      <div class="st-side-actions">
        <button type="button" class="nx-btn nx-btn-primary nx-btn-block st-new" :disabled="streaming" @click="newConversation"><IconPlus/>新建对话</button>
        <button type="button" class="nx-btn nx-btn-block st-manage" :class="{ 'is-on': manageMode }" :aria-pressed="manageMode" :disabled="streaming" @click="manageMode = !manageMode; selectedIds.clear()">{{ manageMode ? '完成' : '管理' }}</button>
      </div>
      <OutputPreferenceSelect/>
      <div class="st-search"><div class="nx-search"><IconSearch/><input v-model="keyword" type="search" class="nx-input" placeholder="搜索本次对话" aria-label="搜索本次对话" @input="selectedIds.clear()"/></div></div>
      <div v-if="manageMode" class="st-bulk"><button class="nx-btn nx-btn-ghost nx-btn-sm" @click="selectAll">{{ selectedIds.size === conversations.length && conversations.length ? '全不选' : '全选' }}</button><button class="nx-btn nx-btn-danger nx-btn-sm" :disabled="!selectedIds.size" @click="removeConversations([...selectedIds])">删除所选{{ selectedIds.size ? `（${selectedIds.size}）` : '' }}</button><button class="nx-btn nx-btn-danger nx-btn-sm" :disabled="!conversations.length" @click="removeConversations(conversations.map(s => s.id))">全部删除</button></div>
      <div class="st-convs">
        <div v-if="!conversations.length" class="st-empty">{{ keyword ? '没有匹配的对话' : '还没有对话，从下面开始吧' }}</div>
        <div v-for="s in conversations" :key="s.id" class="st-conv" :class="{ 'is-active': s.id === activeId, 'is-checked': manageMode && selectedIds.has(s.id) }" role="button" tabindex="0" :aria-disabled="streaming" @click="openConversation(s)" @keydown.enter.prevent="openConversation(s)">
          <span v-if="manageMode" class="st-conv-check" :class="{ 'is-on': selectedIds.has(s.id) }" aria-hidden="true"></span>
          <div class="st-conv-body"><div class="st-conv-title">{{ s.title }}</div><div class="st-conv-meta">{{ s.messages.length }} 条 · {{ fromNow(s.updatedAt) }}</div></div>
          <button v-if="!manageMode" class="st-conv-del" aria-label="删除对话" :disabled="streaming" @click.stop="removeConversations([s.id])"><IconTrash/></button>
        </div>
      </div>
      <p class="trial-session-note">对话仅在本次页面中保留，刷新后清空。</p>
      <div class="st-user"><RouterLink v-if="display.mapEntry" to="/map" class="nx-icon-btn" aria-label="校园地图" title="校园地图">⌖</RouterLink><div class="nx-avatar st-user-avatar">访</div><div class="st-user-meta"><div class="st-user-name">访客体验</div><div class="st-user-role">无需登录</div></div><button v-if="theme.allowToggle" class="nx-icon-btn" :aria-label="theme.isDark ? '切换到浅色' : '切换到深色'" @click="theme.toggle()"><IconSun v-if="theme.isDark"/><IconMoon v-else/></button><RouterLink to="/login" class="nx-icon-btn" aria-label="登录完整版本" title="登录完整版本"><IconLogout/></RouterLink></div>
    </aside>
    <section class="st-main">
      <header class="st-top"><button v-if="isNarrow" class="nx-icon-btn" aria-label="打开对话列表" @click="sideHidden = false"><IconMenu/></button><div class="st-title-wrap"><div class="st-title">{{ activeSession.messages.length ? activeSession.title : display.welcomeTitle || '社科大校园导览' }}</div><div class="st-subtitle">{{ streaming ? '正在回复…' : display.subtitle + ' · 体验版' }}</div></div><span class="nx-chip trial-quota" :class="{ 'is-out': quota.left <= 0 }" role="status">{{ loadingQuota ? '读取额度…' : `今日剩余 ${quota.left}/${quota.max} 轮` }}</span><img v-if="auth.settings?.student_logo_url" :src="auth.settings.student_logo_url" class="st-logo" alt="学校标识"/></header>
      <div class="st-stage"><div ref="scrollEl" class="st-scroll" @scroll.passive="onScroll"><div class="st-body">
        <div v-if="!messages.length" class="st-welcome"><div class="st-welcome-date">{{ welcomeDate }}</div><div class="st-welcome-seal" aria-hidden="true">{{ sealChar }}</div><h1 class="st-welcome-title">{{ display.welcomeTitle || '社科大校园导览' }}</h1><p class="st-welcome-desc">{{ display.welcomeDescription || '我是校园智能助手，课程、办事、资料都能问我。' }}</p><div class="st-greeting"><MarkdownView content="你好！可以告诉我你要办的事项，我会帮你找步骤、材料和办理入口。"/></div><div v-if="display.recommendations" class="nx-starters st-starters"><button v-for="s in starters" :key="s" class="nx-starter" @click="useStarter(s)">{{ s }}</button></div></div>
        <div v-for="msg in messages" :key="msg.id" class="nx-msg" :class="msg.role === 'user' ? 'nx-msg-user' : 'nx-msg-ai'">
          <div v-if="msg.role === 'user'" class="nx-msg-bubble">{{ msg.content }}</div>
          <template v-else>
            <div class="nx-msg-head"><span class="st-msg-badge" aria-hidden="true">{{ sealChar }}</span><span class="nx-msg-name">校园助手</span><span v-if="msg.status === 'FAILED'" class="nx-msg-status">· 失败</span><span v-else-if="msg.status === 'ABORTED'" class="nx-msg-status">· 已停止</span></div>
            <AgentRunDetails v-if="display.toolActivity" :progress="msg.runProgress" :has-content="!!msg.content" :metrics="msg.runMetrics" :tools="msg.toolEvents" :status="msg.status"/><KnowledgeSources v-if="display.sources" :sources="msg.kbHits"/>
            <div class="nx-msg-body"><CardMessage :content="msg.content" :progress="msg.runProgress" :streaming="msg.status === 'STREAMING'" :disabled="streaming" :auto-play="!!msg.liveEffect" :effect-key="'trial-'+msg.id" :has-knowledge-sources="!!msg.kbHits?.length" :knowledge-sources="msg.kbHits" @ask="askFromCard" @switch-agent="explainLoginFeature" @use-skill="explainLoginFeature"/><span v-if="msg.status === 'STREAMING'" class="nx-caret" aria-hidden="true"></span></div>
            <div v-if="msg.error" class="nx-msg-error" role="alert">{{ msg.error }}</div>
            <div v-if="msg.status !== 'STREAMING' && msg.content" class="st-msg-actions"><button class="nx-icon-btn" aria-label="复制回答" title="复制" @click="copyMessage(msg.content)"><IconCopy/></button><AnswerVersionControls :count="msg.versions?.length || 1" :selected="msg.selectedVersion || 0" :disabled="streaming" :generate-disabled="quota.left <= 0" generate-title="生成新版本会使用体验额度；切换已有版本免费" @select="selectVersion(msg,$event)" @generate="regenerate(msg)"/><button v-if="display.feedback && msg.status === 'SUCCESS' && msg.roundId" class="nx-icon-btn" :class="{ 'is-on': (msg.feedback || 0) >= 4 }" aria-label="回答有帮助" title="有帮助" :disabled="!!msg.feedback" @click="openSurvey(msg, 5)"><IconThumbUp/></button><button v-if="display.feedback && msg.status === 'SUCCESS' && msg.roundId" class="nx-icon-btn" :class="{ 'is-on': !!msg.feedback && msg.feedback <= 2 }" aria-label="回答没帮助" title="没帮助" :disabled="!!msg.feedback" @click="openSurvey(msg, 2)"><IconThumbDown/></button></div>
          </template>
        </div>
      </div></div><button v-if="!pinnedToBottom && messages.length" class="st-tobottom" aria-label="回到最新消息" @click="scrollToBottom(true)"><IconDown/></button></div>
      <footer class="st-composer"><div class="st-composer-inner">
        <div v-if="notice" class="nx-notice trial-notice" role="status"><span>{{ notice }}</span><button class="nx-icon-btn" aria-label="关闭提示" @click="notice = ''">×</button></div>
        <div v-if="display.feedback && pendingFeedback && !streaming" class="nx-notice trial-feedback"><span>这一轮回答还满意吗？</span><button class="nx-link-btn" @click="openSurvey(pendingFeedback)">填写反馈</button><button class="nx-icon-btn" aria-label="稍后反馈" @click="pendingFeedback = null">×</button></div>
        <div v-if="quotaError" class="trial-quota-error" role="alert"><span>{{quotaError}}</span><button type="button" class="nx-link-btn" :disabled="loadingQuota" @click="refreshQuota">重试</button></div><KnowledgeShortcuts v-if="display.knowledgeShortcuts" :disabled="streaming||quota.left<=0" @ask="useStarter"/><div class="st-composer-box"><textarea ref="inputEl" v-model="input" class="st-textarea" rows="1" maxlength="4000" :placeholder="inputPlaceholder" aria-label="输入消息" :disabled="streaming || loadingQuota || Boolean(quotaError) || quota.left <= 0" @input="autoGrow" @keydown="composer.keydown" @compositionstart="composer.start" @compositionend="composer.end"></textarea><div class="st-composer-foot"><div class="st-composer-left"><span class="st-char">{{ input.length }} 字</span></div><div class="st-composer-right"><button v-if="streaming" class="nx-btn nx-btn-secondary st-send" @click="stop"><IconStop/>停止</button><button v-else class="nx-btn nx-btn-primary st-send" :disabled="!input.trim() || loadingQuota || Boolean(quotaError) || quota.left <= 0" @click="send()"><IconSend/>发送</button></div></div></div>
        <p class="trial-footnote"><span v-if="display.footer">{{ display.footer }}</span><RouterLink to="/login">登录完整版本</RouterLink></p>
      </div></footer>
    </section>
    <el-dialog v-model="survey.visible" class="nx-root trial-survey" title="这一轮回答还满意吗？" width="min(600px,94vw)" :close-on-click-modal="!submittingSurvey" :close-on-press-escape="!submittingSurvey" :show-close="!submittingSurvey" append-to-body>
      <p class="survey-intro">告诉我们哪里需要改进，也可以稍后再反馈。</p>
      <fieldset class="survey-question" :disabled="submittingSurvey"><legend>总体满意度</legend><div class="survey-options"><button v-for="opt in OVERALL_OPTIONS" :key="opt.value" class="nx-chip" :class="{ 'is-on': survey.overall === opt.value }" :aria-pressed="survey.overall === opt.value" @click="survey.overall = opt.value">{{ opt.label }}</button></div></fieldset>
      <fieldset class="survey-question" :disabled="submittingSurvey"><legend>回答存在的问题（多选）</legend><div class="survey-options"><button v-for="p in PROBLEM_OPTIONS" :key="p" class="nx-chip" :class="{ 'is-on': survey.problems.includes(p) }" :aria-pressed="survey.problems.includes(p)" @click="toggle(survey.problems, p)">{{ p }}</button></div></fieldset>
      <fieldset class="survey-question" :disabled="submittingSurvey"><legend>希望增加的内容（多选）</legend><div class="survey-options"><button v-for="w in WANT_OPTIONS" :key="w" class="nx-chip" :class="{ 'is-on': survey.wants.includes(w) }" :aria-pressed="survey.wants.includes(w)" @click="toggle(survey.wants, w)">{{ w }}</button></div></fieldset>
      <label class="survey-label" for="trial-advice">建议或补充说明（选填）</label><textarea id="trial-advice" v-model="survey.advice" class="nx-input survey-advice" rows="3" maxlength="1000" placeholder="例如：希望提供办事表格下载链接…" :disabled="submittingSurvey"></textarea>
      <p v-if="surveyError" class="survey-error" role="alert">{{ surveyError }}</p>
      <template #footer><button class="nx-btn nx-btn-ghost" :disabled="submittingSurvey" @click="survey.visible = false">稍后再说</button><button class="nx-btn nx-btn-primary" :disabled="!survey.overall || submittingSurvey" @click="submitSurvey">{{ submittingSurvey ? '提交中…' : '提交反馈' }}</button></template>
    </el-dialog>
  </div>
</template>

<style scoped src="../student/next/student-chat.css"></style>
<style scoped>
.trial-session-note { padding: 0 16px; margin: 12px 0; font-size: 11px; line-height: 1.6; color: var(--nx-text-3); }
.trial-quota { flex-shrink: 0; white-space: nowrap; font-variant-numeric: tabular-nums; }
.trial-quota.is-out { color: var(--nx-danger); background: var(--nx-danger-soft); }
.trial-notice, .trial-feedback { align-items: center; }
.trial-notice>span, .trial-feedback>span { flex: 1; min-width: 0; }
.trial-footnote { margin: 0; font-size: 11px; line-height: 1.6; text-align: center; color: var(--nx-text-3); }
.trial-footnote a { margin-left: 8px; color: var(--nx-text-2); text-decoration: none; }
.trial-footnote a:hover { color: var(--nx-accent); }
.survey-intro { margin: 0 0 20px; color: var(--nx-text-2); }
.survey-question { padding: 0; margin: 0 0 22px; border: 0; min-width: 0; }
.survey-question legend, .survey-label { display: block; margin-bottom: 10px; font-size: 13px; font-weight: 500; color: var(--nx-text); }
.survey-options { display: flex; gap: 8px; flex-wrap: wrap; }
.survey-options .nx-chip { padding: 6px 10px; white-space: normal; text-align: left; }
.survey-advice { width: 100%; padding: 10px 12px; resize: vertical; min-height: 78px; font: inherit; }
.survey-error { color: var(--nx-danger); font-size: 13px; }
@media(max-width:480px) { .trial-quota { font-size: 10px; padding: 3px 6px; } .trial-feedback { font-size: 12px; gap: 6px; } }
</style>

<style scoped>
.trial-quota-error{display:flex;gap:12px;align-items:center;justify-content:center;padding:10px;color:var(--nx-danger);font-size:13px;flex-wrap:wrap}
</style>
