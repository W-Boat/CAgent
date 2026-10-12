<script setup lang="ts">
/**
 * 「是否已连接校园网」询问弹窗。
 *
 * - 每次进入平台（每个浏览器标签会话）出现一次，由 stores/campus-net.ts
 *   的 sessionStorage 状态驱动；挂在 App.vue 根层，经典版/新版外壳都会经过。
 * - 样式自包含（不依赖 Element Plus / nx 令牌），在两版界面里观感一致；
 *   明暗跟随 html.dark（与 theme store 的全局约定一致）。
 * - 选择只影响**默认模型**的挑选（见 utils/skill-presets.ts 的
 *   pickDefaultModel），不锁死：对话页的选择器仍可切换任意模型。
 */
import { useCampusNetStore } from "@/stores/campus-net"

const campusNet = useCampusNetStore()
</script>

<template>
  <Teleport to="body">
    <Transition name="cn-fade">
      <div v-if="campusNet.needAsk" class="cn-mask" role="dialog" aria-modal="true" aria-label="校园网连接询问">
        <div class="cn-card">
          <div class="cn-badge">校内模型</div>
          <h2 class="cn-title">同学你好，是否已连接校园网？</h2>
          <p class="cn-text">
            以下两个模型可自行选择使用。模型仅支持在<strong>校园网环境</strong>下调用，且均为学校本地化部署。因硬件资源有限，高峰时段可能出现卡顿、延迟或排队等情况，敬请谅解。若在使用模型过程中遇到问题，可致电
            <strong>52576025</strong> 咨询。
          </p>
          <ul class="cn-models">
            <li>
              <span class="cn-model-name">step-3.7-flash</span>
              <code>http://10.27.66.12/v1</code>
            </li>
            <li>
              <span class="cn-model-name">qwen3.8-27b</span>
              <code>http://10.27.66.12/v1</code>
            </li>
          </ul>
          <p class="cn-note">
            选择「校园网」后，默认模型将优先使用校内模型；普通网络则沿用平台默认。
            之后可随时在对话页的模型选择器里切换。
          </p>
          <div class="cn-actions">
            <button type="button" class="cn-btn cn-secondary" @click="campusNet.answer(false)">
              使用普通网络
            </button>
            <button type="button" class="cn-btn cn-primary" @click="campusNet.answer(true)">
              已连接校园网，使用校内模型
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.cn-mask {
  /*
   * 强调色局部变量。弹窗 Teleport 到 <body>，在 .nx-root 作用域之外，
   * 拿不到 --nx-accent 那套派生令牌；但基准 --nx-accent-raw 是挂在 :root /
   * documentElement 上的全局变量（ui store 设置强调色时写在这里），
   * 所以这里直接从它派生，保证弹窗跟随「设置强调色」，与新旧外壳一致。
   */
  --cn-accent: var(--nx-accent-raw, #4f46e5);
  --cn-accent-soft: color-mix(in srgb, var(--cn-accent) 9%, transparent);
  --cn-accent-border: color-mix(in srgb, var(--cn-accent) 32%, transparent);
  --cn-accent-hover: color-mix(in srgb, var(--cn-accent) 86%, #14142b);

  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(15, 15, 20, 0.55);
  backdrop-filter: blur(4px);
}

/* 暗色下把基准向白色提亮一档，保证在近黑底上的对比度（与 next.css 同一口径） */
html.dark .cn-mask {
  --cn-accent: color-mix(in srgb, var(--nx-accent-raw, #4f46e5) 72%, #fff);
  --cn-accent-soft: color-mix(in srgb, var(--cn-accent) 16%, transparent);
  --cn-accent-border: color-mix(in srgb, var(--cn-accent) 42%, transparent);
  --cn-accent-hover: color-mix(in srgb, var(--cn-accent) 88%, #fff);
}

.cn-card {
  width: min(460px, 100%);
  max-height: 86vh;
  overflow-y: auto;
  padding: 26px 26px 22px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei",
    sans-serif;
  color: #18181b;
  background: #ffffff;
  border: 1px solid #e8e8ec;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
}

.cn-badge {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 10px;
  margin-bottom: 14px;
  font-size: 12px;
  font-weight: 600;
  color: var(--cn-accent);
  background: var(--cn-accent-soft);
  border: 1px solid var(--cn-accent-border);
  border-radius: 999px;
}

.cn-title {
  margin: 0 0 10px;
  font-size: 18px;
  font-weight: 650;
  letter-spacing: -0.01em;
}

.cn-text {
  margin: 0 0 14px;
  font-size: 13.5px;
  line-height: 1.8;
  color: #55555e;
}

.cn-text strong {
  color: #18181b;
}

.cn-models {
  margin: 0 0 14px;
  padding: 10px 14px;
  list-style: none;
  background: #f7f7f8;
  border: 1px solid #e8e8ec;
  border-radius: 10px;
}

.cn-models li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 4px 0;
  font-size: 13px;
}

.cn-models li + li {
  border-top: 1px dashed #e8e8ec;
}

.cn-model-name {
  font-weight: 600;
}

.cn-models code {
  font-size: 11.5px;
  color: #8e8e99;
  font-family: ui-monospace, Consolas, monospace;
}

.cn-note {
  margin: 0 0 18px;
  font-size: 12px;
  line-height: 1.7;
  color: #8e8e99;
}

.cn-actions {
  display: flex;
  gap: 10px;
}

.cn-btn {
  flex: 1;
  height: 38px;
  font-size: 13.5px;
  font-weight: 550;
  cursor: pointer;
  border-radius: 8px;
  transition: all 0.15s ease;
}

.cn-secondary {
  color: #55555e;
  background: #ffffff;
  border: 1px solid #d9d9e0;
}

.cn-secondary:hover {
  background: #f4f4f5;
}

.cn-primary {
  color: var(--platform-on-accent, #ffffff);
  background: var(--cn-accent);
  border: 1px solid var(--cn-accent);
}

.cn-primary:hover {
  background: var(--cn-accent-hover);
}

/* 暗色跟随全局约定 */
html.dark .cn-card {
  color: #f2f2f4;
  background: #1a1a1f;
  border-color: #26262d;
}

html.dark .cn-text {
  color: #a6a6b0;
}

html.dark .cn-text strong {
  color: #f2f2f4;
}

html.dark .cn-models {
  background: #16161a;
  border-color: #26262d;
}

html.dark .cn-models li + li {
  border-color: #26262d;
}

html.dark .cn-models code {
  color: #6e6e79;
}

html.dark .cn-note {
  color: #6e6e79;
}

html.dark .cn-secondary {
  color: #a6a6b0;
  background: #1a1a1f;
  border-color: #34343d;
}

html.dark .cn-secondary:hover {
  background: #232329;
}

.cn-fade-enter-active,
.cn-fade-leave-active {
  transition: opacity 0.2s ease;
}

.cn-fade-enter-from,
.cn-fade-leave-to {
  opacity: 0;
}
</style>
