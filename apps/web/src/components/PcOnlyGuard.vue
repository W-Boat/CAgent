<template>
  <el-dialog
    v-model="visible"
    :title="dialogTitle"
    :width="isNarrowScreen ? '92vw' : '560px'"
    :close-on-click-modal="!mobileBlocking"
    :show-close="!mobileBlocking"
    append-to-body
    class="pc-guard"
    @closed="onClosed"
  >
    <!-- 情况 A：移动端访问 —— 直接劝去 PC，不提供继续 -->
    <div v-if="mobileBlocking" class="pcg-body">
      <div class="pcg-icon">
        <el-icon :size="40"><Monitor /></el-icon>
      </div>
      <h3 class="pcg-title">请在电脑上使用浏览器功能</h3>
      <p class="pcg-desc">
        {{ featureName }}需要在本机浏览器里渲染页面并执行点击、填表、截图等操作。
        手机浏览器的权限与窗口尺寸都不足以完成这些动作，也无法安装桌面扩展。
      </p>

      <div class="pcg-ways">
        <div class="pcg-way">
          <el-icon class="pcg-way-icon"><Monitor /></el-icon>
          <div>
            <b>用电脑打开本站</b>
            <span>在 PC 浏览器访问同一网址，登录后即可使用</span>
          </div>
        </div>
        <div class="pcg-way">
          <el-icon class="pcg-way-icon"><DocumentCopy /></el-icon>
          <div>
            <b>先复制入口链接</b>
            <span>把链接发到电脑上再打开，办事页面本身不挑设备</span>
          </div>
        </div>
      </div>

      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="校园导览的「分步指引」在手机上依然可以正常查看，只是不提供页面画面与自动操作。"
      />
    </div>

    <!-- 情况 B：PC 但没装扩展 —— 引导安装，允许先用网页端直连 -->
    <div v-else class="pcg-body">
      <div class="pcg-icon ok">
        <el-icon :size="40"><Connection /></el-icon>
      </div>
      <h3 class="pcg-title">安装浏览器助手，能力更完整</h3>
      <p class="pcg-desc">
        不装也能用：网页端直连可以操作<strong>本站页面</strong>。
        装上扩展后额外获得三项能力：
      </p>

      <ul class="pcg-benefits">
        <li>
          <el-icon class="ok"><CircleCheckFilled /></el-icon>
          <span><b>操作任意网站</b> —— 教务、邮件、校内系统都不受同源策略限制</span>
        </li>
        <li>
          <el-icon class="ok"><CircleCheckFilled /></el-icon>
          <span><b>复用已登录会话</b> —— 你登录过的页面直接可用，无需重新输密码</span>
        </li>
        <li>
          <el-icon class="ok"><CircleCheckFilled /></el-icon>
          <span><b>截图留痕</b> —— 每步操作自动截图，后台可完整回放</span>
        </li>
      </ul>

      <div class="pcg-steps">
        <div class="pcg-step">
          <span class="pcg-step-no">1</span>
          <span>打开 <code>chrome://extensions</code>（Edge 为 <code>edge://extensions</code>）</span>
        </div>
        <div class="pcg-step">
          <span class="pcg-step-no">2</span>
          <span>右上角开启「<b>开发者模式</b>」</span>
        </div>
        <div class="pcg-step">
          <span class="pcg-step-no">3</span>
          <span>点「<b>加载已解压的扩展程序</b>」，选择项目里的 <code>apps/extension</code> 目录</span>
        </div>
        <div class="pcg-step">
          <span class="pcg-step-no">4</span>
          <span>点工具栏的 CAgent 图标，填入下方信息后连接</span>
        </div>
      </div>

      <div class="pcg-info">
        <div class="pcg-info-row">
          <span class="pcg-info-label">服务地址</span>
          <code class="pcg-info-value">{{ origin }}</code>
          <el-button text size="small" @click="copy(origin)">复制</el-button>
        </div>
        <div class="pcg-info-row">
          <span class="pcg-info-label">会话 ID</span>
          <code class="pcg-info-value">{{ sessionId || "（创建会话后生成）" }}</code>
          <el-button
            text
            size="small"
            :disabled="!sessionId"
            @click="sessionId && copy(sessionId)"
          >
            复制
          </el-button>
        </div>
        <div class="pcg-info-row">
          <span class="pcg-info-label">访问令牌</span>
          <code class="pcg-info-value">{{ tokenPreview }}</code>
          <el-button text size="small" :disabled="!token" @click="token && copy(token)">
            复制
          </el-button>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="pcg-footer">
        <el-checkbox v-if="!mobileBlocking" v-model="dontAskAgain" class="pcg-remember">
          不再提示
        </el-checkbox>
        <div class="pcg-footer-right">
          <el-button @click="visible = false">
            {{ mobileBlocking ? "知道了" : "暂不安装" }}
          </el-button>
          <el-button v-if="!mobileBlocking" type="primary" @click="onUseWeb">
            先用网页端直连
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { toastOk, tokenStore } from "@/api/client"
import { copyText } from "@/utils/format"
import {
  dismissBrowserTip,
  isMobileDevice as detectMobile
} from "@/utils/browser-tip"

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    /** 功能名，用于文案，如「浏览器操控」「校园导览画面」 */
    featureName?: string
    /** 当前会话 ID（PC 引导安装时展示，便于直接复制） */
    sessionId?: string
  }>(),
  { featureName: "浏览器功能", sessionId: "" }
)

const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void
  /** 用户选择「先用网页端直连」 */
  (e: "useWeb"): void
  (e: "closed"): void
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit("update:modelValue", v)
})

/**
 * 移动端判定：用触摸能力 + 屏幕宽度双重判断。
 *
 * 只看宽度会把「窗口拉窄的桌面浏览器」误判成移动端，
 * 那些用户其实完全可以装扩展。带 coarse 指针（手指）+ 窄屏才算。
 */
const isMobileDevice = ref(detectMobile())
const isNarrowScreen = ref(
  typeof window !== "undefined"
    ? window.matchMedia("(max-width: 900px)").matches
    : false
)

if (typeof window !== "undefined") {
  window
    .matchMedia("(max-width: 900px)")
    .addEventListener("change", (e) => (isNarrowScreen.value = e.matches))
}

/** 移动端直接拦截，不提供继续 */
const mobileBlocking = computed(() => isMobileDevice.value)

const dialogTitle = computed(() =>
  mobileBlocking.value ? "需要电脑" : `使用${props.featureName}`
)

const origin = computed(() => window.location.origin)
const token = computed(() => tokenStore.access)
const tokenPreview = computed(() => {
  const t = tokenStore.access
  if (!t) return "（未登录）"
  return t.length > 24 ? `${t.slice(0, 12)}…${t.slice(-8)}` : t
})

const dontAskAgain = ref(false)

watch(visible, (open) => {
  if (open) dontAskAgain.value = false
})

function onClosed() {
  // 移动端是硬拦截，不记「不再提示」——否则用户换到 PC 就再也看不到安装引导
  if (dontAskAgain.value && !mobileBlocking.value) dismissBrowserTip()
  emit("closed")
}

function onUseWeb() {
  if (dontAskAgain.value) dismissBrowserTip()
  visible.value = false
  emit("useWeb")
}

async function copy(text: string) {
  await copyText(text)
  toastOk("已复制")
}
</script>

<style scoped>
.pcg-body {
  text-align: center;
}

.pcg-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 68px;
  height: 68px;
  margin-bottom: 12px;
  color: var(--cg-warning-text);
  background: var(--cg-warning-soft);
  border-radius: 50%;
}

.pcg-icon.ok {
  color: var(--cg-brand);
  background: var(--cg-brand-soft);
}

.pcg-title {
  margin: 0 0 8px;
  font-size: 17px;
  font-weight: 600;
}

.pcg-desc {
  max-width: 460px;
  margin: 0 auto 16px;
  font-size: 13.5px;
  line-height: 1.75;
  color: var(--cg-text-muted);
}

.pcg-ways {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 14px;
  text-align: left;
}

.pcg-way {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 12px;
  background: var(--cg-card-bg-soft);
  border: 1px solid var(--cg-border);
  border-radius: 9px;
}

.pcg-way-icon {
  margin-top: 2px;
  font-size: 17px;
  color: var(--cg-brand);
}

.pcg-way b {
  display: block;
  margin-bottom: 2px;
  font-size: 13.5px;
}

.pcg-way span {
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--cg-text-muted);
}

.pcg-benefits {
  margin: 0 0 16px;
  padding: 0;
  list-style: none;
  text-align: left;
}

.pcg-benefits li {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 5px 0;
  font-size: 13px;
  line-height: 1.6;
}

.pcg-benefits .ok {
  margin-top: 2px;
  color: var(--cg-success-text);
}

.pcg-steps {
  padding: 12px 14px;
  margin-bottom: 14px;
  text-align: left;
  background: var(--cg-card-bg-soft);
  border: 1px solid var(--cg-border);
  border-radius: 9px;
}

.pcg-step {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 4px 0;
  font-size: 12.5px;
  line-height: 1.6;
}

.pcg-step-no {
  display: inline-flex;
  flex: 0 0 18px;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-top: 1px;
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  background: var(--cg-brand);
  border-radius: 50%;
}

.pcg-steps code {
  padding: 1px 4px;
  font-size: 11.5px;
  background: var(--cg-inline-code-bg);
  border-radius: 3px;
}

.pcg-info {
  padding: 10px 12px;
  text-align: left;
  background: var(--cg-card-bg-soft);
  border: 1px solid var(--cg-border);
  border-radius: 9px;
}

.pcg-info-row {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 3px 0;
}

.pcg-info-label {
  flex: 0 0 62px;
  font-size: 12px;
  color: var(--cg-text-muted);
}

.pcg-info-value {
  flex: 1;
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pcg-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.pcg-remember {
  font-size: 13px;
}

.pcg-footer-right {
  display: flex;
  gap: 8px;
}

@media (max-width: 640px) {
  .pcg-info-row {
    flex-wrap: wrap;
  }
  .pcg-info-value {
    flex: 1 1 100%;
  }
}
</style>
