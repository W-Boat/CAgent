<template>
  <div class="page browser-page">
    <div class="page-header">
      <div>
        <h2 class="page-title">浏览器操控台</h2>
        <p class="page-subtitle">
          网页在你自己的浏览器里渲染与操作（服务器不装浏览器）；所有动作与截图会留痕，可在后台回放
        </p>
      </div>
      <div class="page-actions">
        <el-button type="primary" @click="createVisible = true">
          <el-icon><Plus /></el-icon> 新建会话
        </el-button>
        <el-button :disabled="!activeSession" @click="guideVisible = true">
          <el-icon><Connection /></el-icon> 连接指引
        </el-button>
        <el-button @click="pcGuardVisible = true">
          <el-icon><Monitor /></el-icon> 扩展安装
        </el-button>
        <el-button @click="loadSessions">
          <el-icon><Refresh /></el-icon> 刷新
        </el-button>
      </div>
    </div>

    <div class="workbench">
      <!-- 会话列表 -->
      <aside class="sessions">
        <div class="sessions-head">
          <span>会话（{{ sessions.length }}个）</span>
          <el-tag
            v-if="activeSession?.executor !== 'SERVER' && activeSession"
            size="small"
            :type="activeSession.clientOnline ? 'success' : 'info'"
            effect="plain"
          >
            {{ activeSession.clientOnline ? "本地在线" : "本地离线" }}
          </el-tag>
          <el-tag v-else-if="activeSession?.alive" size="small" type="success" effect="plain">
            运行中
          </el-tag>
        </div>
        <div class="sessions-list" v-loading="loadingSessions">
          <div
            v-for="s in sessions"
            :key="s.id"
            class="session-item"
            :class="{ active: s.id === activeId }"
            @click="selectSession(s.id)"
          >
            <div class="si-main">
              <div class="si-name">
                {{ s.name }}
                <el-tag size="small" effect="plain" class="si-kind">
                  {{ s.executor === "SERVER" ? "服务器" : "本地" }}
                </el-tag>
              </div>
              <div class="si-url mono">{{ s.currentUrl || s.startUrl || "尚未导航" }}</div>
            </div>
            <div class="si-meta">
              <el-tag :type="statusType(s.status)" size="small" effect="plain">
                {{ statusText(s.status) }}
              </el-tag>
              <span class="muted">{{ s._count?.steps ?? s.steps?.length ?? 0 }} 步</span>
            </div>
            <el-button
              text
              type="danger"
              size="small"
              class="si-close"
              @click.stop="closeSession(s)"
            >
              <el-icon><Close /></el-icon>
            </el-button>
          </div>
          <el-empty v-if="!loadingSessions && sessions.length === 0" description="还没有浏览器会话" :image-size="70" />
        </div>
      </aside>

      <!-- 主区域 -->
      <section class="main">
        <template v-if="activeSession">
          <!-- 地址栏 -->
          <div class="addr-bar">
            <el-button-group>
              <el-button :disabled="busy" @click="quick('back')">
                <el-icon><Back /></el-icon>
              </el-button>
              <el-button :disabled="busy" @click="quick('forward')">
                <el-icon><Right /></el-icon>
              </el-button>
              <el-button :disabled="busy" @click="quick('reload')">
                <el-icon><RefreshRight /></el-icon>
              </el-button>
            </el-button-group>
            <el-input
              v-model="address"
              placeholder="输入网址后回车，如 www.example.com"
              class="addr-input"
              :disabled="busy"
              @keyup.enter="goTo"
            >
              <template #prefix><el-icon><Link /></el-icon></template>
            </el-input>
            <el-button type="primary" :loading="busy" @click="goTo">访问</el-button>
            <el-dropdown trigger="click" @command="quickUrl">
              <el-button :disabled="busy">
                <el-icon><Star /></el-icon> 常用
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item v-for="q in QUICK_URLS" :key="q.url" :command="q.url">
                    <el-icon><component :is="q.icon" /></el-icon>
                    {{ q.label }}
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>

          <div class="toolbar">
            <el-button
              v-for="tool in TOOLS"
              :key="tool.action"
              size="small"
              :disabled="busy"
              @click="openTool(tool)"
            >
              <el-icon><component :is="tool.icon" /></el-icon> {{ tool.label }}
            </el-button>
            <el-button size="small" :disabled="busy" @click="runAction({ action: 'scroll', value: '800' })">
              <el-icon><Sort /></el-icon> 下滚一屏
            </el-button>
            <el-button size="small" :disabled="busy" @click="quick('screenshot')">
              <el-icon><Camera /></el-icon> 立即截图
            </el-button>
          </div>

          <div class="screen-wrap">
            <div class="screen-bar">
              <span class="screen-title">{{ lastStep?.title || activeSession.name }}</span>
              <span class="muted mono">{{ lastStep?.url || activeSession.currentUrl || "-" }}</span>
              <el-tag
                v-if="isLocalSession"
                size="small"
                :type="activeSession.clientOnline ? 'success' : 'info'"
                effect="plain"
              >
                {{ activeSession.clientOnline ? "本地浏览器在线" : "等待本地连接" }}
              </el-tag>
              <el-button text size="small" :disabled="busy" @click="quick('screenshot')">
                <el-icon><Camera /></el-icon> 截图留痕
              </el-button>
            </div>

            <div class="screen" v-loading="busy">
              <img
                v-if="screenShot"
                :src="screenShot"
                class="screen-img"
                alt="页面截图"
                @click="previewVisible = true"
              />
              <!-- 本地执行：服务器没有浏览器，画面来自本地客户端回传的截图 -->
              <div v-else class="screen-empty">
                <el-icon :size="42"><Monitor /></el-icon>
                <template v-if="isLocalSession">
                  <p>页面在你的本地浏览器中，服务器不保存实时画面。</p>
                  <p class="muted">
                    连接本地浏览器后执行任意动作，截图会自动回传到这里。
                  </p>
                  <el-button type="primary" @click="guideVisible = true">
                    <el-icon><Connection /></el-icon> 查看连接指引
                  </el-button>
                </template>
                <p v-else>暂无画面，先访问一个网址或点击「截图留痕」。</p>
              </div>
            </div>
          </div>

          <!-- 动作面板 -->
          <div class="panel">
            <el-tabs v-model="panelTab">
              <el-tab-pane label="动作" name="action">
                <el-form label-width="88px" class="action-form">
                  <el-form-item label="动作类型">
                    <el-select v-model="actionForm.action" style="width: 200px" @change="onActionChange">
                      <el-option v-for="a in ACTIONS" :key="a.value" :label="a.label" :value="a.value" />
                    </el-select>
                  </el-form-item>

                  <el-form-item v-if="needsSelector" label="选择器" required>
                    <el-input
                      v-model="actionForm.selector"
                      placeholder="CSS 选择器，如 #search 或 .btn-primary"
                    />
                  </el-form-item>

                  <el-form-item v-if="needsValue" :label="valueLabel" required>
                    <el-input
                      v-if="actionForm.action === 'evaluate'"
                      v-model="actionForm.value"
                      type="textarea"
                      :rows="3"
                      placeholder="() => document.title"
                    />
                    <el-input v-else v-model="actionForm.value" :placeholder="valuePlaceholder" />
                  </el-form-item>

                  <el-form-item label="超时(ms)">
                    <el-input-number v-model="actionForm.timeout" :min="1000" :step="1000" />
                  </el-form-item>

                  <el-form-item>
                    <el-button type="primary" :loading="busy" @click="submitAction">
                      <el-icon><CaretRight /></el-icon> 执行动作
                    </el-button>
                    <el-button @click="resetActionForm">重置</el-button>
                  </el-form-item>
                </el-form>

                <el-alert
                  v-if="actionForm.action === 'evaluate'"
                  title="evaluate 会在页面上下文执行脚本，仅返回可序列化结果"
                  type="warning"
                  show-icon
                  :closable="false"
                />
              </el-tab-pane>

              <el-tab-pane :label="`操作轨迹（${steps.length}）`" name="steps">
                <div class="steps">
                  <div v-if="steps.length > 0" class="steps-actions">
                    <el-button size="small" @click="exportSession">
                      <el-icon><Download /></el-icon> 导出轨迹
                    </el-button>
                  </div>
                  <div v-for="step in reversedSteps" :key="step.id" class="step">
                    <div class="step-head">
                      <el-tag size="small" :type="statusType(step.status)" effect="plain">
                        #{{ step.seq }} {{ step.action }}
                      </el-tag>
                      <span class="muted">{{ formatDuration(step.durationMs) }}</span>
                      <span class="muted">{{ fromNow(step.createdAt) }}</span>
                      <el-button
                        v-if="step.screenshotPath"
                        text
                        size="small"
                        @click="showStepShot(step)"
                      >
                        查看截图
                      </el-button>
                    </div>
                    <div v-if="step.selector" class="step-line mono">selector: {{ step.selector }}</div>
                    <div v-if="step.value" class="step-line mono">value: {{ truncate(step.value, 120) }}</div>
                    <div v-if="step.url" class="step-line muted mono">{{ step.url }}</div>
                    <el-alert
                      v-if="step.error"
                      :title="step.error"
                      type="error"
                      show-icon
                      :closable="false"
                      class="step-error"
                    />
                    <pre v-if="step.snapshot" class="step-snapshot">{{
                      JSON.stringify(step.snapshot, null, 2)
                    }}</pre>
                  </div>
                  <el-empty v-if="steps.length === 0" description="还没有执行任何动作" :image-size="70" />
                </div>
              </el-tab-pane>

              <el-tab-pane label="抽取结果" name="result">
                <pre v-if="lastResult" class="result-body">{{ JSON.stringify(lastResult, null, 2) }}</pre>
                <el-empty v-else description="执行 extract / evaluate 后在此查看结构化结果" :image-size="70" />
              </el-tab-pane>
            </el-tabs>
          </div>
        </template>

        <div v-else class="main-empty">
          <el-icon :size="52"><Monitor /></el-icon>
          <h3>选择或新建一个浏览器会话</h3>
          <p class="muted">每个会话独占一个 Chromium 实例，所有操作会记录轨迹与截图</p>
          <el-button type="primary" @click="createVisible = true">新建会话</el-button>
        </div>
      </section>
    </div>

    <!-- 新建会话 -->
    <el-dialog v-model="createVisible" title="新建浏览器会话" width="520px" destroy-on-close>
      <el-form label-width="100px">
        <el-form-item label="会话名称">
          <el-input v-model="createForm.name" placeholder="如：教务系统查分" />
        </el-form-item>

        <el-form-item label="执行位置">
          <el-radio-group v-model="createForm.executor">
            <el-radio-button value="LOCAL">本地浏览器</el-radio-button>
            <el-radio-button value="SERVER">服务器</el-radio-button>
          </el-radio-group>
          <div v-if="createForm.executor === 'LOCAL'" class="field-desc block">
            网页在<b>你自己的浏览器</b>里渲染：能看需要登录的页面，服务器不安装 Chromium。
            需配合浏览器扩展，或用下方「网页端直连」操作本站页面。
          </div>
          <div v-else class="field-desc block">
            在服务器上启动无头 Chromium。需服务器内存充足并已安装浏览器，否则会启动失败。
          </div>
        </el-form-item>

        <el-form-item v-if="createForm.executor === 'LOCAL'" label="客户端">
          <el-radio-group v-model="createForm.clientKind">
            <el-radio-button value="EXTENSION">浏览器扩展</el-radio-button>
            <el-radio-button value="WEB">网页端直连</el-radio-button>
          </el-radio-group>
          <div class="field-desc block">
            <template v-if="createForm.clientKind === 'EXTENSION'">
              可操作<b>任意网站</b>的标签页并截图。需先在浏览器加载 <code>apps/extension</code>。
            </template>
            <template v-else>
              无需安装任何东西，但受同源策略限制，<b>只能操作本站页面</b>。
            </template>
          </div>
        </el-form-item>

        <el-form-item label="起始地址">
          <el-input v-model="createForm.startUrl" placeholder="选填，如 https://www.example.com" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="createSession">创建</el-button>
      </template>
    </el-dialog>

    <!-- 本地连接指引 -->
    <el-dialog
      v-model="guideVisible"
      title="连接本地浏览器"
      width="600px"
      destroy-on-close
    >
      <div v-if="activeSession" class="guide">
        <el-alert
          type="info"
          :closable="false"
          show-icon
          title="服务端只负责下发指令与留痕，网页渲染与操作在你本机完成"
        />

        <h4 class="guide-title">连接信息</h4>
        <div class="guide-row">
          <span class="guide-label">服务地址</span>
          <code class="guide-val">{{ origin }}</code>
        </div>
        <div class="guide-row">
          <span class="guide-label">会话 ID</span>
          <code class="guide-val">{{ activeSession.id }}</code>
          <el-button text size="small" @click="copyText(activeSession.id)">复制</el-button>
        </div>
        <div class="guide-row">
          <span class="guide-label">访问令牌</span>
          <code class="guide-val token">{{ tokenPreview }}</code>
          <el-button text size="small" @click="copyText(currentToken)">复制</el-button>
        </div>

        <h4 class="guide-title">用浏览器扩展（推荐，可操作任意网站）</h4>
        <ol class="guide-steps">
          <li>打开 <code>chrome://extensions</code>，开启右上角「开发者模式」</li>
          <li>点「加载已解压的扩展程序」，选择项目里的 <code>apps/extension</code> 目录</li>
          <li>点工具栏的 CAgent 图标，填入上面的三项信息，点「连接」</li>
        </ol>

        <h4 class="guide-title">用网页端直连（免安装，仅本站页面）</h4>
        <p class="guide-desc">
          点下方按钮后，本页会开始轮询指令并<b>在当前页面</b>执行动作。
          受浏览器同源策略限制，无法操作第三方网站（如教务系统），也无法截图。
        </p>
        <el-button
          :type="workerRunning ? 'danger' : 'primary'"
          @click="toggleWebWorker"
        >
          <el-icon><component :is="workerRunning ? 'VideoPause' : 'VideoPlay'" /></el-icon>
          {{ workerRunning ? "停止网页端执行" : "在本页启动网页端执行" }}
        </el-button>
      </div>
    </el-dialog>

    <!-- 截图预览 -->
    <el-dialog v-model="previewVisible" title="页面截图" width="80%" top="4vh" append-to-body>
      <img v-if="screenShot" :src="screenShot" class="preview-img" alt="截图预览" />
    </el-dialog>

    <el-dialog v-model="stepShotVisible" title="操作截图" width="80%" top="4vh" append-to-body>
      <img v-if="stepShot" :src="stepShot" class="preview-img" alt="操作截图" />
    </el-dialog>

    <!-- 首次进入的引导：移动端劝去 PC，PC 端引导装扩展 -->
    <PcOnlyGuard
      v-model="pcGuardVisible"
      feature-name="浏览器操控"
      :session-id="activeId"
      @use-web="onGuardUseWeb"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue"
import { browserApi } from "@/api"
import { toastError, toastOk, tokenStore } from "@/api/client"
import type {
  BrowserCommandItem,
  BrowserSession,
  BrowserStep
} from "@/api/types"
import { startLocalWorker } from "@/localtools/worker"
import PcOnlyGuard from "@/components/PcOnlyGuard.vue"
import { isBrowserTipDismissed, isMobileDevice } from "@/utils/browser-tip"
import {
  artifactUrl,
  copyText,
  formatDuration,
  fromNow,
  statusText,
  statusType,
  truncate
} from "@/utils/format"

const TOOLS = [
  { action: "click", label: "点击", icon: "Pointer", needsSelector: true, needsValue: false },
  { action: "type", label: "输入", icon: "EditPen", needsSelector: true, needsValue: true },
  { action: "press", label: "按键", icon: "Position", needsSelector: true, needsValue: true },
  { action: "select", label: "下拉选择", icon: "ArrowDown", needsSelector: true, needsValue: true },
  { action: "waitFor", label: "等待元素", icon: "Timer", needsSelector: true, needsValue: false },
  { action: "wait", label: "等待时间", icon: "AlarmClock", needsSelector: false, needsValue: true },
  { action: "extract", label: "抽取内容", icon: "DocumentCopy", needsSelector: true, needsValue: false },
  { action: "evaluate", label: "执行脚本", icon: "Cpu", needsSelector: false, needsValue: true }
]

// 常用网址模板（针对 UCASS 校园系统）
const QUICK_URLS = [
  { label: "教务系统", url: "https://jwgl.ucass.edu.cn", icon: "Reading" },
  { label: "网络中心", url: "https://nic.ucass.edu.cn", icon: "Connection" },
  { label: "图书馆", url: "https://lib.ucass.edu.cn", icon: "Collection" },
  { label: "邮件系统", url: "https://mail.ucass.edu.cn", icon: "Message" },
  { label: "校园门户", url: "https://portal.ucass.edu.cn", icon: "HomeFilled" }
]

const ACTIONS = [
  { value: "goto", label: "goto 导航" },
  { value: "click", label: "click 点击" },
  { value: "type", label: "type 输入文本" },
  { value: "press", label: "press 按键" },
  { value: "select", label: "select 下拉选择" },
  { value: "waitFor", label: "waitFor 等待元素出现" },
  { value: "wait", label: "wait 等待毫秒" },
  { value: "extract", label: "extract 抽取页面内容" },
  { value: "evaluate", label: "evaluate 执行脚本" },
  { value: "screenshot", label: "screenshot 截图" },
  { value: "scroll", label: "scroll 滚动" },
  { value: "back", label: "back 后退" },
  { value: "forward", label: "forward 前进" },
  { value: "reload", label: "reload 刷新" },
  { value: "content", label: "content 获取 HTML" }
]

const SELECTOR_ACTIONS = ["click", "type", "press", "select", "waitFor", "extract"]
const VALUE_ACTIONS = ["goto", "type", "press", "select", "wait", "evaluate", "scroll"]

const sessions = ref<BrowserSession[]>([])
const loadingSessions = ref(false)
const activeId = ref("")
const steps = ref<BrowserStep[]>([])
const busy = ref(false)
const panelTab = ref("action")
const address = ref("")
const lastResult = ref<unknown>(null)
const commands = ref<BrowserCommandItem[]>([])

/** 本地连接指引弹窗 */
const guideVisible = ref(false)

/**
 * 首次进入时的引导提示。
 *
 * 两类人看到不同内容：
 *   - 移动端：明确告知需要在电脑上使用（浏览器功能依赖本机权限与窗口尺寸）
 *   - PC 端：引导安装扩展以解锁「操作任意网站 + 截图」等完整能力
 * 点过「不再提示」后不再打扰；移动端不记该标记，换到 PC 仍会引导装扩展。
 */
const pcGuardVisible = ref(false)
/** 网页端直连：是否已在本页启动指令轮询 */
const workerRunning = ref(false)
let stopWorker: (() => void) | null = null

const origin = computed(() => window.location.origin)
const currentToken = computed(() => tokenStore.access)
const tokenPreview = computed(() => {
  const t = tokenStore.access
  if (!t) return "（未登录）"
  return t.length > 24 ? `${t.slice(0, 12)}…${t.slice(-8)}` : t
})

/** 当前会话是否走本地执行 */
const isLocalSession = computed(() => activeSession.value?.executor !== "SERVER")

const activeSession = computed(
  () => sessions.value.find((s) => s.id === activeId.value) || null
)

const reversedSteps = computed(() => [...steps.value].reverse())
const reversedCommands = computed(() => [...commands.value].reverse())

/** 最新一张截图：优先取最近一步带截图的记录 */
const screenShot = computed(() => {
  for (let i = steps.value.length - 1; i >= 0; i--) {
    const step = steps.value[i]
    if (step.screenshotPath) return `${artifactUrl(step.screenshotPath)}?t=${step.seq}`
  }
  return ""
})

const lastStep = computed(() => steps.value[steps.value.length - 1] || null)

const needsSelector = computed(() => SELECTOR_ACTIONS.includes(actionForm.action))
const needsValue = computed(() => VALUE_ACTIONS.includes(actionForm.action))

const valueLabel = computed(() => {
  switch (actionForm.action) {
    case "goto":
      return "目标地址"
    case "type":
      return "输入文本"
    case "press":
      return "按键"
    case "select":
      return "选项值"
    case "wait":
      return "毫秒数"
    case "evaluate":
      return "脚本"
    case "scroll":
      return "滚动像素"
    default:
      return "值"
  }
})

const valuePlaceholder = computed(() => {
  switch (actionForm.action) {
    case "goto":
      return "https://www.example.com"
    case "press":
      return "Enter"
    case "select":
      return "选项的 value"
    case "wait":
      return "1000"
    case "scroll":
      return "800"
    default:
      return ""
  }
})

const createVisible = ref(false)
const creating = ref(false)
const createForm = reactive({
  name: "",
  startUrl: "",
  executor: "LOCAL" as "LOCAL" | "SERVER",
  clientKind: "EXTENSION" as "WEB" | "EXTENSION"
})

const previewVisible = ref(false)
const stepShotVisible = ref(false)
const stepShot = ref("")

const actionForm = reactive({
  action: "click",
  selector: "",
  value: "",
  timeout: 15000
})

let timer: number | undefined

async function loadSessions() {
  loadingSessions.value = true
  try {
    const page = await browserApi.sessions({ page: 1, pageSize: 50 })
    sessions.value = page.items
    if (!activeId.value && page.items.length > 0) {
      await selectSession(page.items[0].id)
    } else if (activeId.value && !page.items.some((s) => s.id === activeId.value)) {
      activeId.value = ""
      steps.value = []
    }
  } catch (error) {
    toastError(error, "会话列表加载失败")
  } finally {
    loadingSessions.value = false
  }
}

async function selectSession(id: string) {
  activeId.value = id
  lastResult.value = null
  try {
    const detail = await browserApi.detail(id)
    steps.value = detail.steps || []
    commands.value = detail.commands || []
    address.value = detail.currentUrl || detail.startUrl || ""
  } catch (error) {
    toastError(error, "会话详情加载失败")
  }
}

async function createSession() {
  creating.value = true
  try {
    const session = await browserApi.create({
      name: createForm.name || undefined,
      startUrl: createForm.startUrl || undefined,
      executor: createForm.executor,
      clientKind: createForm.executor === "LOCAL" ? createForm.clientKind : undefined
    })
    toastOk(
      createForm.executor === "LOCAL"
        ? "本地会话已创建，请按指引连接你的浏览器"
        : "服务端会话已创建"
    )
    createVisible.value = false
    createForm.name = ""
    createForm.startUrl = ""
    await loadSessions()
    await selectSession(session.id)
    // 本地会话直接弹出连接指引，省得用户到处找会话 ID
    if (createForm.executor === "LOCAL") guideVisible.value = true
  } catch (error) {
    toastError(error, "创建会话失败")
  } finally {
    creating.value = false
  }
}

async function closeSession(session: BrowserSession) {
  try {
    await ElMessageBox.confirm(
      isLocalSession.value
        ? `关闭会话「${session.name}」？本地浏览器将停止接收指令，操作轨迹仍保留。`
        : `关闭会话「${session.name}」？浏览器实例会被释放，操作轨迹仍保留。`,
      "关闭会话",
      { type: "warning", confirmButtonText: "关闭", cancelButtonText: "取消" }
    )
  } catch {
    return
  }
  try {
    await browserApi.close(session.id)
    toastOk("会话已关闭")
    if (activeId.value === session.id) {
      stopWebWorker()
      activeId.value = ""
      steps.value = []
      commands.value = []
    }
    await loadSessions()
  } catch (error) {
    toastError(error)
  }
}

/**
 * 执行一个动作。
 *
 * LOCAL 会话只入队：真正的点击/输入发生在用户自己的浏览器里，
 * 这里轮询等待本地客户端回填结果，再把结果显示出来。
 * SERVER 会话沿用原来的同步执行。
 */
async function runAction(payload: {
  action: string
  selector?: string
  value?: string
  timeout?: number
}) {
  if (!activeId.value) return
  busy.value = true
  try {
    if (isLocalSession.value) {
      await runLocalAction(payload)
    } else {
      await runServerAction(payload)
    }
    await refreshSteps()
  } catch (error) {
    ElMessage.error({
      message: `${payload.action} 操作异常：${
        error instanceof Error ? error.message : "未知错误"
      }`,
      duration: 4000
    })
  } finally {
    busy.value = false
  }
}

/** 本地执行：入队 → 等本地客户端回填 */
async function runLocalAction(payload: {
  action: string
  selector?: string
  value?: string
  timeout?: number
}) {
  const sessionId = activeId.value
  const queued = await browserApi.enqueue(sessionId, payload)

  const online = activeSession.value?.clientOnline
  if (!online) {
    ElMessage.warning({
      message: "指令已下发，但本地浏览器尚未连接。请按「连接指引」接入后重试。",
      duration: 5000
    })
  }

  // 本地客户端每 1.2 秒轮询一次，这里给足 30 秒等待
  const deadline = Date.now() + 30_000
  let finished: BrowserCommandItem | null = null

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000))
    const res = await browserApi.commands(sessionId, queued.seq - 1)
    const hit = res.items.find((c) => c.id === queued.id)
    if (hit && ["DONE", "FAILED", "EXPIRED"].includes(hit.status)) {
      finished = hit
      break
    }
  }

  if (!finished) {
    ElMessage.warning({
      message: "本地浏览器未在 30 秒内响应，请确认扩展或网页端执行已启动",
      duration: 5000
    })
    return
  }

  lastResult.value = finished.result ?? finished
  if (finished.status === "DONE") {
    if (finished.result !== undefined) panelTab.value = "result"
    ElMessage.success({
      message: `${payload.action} 成功，耗时 ${finished.durationMs ?? 0}ms`,
      duration: 2000
    })
  } else {
    ElMessage.error({
      message: `${payload.action} 失败：${finished.error || "未知错误"}`,
      duration: 4000
    })
  }
}

/** 服务端执行：同步返回结果 */
async function runServerAction(payload: {
  action: string
  selector?: string
  value?: string
  timeout?: number
}) {
  const startTime = Date.now()
  const result = await browserApi.action(activeId.value, payload)
  const duration = Date.now() - startTime
  lastResult.value = result

  if (!result.ok) {
    ElMessage.error({
      message: `${payload.action} 操作失败：${result.error || "未知错误"}`,
      duration: 4000
    })
  } else if (result.data !== undefined) {
    panelTab.value = "result"
    ElMessage.success({
      message: `${payload.action} 成功，耗时 ${duration}ms，已返回结构化结果`,
      duration: 2000
    })
  } else {
    ElMessage.success({
      message: `${payload.action} 成功，耗时 ${duration}ms`,
      duration: 2000
    })
  }
}

/** 在本页启动/停止网页端执行循环 */
function toggleWebWorker() {
  if (workerRunning.value) {
    stopWebWorker()
    toastOk("已停止网页端执行")
    return
  }
  if (!activeId.value) return

  stopWorker = startLocalWorker({
    sessionId: activeId.value,
    clientKind: "WEB",
    // 网页端只能操作当前页面
    getContext: () => ({ doc: document, win: window }),
    onResult: (_cmd, result) => {
      if (!result.ok) {
        ElMessage.error({ message: `本地执行失败：${result.error}`, duration: 4000 })
      }
      void refreshSteps()
    },
    onError: () => undefined
  })
  workerRunning.value = true
  toastOk("网页端执行已启动，等待指令…")
}

function stopWebWorker() {
  stopWorker?.()
  stopWorker = null
  workerRunning.value = false
}

async function refreshSteps() {
  if (!activeId.value) return
  try {
    const detail = await browserApi.detail(activeId.value)
    steps.value = detail.steps || []
    commands.value = detail.commands || []
    if (detail.currentUrl) address.value = detail.currentUrl
    const idx = sessions.value.findIndex((s) => s.id === activeId.value)
    if (idx >= 0) {
      sessions.value[idx] = {
        ...sessions.value[idx],
        currentUrl: detail.currentUrl,
        clientOnline: detail.clientOnline
      }
    }
  } catch {
    // 静默失败：轨迹刷新不影响主流程
  }
}

function submitAction() {
  const payload: { action: string; selector?: string; value?: string; timeout?: number } = {
    action: actionForm.action,
    timeout: actionForm.timeout
  }
  if (needsSelector.value) payload.selector = actionForm.selector.trim()
  if (needsValue.value) payload.value = actionForm.value

  if (needsSelector.value && !payload.selector) {
    toastError(new Error("该动作需要提供选择器"))
    return
  }
  if (needsValue.value && !payload.value) {
    toastError(new Error("该动作需要提供值"))
    return
  }
  void runAction(payload)
}

function resetActionForm() {
  actionForm.selector = ""
  actionForm.value = ""
  actionForm.timeout = 15000
}

function onActionChange() {
  actionForm.selector = ""
  actionForm.value = ""
  if (actionForm.action === "wait") actionForm.value = "1000"
  if (actionForm.action === "scroll") actionForm.value = "800"
  if (actionForm.action === "press") actionForm.value = "Enter"
}

function openTool(tool: (typeof TOOLS)[number]) {
  actionForm.action = tool.action
  actionForm.selector = ""
  actionForm.value = ""
  if (tool.action === "press") actionForm.value = "Enter"
  if (tool.action === "wait") actionForm.value = "1000"
}

function quick(action: string) {
  void runAction({ action })
}

function goTo() {
  const url = address.value.trim()
  if (!url) {
    toastError(new Error("请输入网址"))
    return
  }
  void runAction({ action: "goto", value: url })
}

function quickUrl(url: string) {
  address.value = url
  void runAction({ action: "goto", value: url })
}

// 导出会话操作轨迹
async function exportSession() {
  if (!activeSession.value) return
  
  const data = {
    session: {
      id: activeSession.value.id,
      name: activeSession.value.name,
      startUrl: activeSession.value.startUrl,
      currentUrl: activeSession.value.currentUrl,
      createdAt: activeSession.value.createdAt,
      closedAt: activeSession.value.closedAt
    },
    steps: steps.value.map(s => ({
      seq: s.seq,
      action: s.action,
      selector: s.selector,
      value: s.value,
      url: s.url,
      status: s.status,
      error: s.error,
      durationMs: s.durationMs,
      createdAt: s.createdAt
    }))
  }
  
  const json = JSON.stringify(data, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `browser-session-${activeSession.value.name}-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
  toastOk("操作轨迹已导出")
}

function showStepShot(step: BrowserStep) {
  stepShot.value = artifactUrl(step.screenshotPath)
  stepShotVisible.value = true
}

/** 引导里点了「先用网页端直连」：直接在本页启动执行循环 */
function onGuardUseWeb() {
  if (!activeId.value) {
    // 还没有会话：先走新建流程，建完自动弹连接指引
    createVisible.value = true
    return
  }
  if (!workerRunning.value) toggleWebWorker()
}

onMounted(async () => {
  await loadSessions()

  /*
   * 首次进入的引导。
   *
   * 移动端每次都提示（这是硬拦截，不该被「不再提示」永久关掉），
   * PC 端只在用户没点过「不再提示」时提示一次。
   */
  if (isMobileDevice() || !isBrowserTipDismissed()) {
    pcGuardVisible.value = true
  }

  timer = window.setInterval(() => {
    if (!activeId.value) return
    // 本地会话要更勤快地刷新：既要看指令进度，也要更新「本地浏览器是否在线」
    if (!busy.value || isLocalSession.value) void refreshSteps()
  }, isLocalSession.value ? 3000 : 8000)

  // 键盘快捷键支持
  window.addEventListener('keydown', handleKeyboard)
})

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer)
  stopWebWorker()
  window.removeEventListener('keydown', handleKeyboard)
})

// 键盘快捷键处理
function handleKeyboard(e: KeyboardEvent) {
  // 只在有活动会话且不在输入框中时响应
  if (!activeId.value || busy.value) return
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

  // Ctrl/Cmd + 快捷键
  if (e.ctrlKey || e.metaKey) {
    switch (e.key) {
      case 'r': // Ctrl+R 刷新
        e.preventDefault()
        quick('reload')
        break
      case 's': // Ctrl+S 截图
        e.preventDefault()
        quick('screenshot')
        break
      case 'ArrowLeft': // Ctrl+← 后退
        e.preventDefault()
        quick('back')
        break
      case 'ArrowRight': // Ctrl+→ 前进
        e.preventDefault()
        quick('forward')
        break
    }
  }
}
</script>

<style scoped>
.browser-page {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.workbench {
  display: flex;
  flex: 1;
  gap: 14px;
  min-height: 0;
}
.sessions {
  display: flex;
  flex-direction: column;
  width: 280px;
  flex-shrink: 0;
  background: var(--cg-card-bg);
  border: 1px solid var(--cg-border);
  border-radius: var(--cg-radius);
  overflow: hidden;
}
.sessions-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  font-size: 13px;
  font-weight: 600;
  border-bottom: 1px solid var(--cg-border);
}
.sessions-list {
  flex: 1;
  padding: 8px;
  overflow-y: auto;
}
.session-item {
  position: relative;
  padding: 10px 30px 10px 12px;
  margin-bottom: 6px;
  cursor: pointer;
  border: 1px solid transparent;
  border-radius: 8px;
  transition: all 0.15s;
}
.session-item:hover {
  background: var(--cg-card-bg-soft);
}
.session-item.active {
  background: var(--cg-brand-soft);
  border-color: var(--cg-brand);
}
.si-name {
  font-size: 13.5px;
  font-weight: 500;
}
.si-url {
  margin-top: 3px;
  overflow: hidden;
  font-size: 11.5px;
  color: var(--cg-text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.si-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  font-size: 11.5px;
}
.si-close {
  position: absolute;
  top: 8px;
  right: 6px;
}
.main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  overflow-y: auto;
}
.addr-bar {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 10px 12px;
  background: var(--cg-card-bg);
  border: 1px solid var(--cg-border);
  border-radius: var(--cg-radius);
}
.addr-input {
  flex: 1;
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 12px;
  background: var(--cg-card-bg);
  border: 1px solid var(--cg-border);
  border-radius: var(--cg-radius);
}
.screen-wrap {
  background: var(--cg-card-bg);
  border: 1px solid var(--cg-border);
  border-radius: var(--cg-radius);
  overflow: hidden;
}
.screen-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 14px;
  border-bottom: 1px solid var(--cg-border);
}
.screen-title {
  font-size: 13px;
  font-weight: 500;
}
.screen-bar .mono {
  flex: 1;
  overflow: hidden;
  font-size: 11.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.screen {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 320px;
  max-height: 52vh;
  background: var(--cg-hover-bg);
  overflow: auto;
}
.screen-img {
  width: 100%;
  cursor: zoom-in;
}
.screen-empty {
  padding: 60px 20px;
  color: var(--cg-text-muted);
  text-align: center;
}
.screen-empty p {
  margin-top: 10px;
  font-size: 13px;
}
.panel {
  padding: 4px 16px 16px;
  background: var(--cg-card-bg);
  border: 1px solid var(--cg-border);
  border-radius: var(--cg-radius);
}
.action-form {
  max-width: 620px;
}
.steps {
  max-height: 46vh;
  overflow-y: auto;
}

.steps-actions {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.step {
  padding: 10px 0;
  border-bottom: 1px dashed var(--cg-border);
}
.step-head {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
}
.step-line {
  margin-top: 4px;
  font-size: 12px;
  word-break: break-all;
}
.step-error {
  margin-top: 6px;
}
.step-snapshot {
  max-height: 200px;
  padding: 10px;
  margin-top: 6px;
  overflow: auto;
  font-size: 12px;
  background: var(--cg-card-bg-soft);
  border-radius: 6px;
}
.result-body {
  max-height: 46vh;
  padding: 12px;
  overflow: auto;
  font-size: 12.5px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  background: #0f172a;
  color: #e2e8f0;
  border-radius: 8px;
}
.main-empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 80px 20px;
  color: var(--cg-text-muted);
  background: var(--cg-card-bg);
  border: 1px solid var(--cg-border);
  border-radius: var(--cg-radius);
}
.main-empty h3 {
  margin: 0;
  font-size: 16px;
  color: var(--cg-text);
}
.preview-img {
  width: 100%;
}
.field-desc {
  margin-left: 10px;
  font-size: 12px;
  color: var(--cg-text-muted);
}

@media (max-width: 1100px) {
  .workbench {
    flex-direction: column;
  }
  .sessions {
    width: 100%;
  }
  .sessions-list {
    max-height: 220px;
  }
}
</style>