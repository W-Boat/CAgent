<template>
  <div class="boot-splash" :class="{ 'is-error': state === 'error' }" role="status" aria-live="polite">
    <!--
      图标只用内联 SVG，不用 el-icon / el-button。
      启动失败可能发生在 Element Plus 的按需样式尚未加载时，
      那一刻依赖组件库会渲染成没有样式的裸元素，比不用还难看。
    -->
    <div class="boot-logo">
      <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path
          d="M32 8c-13.8 0-25 9.6-25 21.4 0 6.9 3.8 13 9.7 16.9-.4 3.1-1.7 6-3.9 8.4a1.2 1.2 0 0 0 1 2c4.7-.4 8.9-2.2 12.1-4.7 2 .4 4 .6 6.1.6 13.8 0 25-9.6 25-21.4S45.8 8 32 8Z"
          fill="currentColor"
        />
        <circle cx="32" cy="29.4" r="8.6" fill="none" stroke="#fff" stroke-width="4.2" />
        <circle cx="32" cy="29.4" r="3" fill="#fff" />
        <circle cx="17.5" cy="29.4" r="2.6" fill="#fff" opacity="0.55" />
        <circle cx="46.5" cy="29.4" r="2.6" fill="#fff" opacity="0.55" />
      </svg>

      <!-- 失败时在 logo 右下角叠一个小警示角标，而不是另起一个大图标 -->
      <span v-if="state === 'error'" class="boot-badge" aria-hidden="true">
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M12 2 1.5 20.5h21L12 2Zm0 6a1.2 1.2 0 0 1 1.2 1.2v5.2a1.2 1.2 0 0 1-2.4 0V9.2A1.2 1.2 0 0 1 12 8Zm0 10.2a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6Z"
            fill="currentColor"
          />
        </svg>
      </span>
    </div>

    <!-- 正常 / 偏慢：转圈 + 文案 -->
    <template v-if="state !== 'error'">
      <div class="boot-spinner" aria-hidden="true"></div>
      <p class="boot-text">
        {{ state === "slow" ? "网络较慢，正在继续加载…" : "正在加载 CAgent…" }}
      </p>
      <p v-if="state === 'slow'" class="boot-hint">
        已等待 {{ seconds }} 秒。若长时间无响应，可
        <button type="button" class="boot-link" @click="reload">刷新重试</button>
      </p>
    </template>

    <!-- 失败：明确告知并可重试 -->
    <template v-else>
      <h2 class="boot-title">加载失败</h2>
      <p class="boot-text">
        无法连接到服务，或页面资源加载被中断。已等待 {{ seconds }} 秒。
      </p>
      <div class="boot-actions">
        <button type="button" class="boot-btn primary" @click="reload">重新加载</button>
        <button type="button" class="boot-btn" @click="goLogin">先去登录页</button>
      </div>
      <p class="boot-hint">若反复失败，请检查网络连接，或稍后再试。</p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import { bootState, reloadApp, waitedSeconds } from "@/utils/boot"

const state = computed(() => bootState.value)

/**
 * 已等待秒数。
 *
 * 只在 slow / error 阶段才需要显示，用一个低频计时器刷新即可；
 * 进入就绪状态后立刻停掉，避免无谓的重渲染。
 */
const seconds = ref(waitedSeconds())
let timer: number | undefined

onMounted(() => {
  timer = window.setInterval(() => {
    seconds.value = waitedSeconds()
  }, 1000)
})

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer)
})

function reload() {
  reloadApp()
}

/**
 * 兜底入口：万一卡在鉴权守卫上，直接去登录页往往能绕开。
 * 用整页跳转而不是 router.push —— 此刻路由可能处于半初始化状态。
 */
function goLogin() {
  window.location.href = "/login"
}
</script>

<style scoped>
/*
 * 铺满视口且不参与滚动，避免占位期间页面出现滚动条或内容穿透。
 * 用 dvh 跟随移动端地址栏伸缩（vh 在部分浏览器会算高，导致底部露白）。
 */
.boot-splash {
  position: fixed;
  inset: 0;
  z-index: 4000;
  display: flex;
  flex-direction: column;
  gap: 14px;
  align-items: center;
  justify-content: center;
  padding: 24px;
  text-align: center;
  background: var(--cg-page-bg);
  color: var(--cg-text-muted);
}

.boot-logo {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  color: var(--cg-brand);
}

.boot-logo svg {
  width: 52px;
  height: 52px;
}

/* 失败态：logo 转为警示色 + 右下角角标，避免再堆一个大图标 */
.boot-splash.is-error .boot-logo {
  color: var(--cg-text-muted);
}

.boot-badge {
  position: absolute;
  right: 2px;
  bottom: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  color: var(--cg-warning-text);
  background: var(--cg-warning-soft);
  border: 2px solid var(--cg-page-bg);
  border-radius: 50%;
}

.boot-badge svg {
  width: 15px;
  height: 15px;
}

.boot-spinner {
  width: 28px;
  height: 28px;
  border: 3px solid var(--cg-border);
  border-top-color: var(--cg-brand);
  border-radius: 50%;
  animation: boot-spin 0.9s linear infinite;
}

@keyframes boot-spin {
  to {
    transform: rotate(360deg);
  }
}

.boot-text {
  max-width: 30em;
  margin: 0;
  font-size: 13.5px;
  line-height: 1.7;
}

.boot-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  color: var(--cg-text);
}

.boot-hint {
  max-width: 30em;
  margin: 0;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--cg-text-muted);
}

.boot-link {
  padding: 0;
  font: inherit;
  color: var(--cg-brand);
  cursor: pointer;
  background: none;
  border: 0;
  text-decoration: underline;
}

.boot-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: center;
  margin-top: 2px;
}

/* 按钮用原生写法：启动失败时组件库样式可能还没到位 */
.boot-btn {
  padding: 9px 18px;
  font-family: inherit;
  font-size: 13.5px;
  color: var(--cg-text-secondary);
  cursor: pointer;
  background: var(--cg-card-bg);
  border: 1px solid var(--cg-border-strong);
  border-radius: 8px;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.boot-btn:hover {
  background: var(--cg-hover-bg);
}

.boot-btn.primary {
  color: #fff;
  background: var(--cg-brand);
  border-color: var(--cg-brand);
}

.boot-btn.primary:hover {
  background: var(--cg-brand-strong);
  border-color: var(--cg-brand-strong);
}

/* 尊重「减少动态效果」：转圈减速而不是完全停住（停住会像卡死） */
@media (prefers-reduced-motion: reduce) {
  .boot-spinner {
    animation-duration: 2.4s;
  }
}
</style>
