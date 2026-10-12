<script setup lang="ts">
/**
 * 注册页（新版）。行为与经典版 RegisterView 一致，只换新版设计系统皮肤。
 * 令牌与共享原语见 styles/next.css；暗色由 html.dark 自动生效，此处不感知主题。
 */
import { onMounted, reactive, ref } from "vue"
import { useRouter } from "vue-router"
import { useAuthStore } from "@/stores/auth"
import { errorMessage } from "@/api/client"
import AuthBrand from "@/components/AuthBrand.vue"

defineOptions({ name: "register" })

const auth = useAuthStore()
const router = useRouter()

const errorText = ref("")
const showPwd = ref(false)
const showConfirm = ref(false)

const form = reactive({
  name: "",
  email: "",
  department: "",
  studentNo: "",
  password: "",
  confirm: ""
})

/** 参与校验的字段错误，空串表示无错；院系/学号为选填不校验 */
const errors = reactive({ name: "", email: "", password: "", confirm: "" })

/* 与经典版 async-validator 的 email 规则对齐（HTML5 邮箱模式，保证两端判定一致） */
const EMAIL_RE =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i

type FieldKey = keyof typeof errors

const CHECKERS: Record<FieldKey, () => string> = {
  name: () => (form.name.trim() ? "" : "请输入姓名"),
  email: () => {
    const v = form.email.trim()
    if (!v) return "请输入邮箱"
    if (!EMAIL_RE.test(v)) return "邮箱格式不正确"
    return ""
  },
  password: () => {
    if (!form.password) return "请输入密码"
    if (form.password.length < 6) return "密码至少 6 位"
    return ""
  },
  confirm: () => {
    if (!form.confirm) return "请再次输入密码"
    if (form.confirm !== form.password) return "两次输入的密码不一致"
    return ""
  }
}

/* 失焦校验单字段，对应经典版 rules 的 trigger: "blur" */
function validateField(key: FieldKey) {
  errors[key] = CHECKERS[key]()
}

/** 提交前全量校验，任一字段有错则不发起请求 */
function validateAll(): boolean {
  let ok = true
  for (const key of Object.keys(CHECKERS) as FieldKey[]) {
    errors[key] = CHECKERS[key]()
    if (errors[key]) ok = false
  }
  return ok
}

async function submit() {
  /* loading 期间拦截重复提交（Enter 原生提交与按钮点击可能双触发） */
  if (auth.loading) return
  errorText.value = ""
  if (!validateAll()) return

  try {
    await auth.register({
      email: form.email.trim(),
      password: form.password,
      name: form.name.trim(),
      department: form.department || undefined,
      studentNo: form.studentNo || undefined
    })
    ElMessage.success("注册成功，欢迎加入")
    await router.replace(auth.homePath)
  } catch (error) {
    errorText.value = errorMessage(error)
  }
}

onMounted(async () => {
  await auth.loadPublicSettings()
  if (auth.settings && !auth.settings.allow_registration) {
    ElMessage.warning("系统当前已关闭注册，请联系管理员开通账号")
  }
})
</script>

<template>
  <div class="nx-root auth-page">
    <main class="auth-card">
      <AuthBrand :title="auth.siteName"/>

      <h2 class="form-title">创建账号</h2>
      <p class="form-sub nx-muted">填写校园信息，注册后即可使用智能对话与技能中心</p>

      <!-- novalidate：校验由行内红字负责，不用浏览器原生气泡 -->
      <form class="form" novalidate @submit.prevent="submit">
        <div class="field">
          <label class="field-label nx-muted" for="reg-name">姓名</label>
          <input
            id="reg-name"
            v-model="form.name"
            class="nx-input"
            :class="{ 'is-invalid': errors.name }"
            type="text"
            placeholder="请输入真实姓名"
            autocomplete="name"
            :aria-invalid="Boolean(errors.name)"
            @blur="validateField('name')"
          />
          <p v-if="errors.name" class="field-error">{{ errors.name }}</p>
        </div>

        <div class="field">
          <label class="field-label nx-muted" for="reg-email">邮箱</label>
          <input
            id="reg-email"
            v-model="form.email"
            class="nx-input"
            :class="{ 'is-invalid': errors.email }"
            type="email"
            placeholder="you@campus.edu"
            autocomplete="email"
            :aria-invalid="Boolean(errors.email)"
            @blur="validateField('email')"
          />
          <p v-if="errors.email" class="field-error">{{ errors.email }}</p>
        </div>

        <div class="field-grid">
          <div class="field">
            <label class="field-label nx-muted" for="reg-department">院系（选填）</label>
            <input
              id="reg-department"
              v-model="form.department"
              class="nx-input"
              type="text"
              placeholder="如：计算机学院"
            />
          </div>
          <div class="field">
            <label class="field-label nx-muted" for="reg-student-no">学号（选填）</label>
            <input
              id="reg-student-no"
              v-model="form.studentNo"
              class="nx-input"
              type="text"
              placeholder="如：2023010101"
            />
          </div>
        </div>

        <div class="field">
          <label class="field-label nx-muted" for="reg-password">密码</label>
          <div class="pwd-wrap">
            <input
              id="reg-password"
              v-model="form.password"
              class="nx-input pwd-input"
              :class="{ 'is-invalid': errors.password }"
              :type="showPwd ? 'text' : 'password'"
              placeholder="至少 6 位"
              autocomplete="new-password"
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
          <p v-if="errors.password" class="field-error">{{ errors.password }}</p>
        </div>

        <div class="field">
          <label class="field-label nx-muted" for="reg-confirm">确认密码</label>
          <div class="pwd-wrap">
            <input
              id="reg-confirm"
              v-model="form.confirm"
              class="nx-input pwd-input"
              :class="{ 'is-invalid': errors.confirm }"
              :type="showConfirm ? 'text' : 'password'"
              placeholder="再次输入密码"
              autocomplete="new-password"
              :aria-invalid="Boolean(errors.confirm)"
              @blur="validateField('confirm')"
            />
            <button
              type="button"
              class="nx-icon-btn pwd-toggle"
              :class="{ 'is-on': showConfirm }"
              :aria-label="showConfirm ? '隐藏密码' : '显示密码'"
              :aria-pressed="showConfirm"
              @click="showConfirm = !showConfirm"
            >
              <svg
                v-if="showConfirm"
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
          <p v-if="errors.confirm" class="field-error">{{ errors.confirm }}</p>
        </div>

        <p v-if="errorText" class="form-error" role="alert">{{ errorText }}</p>

        <button type="submit" class="nx-btn nx-btn-primary nx-btn-block submit" :disabled="auth.loading">
          {{ auth.loading ? "正在注册…" : "注册" }}
        </button>
      </form>

      <p class="foot nx-muted">
        已有账号？
        <router-link class="nx-link-btn" to="/login">返回登录</router-link>
      </p>
    </main>
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
 * margin:auto 居中：注册表单比一屏高时也不会像 align-items:center
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

/* 院系/学号并排；手机端收成单列 */
.field-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
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

  .field-grid {
    grid-template-columns: 1fr;
    gap: 0;
  }
}
</style>
