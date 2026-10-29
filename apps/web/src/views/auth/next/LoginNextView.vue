<script setup lang="ts">
/**
 * 登录页（新版）。行为与经典版 LoginView 一致，只换新版设计系统皮肤。
 * 令牌与共享原语见 styles/next.css；暗色由 html.dark 自动生效，此处不感知主题。
 */
import { computed, reactive, ref } from "vue"
import { useRoute, useRouter } from "vue-router"
import { useAuthStore } from "@/stores/auth"
import { errorMessage } from "@/api/client"
import { safeAuthRedirect } from "@/utils/auth-redirect"
import AuthBrand from '@/components/AuthBrand.vue'

defineOptions({ name: "login" })

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const errorText = ref("")
const showPwd = ref(false)

/*
 * 表单初值：开发环境预填管理员账号，省去每次手输；
 * 生产环境必须留空 —— 否则默认管理员密码会被打进线上 JS 包，
 * 任何人查看源码即可拿到后台凭据。
 */
const form = reactive({
  email: import.meta.env.DEV ? "admin@cagent.local" : "",
  password: import.meta.env.DEV ? "CHANGE_ME_SEED_ADMIN_PASSWORD" : ""
})

/** 各字段校验错误，空串表示无错 */
const errors = reactive({ email: "", password: "" })

/* 与经典版 async-validator 的 email 规则对齐（HTML5 邮箱模式，保证两端判定一致） */
const EMAIL_RE =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i

function checkEmail(value: string): string {
  const v = value.trim()
  if (!v) return "请输入邮箱"
  if (!EMAIL_RE.test(v)) return "邮箱格式不正确"
  return ""
}

function checkPassword(value: string): string {
  if (!value) return "请输入密码"
  if (value.length < 6) return "密码至少 6 位"
  return ""
}

/* 失焦校验单字段，对应经典版 rules 的 trigger: "blur" */
function validateField(key: "email" | "password") {
  errors[key] = key === "email" ? checkEmail(form.email) : checkPassword(form.password)
}

/** 提交前全量校验，任一字段有错则不发起请求 */
function validateAll(): boolean {
  errors.email = checkEmail(form.email)
  errors.password = checkPassword(form.password)
  return !errors.email && !errors.password
}

/**
 * 演示账号：只在开发环境存在。
 *
 * 这里用 `import.meta.env.DEV` 求值而不是仅在模板里 v-if——
 * 后者只是「不渲染」，凭据字符串仍会被打进生产包。加上 DEV
 * 判断后，生产构建时整个字面量会被常量折叠掉。
 */
const demoAccounts = import.meta.env.DEV
  ? [
      { label: "超管", email: "admin@cagent.local", password: "CHANGE_ME_SEED_ADMIN_PASSWORD" },
      { label: "教师", email: "teacher@cagent.local", password: "User@123456" },
      { label: "学生", email: "student@cagent.local", password: "User@123456" }
    ]
  : []

const showDemo = computed(() => import.meta.env.DEV && demoAccounts.length > 0)

function fillDemo(acc: { email: string; password: string }) {
  form.email = acc.email
  form.password = acc.password
  errors.email = ""
  errors.password = ""
}

async function submit() {
  /* loading 期间拦截重复提交（Enter 原生提交与按钮点击可能双触发） */
  if (auth.loading) return
  errorText.value = ""
  if (!validateAll()) {
    document.getElementById(errors.email ? 'login-email' : 'login-password')?.focus()
    return
  }

  try {
    await auth.login({ email: form.email.trim(), password: form.password })
    ElMessage.success("登录成功")
    const redirect = safeAuthRedirect(route.query.redirect, auth.homePath, window.location.origin)
    await router.replace(redirect)
  } catch (error) {
    errorText.value = errorMessage(error)
  }
}

function onEdit(key: "email" | "password") {
  errorText.value = ''
  if (errors[key]) validateField(key)
}
</script>

<template>
  <div class="nx-root auth-page">
    <div class="auth-shell">
    <aside class="auth-intro" aria-labelledby="login-intro-title">
      <h2 id="login-intro-title">校园里的问题，<br/>从这里开始。</h2>
    </aside>
    <main class="auth-card">
      <AuthBrand :title="auth.siteName"/>

      <h2 class="form-title">欢迎回来</h2>
      <p class="form-sub nx-muted">使用已注册邮箱登录，继续你的校园对话</p>

      <!-- novalidate：校验由行内红字负责，不用浏览器原生气泡 -->
      <form class="form" novalidate @submit.prevent="submit">
        <div class="field">
          <label class="field-label nx-muted" for="login-email">邮箱</label>
          <input
            id="login-email"
            v-model="form.email"
            class="nx-input"
            :class="{ 'is-invalid': errors.email }"
            type="email"
            placeholder="请输入登录邮箱"
            inputmode="email" autocapitalize="none" :spellcheck="false" maxlength="254"
            :disabled="auth.loading" :aria-describedby="errors.email ? 'login-email-error' : undefined"
            @input="onEdit('email')"
            autocomplete="email"
            :aria-invalid="Boolean(errors.email)"
            @blur="validateField('email')"
          />
          <p v-if="errors.email" id="login-email-error" class="field-error" role="alert">{{ errors.email }}</p>
        </div>

        <div class="field">
          <label class="field-label nx-muted" for="login-password">密码</label>
          <div class="pwd-wrap">
            <input
              id="login-password"
              v-model="form.password"
              class="nx-input pwd-input"
              :class="{ 'is-invalid': errors.password }"
              :type="showPwd ? 'text' : 'password'"
              placeholder="请输入密码"
              autocomplete="current-password"
              :disabled="auth.loading" :aria-describedby="errors.password ? 'login-password-error' : undefined"
              @input="onEdit('password')"
              :aria-invalid="Boolean(errors.password)"
              @blur="validateField('password')"
            />
            <button
              type="button"
              class="nx-icon-btn pwd-toggle"
              :class="{ 'is-on': showPwd }"
              :aria-label="showPwd ? '隐藏密码' : '显示密码'"
              :aria-pressed="showPwd"
              @click="showPwd = !showPwd"
            >
              <svg
                v-if="showPwd"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
              <svg
                v-else
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          </div>
          <p v-if="errors.password" id="login-password-error" class="field-error" role="alert">{{ errors.password }}</p>
        </div>

        <p v-if="errorText" class="form-error" role="alert">{{ errorText }}</p>

        <button type="submit" class="nx-btn nx-btn-primary nx-btn-block submit" :disabled="auth.loading">
          {{ auth.loading ? "正在登录…" : "登录" }}
        </button>
      </form>

      <p v-if="auth.settings?.allow_registration" class="foot nx-muted">
        还没有账号？
        <router-link class="nx-link-btn" to="/register">立即注册</router-link>
      </p>

      <template v-if="showDemo">
        <p class="demo-title nx-muted">演示账号（点击填入）</p>
        <div class="demo-list">
          <button
            v-for="acc in demoAccounts"
            :key="acc.email"
            type="button"
            class="demo-card"
            :class="{ 'is-on': form.email === acc.email }"
            @click="fillDemo(acc)"
          >
            <span class="demo-role">{{ acc.label }}</span>
            <span class="demo-email">{{ acc.email }}</span>
          </button>
        </div>
      </template>
    </main>
    </div>
  </div>
</template>

<style scoped>
.auth-page {
  position: relative;
  display: flex;
  /* dvh 跟随移动端地址栏伸缩；vh 作老浏览器兜底 */
  min-height: 100vh;
  min-height: 100dvh;
  padding: 40px 16px;
  background: var(--nx-bg);
}

/* 极淡的靛蓝光晕：从强调色令牌 mix 出来，明暗主题都自动克制 */
.auth-page::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(
      560px 380px at 50% -10%,
      color-mix(in srgb, var(--nx-accent) 9%, transparent),
      transparent 72%
    ),
    radial-gradient(
      520px 360px at 92% 112%,
      color-mix(in srgb, var(--nx-accent) 6%, transparent),
      transparent 72%
    );
}

/*
 * margin:auto 居中：内容比一屏高时也不会像 align-items:center
 * 那样把顶部裁掉（矮视口下自然贴顶并可随页面滚动）
 */
.auth-card {
  position: relative;
  width: 100%;
  max-width: 400px;
  margin: auto;
  padding: 30px 28px 24px;
  background:transparent;
  border:0;
  border-radius:0;
  box-shadow:none;
}

/* ---------- 表单 ---------- */

.form-title {
  margin: 0 0 4px;
  font-size: 17px;
  font-weight: 600;
  color: var(--nx-text);
}

.form-sub {
  margin: 0 0 20px;
}

.field {
  margin-bottom: 14px;
}

.field-label {
  display: block;
  margin-bottom: 6px;
}

/* 密码框：右侧内嵌可见性切换，输入文字避让按钮 */
.pwd-wrap {
  position: relative;
}

.pwd-input {
  padding-right: 36px;
}

.pwd-toggle {
  position: absolute;
  top: 50%;
  right: 3px;
  transform: translateY(-50%);
}

/* 校验失败：红边常驻，聚焦也保持红色提示 */
.field .nx-input.is-invalid {
  border-color: var(--nx-danger);
}

.field .nx-input.is-invalid:focus {
  border-color: var(--nx-danger);
  box-shadow: 0 0 0 3px var(--nx-danger-soft);
}

.field-error {
  margin: 6px 0 0;
  font-size: 12.5px;
  color: var(--nx-danger);
}

/* 服务端错误：行内红条，不用弹窗 */
.form-error {
  margin: 2px 0 12px;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--nx-danger);
  background: var(--nx-danger-soft);
  border-radius: var(--nx-radius-sm);
}

.submit {
  margin-top: 4px;
}

.foot {
  margin: 18px 0 0;
  text-align: center;
}

/* ---------- 演示账号（仅 DEV 渲染） ---------- */

.demo-title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 22px 0 10px;
}

/* 两侧发丝线把标题衬成分隔带 */
.demo-title::before,
.demo-title::after {
  content: "";
  flex: 1;
  height: 1px;
  background: var(--nx-border);
}

.demo-list {
  display: flex;
  gap: 8px;
}

.demo-card {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  padding: 8px 10px;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  background: var(--nx-surface-2);
  border: 1px solid var(--nx-border);
  border-radius: var(--nx-radius-sm);
  transition: background 0.15s ease, border-color 0.15s ease;
}

.demo-card:hover {
  background: var(--nx-surface-hover);
  border-color: var(--nx-border-strong);
}

.demo-card.is-on {
  background: var(--nx-accent-soft);
  border-color: var(--nx-accent-border);
}

.demo-role {
  font-size: 12px;
  font-weight: 600;
  color: var(--nx-text-2);
}

.demo-card.is-on .demo-role {
  color: var(--nx-accent);
}

.demo-email {
  overflow: hidden;
  font-size: 11.5px;
  color: var(--nx-text-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---------- 手机：去边框、贴边距 ---------- */

@media (max-width: 480px) {
  .auth-page {
    padding: 20px 16px;
  }

  .auth-card {
    padding: 22px 4px;
    background:transparent;
    border:0;
    border-radius:0;
    box-shadow:none;
  }

  .demo-list {
    flex-direction: column;
  }
}
</style>

<style scoped>
.auth-shell{position:relative;display:grid;grid-template-columns:minmax(0,1fr) 400px;gap:72px;width:100%;max-width:1060px;margin:auto;align-items:center}.auth-intro{container-type:inline-size;padding:24px 0;color:var(--nx-text)}.auth-intro h2{font-size:clamp(38px,calc(10vw - 47px),72px);font-size:clamp(38px,12cqw,72px);line-height:1.35;font-weight:600;letter-spacing:0;margin:0}.auth-card{background:transparent;border:0;border-radius:0;padding:34px 30px;box-shadow:none}.auth-page{padding:48px 32px}.brand-sub{line-height:1.7}.form-title{font-size:22px}.form-sub{line-height:1.7;font-size:13px}.form .nx-input{min-height:46px}.submit{min-height:46px}.pwd-toggle{min-width:40px;min-height:40px}@media(max-width:850px){.auth-shell{grid-template-columns:1fr;max-width:420px;gap:0}.auth-intro{display:none}.auth-page{padding:24px 16px}.auth-card{padding:28px 24px}}@media(max-width:380px){.auth-card{padding:24px 18px}}
</style>
