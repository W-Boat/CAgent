<template>
  <!--
    一张卡片；未知类型退化为可读提示而不是空白。

    ⚠️ 卡片类型用 data-card 属性表达，不用 mc-<类型> class。
    原先写成 class="mc mc-crisis"，而内部排版容器本身也叫 .mc-crisis
    （还有 mc-guide / mc-steps / mc-poem / mc-article 同理），
    于是 document.querySelector('.mc-crisis') 会命中两个节点 ——
    测试断言「恰好 1 张求助卡」直接失败，样式选择器也容易误伤。
    类型是**元数据**不是样式钩子，放 data-* 上既消除歧义，
    也让测试可以稳定地按类型定位。
  -->
  <div class="mc" :data-card="type">
    <!-- ══════════ options 交互式选项卡 ══════════ -->
    <CampusEffectCard v-if="type==='effect'" :card="card" :auto-play="autoPlay" :effect-key="effectKey"/>
    <CampusMapCard v-else-if="type==='map'" :card="card"/>
    <DinnerCard v-else-if="type==='dinner'" :card="card" :disabled="disabled" @ask="ask"/>
    <TakeoutCard v-else-if="type==='takeout'" :card="card" :disabled="disabled" @ask="ask"/>
    <CareCard v-else-if="type==='care' || type==='comfort'" :card="card" :disabled="disabled" @ask="ask"/>
    <PlaceCard v-else-if="type==='places'" :card="card" :disabled="disabled" @ask="ask"/>
    <AnswerLayoutCard v-else-if="['sections','reading','faq','notice'].includes(type)" :card="card"/>
    <KnowledgeCard v-else-if="['facts','compare','timeline','checklist','sources'].includes(type)" :card="card"/>
    <template v-else-if="type === 'options'">
      <div class="mc-head">
        <span class="mc-kind">请选择</span>
        <h4 class="mc-title">{{ data.title || "你想选哪个" }}</h4>
        <p v-if="data.intro" class="mc-intro">{{ data.intro }}</p>
      </div>

      <ul class="mc-opt-list">
        <li v-for="(opt, i) in options" :key="i">
          <!--
            用 label 包 input，点整行都能勾选；
            键盘 Tab 也能走到每一项（原生 radio/checkbox 自带焦点环）。
          -->
          <label class="mc-opt" :class="{ 'is-on': isChecked(i) }">
            <input
              :type="data.multiple ? 'checkbox' : 'radio'"
              name="mc-options"
              class="mc-native"
              :checked="isChecked(i)"
              :disabled="locked"
              @change="toggle(i)"
            />
            <span class="mc-mark" aria-hidden="true"></span>
            <span class="mc-opt-body">
              <span class="mc-opt-label">{{ opt.label }}</span>
              <span v-if="opt.desc" class="mc-opt-desc">{{ opt.desc }}</span>
            </span>
            <span v-if="opt.hint" class="mc-opt-hint">{{ opt.hint }}</span>
          </label>
        </li>
      </ul>

      <div class="mc-foot">
        <span v-if="locked" class="mc-sent">已发送 ✓</span>
        <button
          v-else
          type="button"
          class="mc-submit"
          :disabled="!picked.size"
          @click="submitOptions"
        >
          {{ data.submitText || "确定" }}
          <span v-if="data.multiple && picked.size" class="mc-count">{{ picked.size }}</span>
        </button>
      </div>
    </template>

    <!-- ══════════ guide 引导式入口链接卡 ══════════ -->
    <template v-else-if="type === 'guide'">
      <div class="mc-head">
        <span class="mc-kind">下一步</span>
        <h4 class="mc-title">{{ data.title || "你可以" }}</h4>
        <p v-if="data.intro" class="mc-intro">{{ data.intro }}</p>
      </div>

      <div class="mc-guide-list">
        <component
          :is="item.url ? 'a' : 'button'"
          v-for="(item, i) in guideItems"
          :key="i"
          class="mc-guide"
          :class="{ 'is-link': !!item.url }"
          :type="item.url ? undefined : 'button'"
          :href="item.url || undefined"
          :target="item.url ? '_blank' : undefined"
          :rel="item.url ? 'noopener noreferrer' : undefined"
          @click="item.url ? undefined : ask(item.action || item.label)"
        >
          <span class="mc-guide-main">
            <span class="mc-guide-label">{{ item.label }}</span>
            <span v-if="item.desc" class="mc-guide-desc">{{ item.desc }}</span>
            <span v-if="item.meta" class="mc-guide-meta">{{ item.meta }}</span>
            <span v-if="item.host" class="mc-guide-host">{{ item.host }}</span>
          </span>
          <span class="mc-guide-arrow" aria-hidden="true">
            <!-- 外链用「跳出」图标，站内追问用箭头：一眼分清点了是打开网页还是继续对话 -->
            <svg v-if="item.url" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M7 17 17 7M9 7h8v8" />
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </span>
        </component>
      </div>
    </template>

    <!-- ══════════ steps 步骤卡 ══════════ -->
    <template v-else-if="type === 'steps'">
      <div class="mc-head">
        <span class="mc-kind">办理步骤</span>
        <h4 class="mc-title">{{ data.title || "操作步骤" }}</h4>
        <p v-if="data.note" class="mc-note">{{ data.note }}</p>
      </div>

      <ol class="mc-steps">
        <li
          v-for="(s, i) in steps"
          :key="i"
          class="mc-step"
          :class="{ 'is-done': doneSet.has(i) }"
        >
          <button
            type="button"
            class="mc-step-check"
            :aria-pressed="doneSet.has(i)"
            :aria-label="`标记第 ${i + 1} 步${doneSet.has(i) ? '（已完成）' : ''}`"
            @click="toggleStep(i)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <path d="m5 13 4 4L19 7" />
            </svg>
          </button>
          <span class="mc-step-idx" aria-hidden="true">{{ i + 1 }}</span>
          <span class="mc-step-body">
            <span class="mc-step-title">{{ s.title }}</span>
            <span v-if="s.desc" class="mc-step-desc">{{ s.desc }}</span>
          </span>
        </li>
      </ol>

      <div v-if="steps.length" class="mc-progress">
        <span class="mc-progress-bar">
          <span class="mc-progress-fill" :style="{ width: progressPct + '%' }"></span>
        </span>
        <span class="mc-progress-text">{{ doneSet.size }}/{{ steps.length }}</span>
      </div>
    </template>

    <!-- ══════════ poem 特殊排版卡（竖排 / 章草气息）══════════ -->
    <template v-else-if="type === 'poem'">
      <div class="mc-poem" :class="{ 'is-vertical': data.vertical }">
        <div v-if="data.title" class="mc-poem-title">{{ data.title }}</div>
        <div class="mc-poem-body">
          <span v-for="(line, i) in poemLines" :key="i" class="mc-poem-line">{{ line }}</span>
        </div>
        <div class="mc-poem-foot">
          <span v-if="data.author" class="mc-poem-author">{{ data.author }}</span>
          <!-- 落款小印：朱砂方印，与站印同一语言，但更小更淡 -->
          <span v-if="data.seal || data.author" class="mc-poem-seal" aria-hidden="true">
            {{ data.seal || "印" }}
          </span>
        </div>
      </div>
    </template>

    <!-- ══════════ article 内嵌文章卡 ══════════ -->
    <template v-else-if="type === 'article'">
      <article class="mc-article">
        <header class="mc-art-head">
          <span v-if="data.kicker" class="mc-art-kicker">{{ data.kicker }}</span>
          <h4 class="mc-art-title">{{ data.title || "正文" }}</h4>
          <p v-if="data.lead" class="mc-art-lead">{{ data.lead }}</p>
        </header>

        <div v-for="(sec, i) in sections" :key="i" class="mc-art-sec">
          <h5 v-if="sec.heading" class="mc-art-heading">{{ sec.heading }}</h5>
          <p v-for="(p, j) in sec.paragraphs" :key="`p${j}`" class="mc-art-para">{{ p }}</p>
          <blockquote v-if="sec.quote" class="mc-art-quote">{{ sec.quote }}</blockquote>
          <ul v-if="sec.list?.length" class="mc-art-list">
            <li v-for="(li, k) in sec.list" :key="`l${k}`">{{ li }}</li>
          </ul>
        </div>

        <footer v-if="data.footer" class="mc-art-foot">{{ data.footer }}</footer>
      </article>
    </template>

    <!-- ══════════ agents Skill / Agent 切换引导卡 ══════════ -->
    <template v-else-if="type === 'agents'">
      <div class="mc-head">
        <span class="mc-kind">换个助手</span>
        <h4 class="mc-title">{{ data.title || "交给它更合适" }}</h4>
        <p v-if="data.reason" class="mc-intro">{{ data.reason }}</p>
      </div>

      <div class="mc-switch-list">
        <button
          v-for="(a, i) in switchAgents"
          :key="`a${i}`"
          type="button"
          class="mc-switch"
          @click="chooseAgent(a)"
        >
          <span class="mc-switch-avatar">{{ (a.name || "?").slice(0, 1) }}</span>
          <span class="mc-switch-body">
            <span class="mc-switch-name">{{ a.name }}</span>
            <span v-if="a.desc" class="mc-switch-desc">{{ a.desc }}</span>
          </span>
          <span class="mc-switch-cta">切换</span>
        </button>

        <button
          v-for="(s, i) in switchSkills"
          :key="`s${i}`"
          type="button"
          class="mc-switch is-skill"
          @click="chooseSkill(s)"
        >
          <span class="mc-switch-avatar">✦</span>
          <span class="mc-switch-body">
            <span class="mc-switch-name">{{ s.name }}</span>
            <span class="mc-switch-desc">技能 · 运行后结果附在对话里</span>
          </span>
          <span class="mc-switch-cta">启用</span>
        </button>
      </div>
    </template>

    <!-- ══════════ crisis 心理求助卡（内置固定内容）══════════ -->
    <template v-else-if="type === 'crisis'">
      <div class="mc-crisis" role="note">
        <div class="mc-crisis-head">
          <span class="mc-crisis-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20.5S4.5 15.6 4.5 10.2A4.2 4.2 0 0 1 12 7.6a4.2 4.2 0 0 1 7.5 2.6c0 5.4-7.5 10.3-7.5 10.3Z" />
            </svg>
          </span>
          <h4 class="mc-crisis-title">{{ data.title || "我很在意你现在的状态" }}</h4>
        </div>

        <p class="mc-crisis-body">
          {{ data.body || "你愿意说这些，本身就需要勇气。现在最重要的不是解决问题，而是有人陪着你。" }}
        </p>

        <!--
          号码是**内置固定**的，不取模型给的字符串：
          模型会记错号码，而打不通的求助电话比没有电话更糟。
          这里只允许它影响文案，不允许它影响号码。
        -->
        <div class="mc-crisis-lines">
          <a v-for="(line, i) in crisisLines" :key="i" class="mc-crisis-line" :href="`tel:${line.number}`">
            <span class="mc-crisis-num">{{ line.number }}</span>
            <span class="mc-crisis-line-body">
              <span class="mc-crisis-line-label">{{ line.label }}</span>
              <span class="mc-crisis-line-note">{{ line.note }}</span>
            </span>
            <span class="mc-crisis-call">拨号</span>
          </a>
        </div>

        <p class="mc-crisis-foot">
          如果此刻有立即的危险，请拨 <strong>110</strong> 或 <strong>120</strong>。
          也可以告诉信任的人，或去学校心理咨询中心预约面谈。
        </p>
      </div>
    </template>

    <!-- ══════════ 未知类型兜底 ══════════ -->
    <template v-else>
      <div class="mc-unknown">
        <span class="mc-kind">卡片</span>
        <p>这张卡片（{{ type || "未命名" }}）当前版本还不认识，已按原文显示。</p>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * 助手回复里的结构化卡片。
 *
 * ── 一个贯穿全文件的取舍：只信任「白名单字段」──
 *
 * 卡片的数据来自模型输出，属于**不可信输入**。所以：
 *   - 所有字段都过一层安全取值（asText / asList），类型不对就当没有；
 *   - 不渲染模型给的 url 之外的任何可执行内容（没有 v-html、没有 eval）；
 *   - 求助卡的号码一律用内置常量，忽略模型给的数字（见 crisisLines）。
 *
 * ── 交互卡「点过一次就锁住」──
 *
 * 选项卡提交后会发一条新消息。若不锁住，用户回看历史时再点一次，
 * 会重复发同样的追问，模型收到后会以为用户在纠正它。
 * 因此提交后进入 locked 态，只留「已发送」的痕迹。
 */
import { computed, reactive, ref, defineAsyncComponent } from "vue"
import { toastOk } from "@/api/client"
import KnowledgeCard from './KnowledgeCard.vue'
import AnswerLayoutCard from './AnswerLayoutCard.vue'
import CareCard from './CareCard.vue'
import PlaceCard from './PlaceCard.vue'
import CampusMapCard from '@/components/maps/CampusMapCard.vue'
import CampusEffectCard from './CampusEffectCard.vue'
const DinnerCard=defineAsyncComponent(()=>import('./DinnerCard.vue'))
const TakeoutCard=defineAsyncComponent(()=>import('./TakeoutCard.vue'))

const props = defineProps<{
  card: Record<string, unknown>
  /** 会话正在流式输出时禁用交互，避免半路发消息打断 */
  disabled?: boolean
  autoPlay?: boolean
  effectKey?: string
}>()

const emit = defineEmits<{
  /** 代表用户发一条消息 */
  (e: "ask", text: string): void
  /** 切换智能体（传真实 id）*/
  (e: "switch-agent", id: string): void
  /** 启用一个技能 key */
  (e: "use-skill", key: string): void
}>()

const type = computed(() => (typeof props.card.type === "string" ? props.card.type : ""))

/** 安全取字符串：非字符串（模型可能给数字/null/对象）一律当空 */
function asText(v: unknown, max = 200): string {
  if (typeof v !== "string") return ""
  return v.length > max ? v.slice(0, max) : v
}

/** 安全取对象数组：过滤掉非对象项，避免模板里访问 undefined 报错 */
function asList<T = Record<string, unknown>>(v: unknown): T[] {
  if (!Array.isArray(v)) return []
  return v.filter((x) => x && typeof x === "object") as T[]
}

function asBool(v: unknown, fallback = false): boolean {
  return typeof v === "boolean" ? v : fallback
}

// ─────────────── options ───────────────

const options = computed(() =>
  asList<{ label?: unknown; desc?: unknown; hint?: unknown; value?: unknown; action?: unknown }>(
    props.card.options
  )
    .map((o) => ({
      label: asText(o.label, 60),
      desc: asText(o.desc, 90),
      hint: asText(o.hint, 30),
      value: asText(o.value, 60),
      action: asText(o.action, 500)
    }))
    .filter((o) => o.label)
    .slice(0, 8)
)

const picked = reactive(new Set<number>())
/**
 * 提交过就锁住。
 *
 * 两个来源：
 *   - sent：本卡片已被用户点过。不锁的话回看历史时再点一次，
 *     会重复发同样的追问，模型收到后以为用户在纠正它。
 *   - disabled：整个会话正在流式输出，此时发消息会打断当前回复。
 */
const sent = ref(false)
const locked = computed(() => sent.value || props.disabled === true)

function isChecked(i: number) {
  return picked.has(i)
}

function toggle(i: number) {
  if (locked.value) return
  if (asBool(props.card.multiple)) {
    if (picked.has(i)) picked.delete(i)
    else picked.add(i)
  } else {
    // 单选：直接替换，避免出现两个选中态
    picked.clear()
    picked.add(i)
  }
}

/**
 * 提交选项。
 *
 * 两种发送方式：
 *   - 单选且该项给了 action → 直接发 action 原文。
 *     action 是写卡片的人（或模型）精心措辞的完整问题，
 *     比拼出来的「我选择：X」信息量大得多（会带上「要带什么、多少钱」这类追问）。
 *   - 其余情况 → 拼成「关于「标题」，我选择：A、B」，
 *     让模型知道用户是在回答它的提问。
 */
function submitOptions() {
  if (!picked.size) return
  const chosen = options.value.filter((_, i) => picked.has(i))

  if (!asBool(props.card.multiple) && chosen.length === 1 && chosen[0].action) {
    emit("ask", chosen[0].action)
    picked.clear()
    sent.value = true
    return
  }

  const title = asText(props.card.title, 40)
  const labels = chosen.map((o) => o.label)
  const text = title
    ? `关于「${title}」，我选择：${labels.join("、")}`
    : `我选择：${labels.join("、")}`
  emit("ask", text)
  picked.clear()
  sent.value = true
}

// ─────────────── guide ───────────────

const guideItems = computed(() =>
  asList<{ label?: unknown; desc?: unknown; meta?: unknown; action?: unknown; url?: unknown }>(
    props.card.items
  )
    .map((it) => {
      const rawUrl = asText(it.url, 300)
      /*
       * 只放行 http/https。模型若给出 javascript: 或 data: 链接，
       * 直接丢掉 url 字段（降级为可点击的追问按钮）而不是照抄。
       */
      const safeUrl = /^(https?:)?\/\//i.test(rawUrl) ? rawUrl : ""
      let host = ""
      if (safeUrl) {
        try {
          host = new URL(safeUrl.startsWith("//") ? `https:${safeUrl}` : safeUrl).host
        } catch {
          host = ""
        }
      }
      return {
        label: asText(it.label, 50),
        desc: asText(it.desc, 90),
        meta: asText(it.meta, 50),
        action: asText(it.action, 200) || asText(it.label, 50),
        url: safeUrl,
        host
      }
    })
    .filter((it) => it.label)
    .slice(0, 8)
)

function ask(text: string) {
  // 流式输出期间不发消息：会打断当前回复，用户却没看到任何提示
  if (props.disabled || !text) return
  emit("ask", text)
}

// ─────────────── steps ───────────────

const steps = computed(() =>
  asList<{ title?: unknown; desc?: unknown; done?: unknown }>(props.card.steps)
    .map((s) => ({
      title: asText(s.title, 60),
      desc: asText(s.desc, 140),
      done: s.done === true
    }))
    // 过滤掉空标题项。注意：done 必须在过滤「之前」随项一起带出，
    // 否则下面按下标回读 props.card.steps 会错位（曾经踩过）。
    .filter((s) => s.title)
    .slice(0, 12)
)

/**
 * 勾选状态只存在组件内存里，不落库。
 *
 * 理由：这是「我自己走到第几步了」的个人进度，写进会话记录会污染历史，
 * 也没有别的页面需要读它。刷新后重置是可以接受的取舍。
 */
const doneSet = reactive(new Set<number>())

// 初始勾选态跟随模型给的 done（模型可能根据上文知道用户已完成前几步）
steps.value.forEach((s, i) => {
  if (s.done) doneSet.add(i)
})

function toggleStep(i: number) {
  if (doneSet.has(i)) doneSet.delete(i)
  else doneSet.add(i)
}

const progressPct = computed(() =>
  steps.value.length ? Math.round((doneSet.size / steps.value.length) * 100) : 0
)

// ─────────────── poem ───────────────

const poemLines = computed(() =>
  asText(props.card.body, 600)
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 12)
)

// ─────────────── article ───────────────

const sections = computed(() =>
  asList<{ heading?: unknown; paragraphs?: unknown; quote?: unknown; list?: unknown }>(
    props.card.sections
  )
    .map((s) => ({
      heading: asText(s.heading, 60),
      paragraphs: Array.isArray(s.paragraphs)
        ? s.paragraphs.map((p) => asText(p, 1200)).filter(Boolean).slice(0, 8)
        : [],
      quote: asText(s.quote, 300),
      list: Array.isArray(s.list) ? s.list.map((l) => asText(l, 200)).filter(Boolean).slice(0, 10) : []
    }))
    .slice(0, 10)
)

// ─────────────── agents ───────────────

const switchAgents = computed(() =>
  asList<{ id?: unknown; name?: unknown; desc?: unknown }>(props.card.agents)
    .map((a) => ({ id: asText(a.id, 64), name: asText(a.name, 30), desc: asText(a.desc, 60) }))
    .filter((a) => a.id && a.name)
    .slice(0, 4)
)

const switchSkills = computed(() =>
  asList<{ key?: unknown; name?: unknown }>(props.card.skills)
    .map((s) => ({ key: asText(s.key, 64), name: asText(s.name, 30) }))
    .filter((s) => s.key && s.name)
    .slice(0, 4)
)

function chooseAgent(a: { id: string; name: string }) {
  if (props.disabled) return
  emit("switch-agent", a.id)
}

function chooseSkill(s: { key: string; name: string }) {
  if (props.disabled) return
  emit("use-skill", s.key)
  toastOk(`已启用技能「${s.name}」`)
}

// ─────────────── 统一出口 ───────────────

/**
 * 模板读取的标量字段。
 *
 * 卡片数据来自模型输出，属于**不可信输入**：模型可能给数字、null、
 * 数组、超长文本。这里把每个字段过一遍类型收敛，模板因此可以无脑取值，
 * 不会在 `undefined.length` 这类地方炸掉。
 *
 * 列表类字段（options / items / steps / sections …）不在这里，
 * 它们各自的 computed 已经做了同样的收敛 —— 再抄一份只会变成
 * 「两处真相」，改一处忘另一处。
 */
const data = computed(() => ({
  title: asText(props.card.title, 60),
  intro: asText(props.card.intro, 160),
  note: asText(props.card.note, 120),
  reason: asText(props.card.reason, 160),
  body: asText(props.card.body, 400),
  author: asText(props.card.author, 40),
  seal: asText(props.card.seal, 4),
  kicker: asText(props.card.kicker, 20),
  lead: asText(props.card.lead, 200),
  footer: asText(props.card.footer, 200),
  submitText: asText(props.card.submitText, 12) || "确定",
  multiple: asBool(props.card.multiple),
  /** 竖排默认开：卡片既然选了 poem 类型，要的就是书法感 */
  vertical: asBool(props.card.vertical, true)
}))

// ─────────────── crisis ───────────────

/**
 * 内置求助资源，**不读模型给的号码**。
 *
 * 12356 是国家卫生健康委 2024 年 12 月启用的全国统一心理援助热线，
 * 24 小时可用。号码写死在这里，是因为模型会记错号码，
 * 而「打不通的求助电话」比「没有电话」更糟 —— 它会让人以为没人可找。
 */
const crisisLines = [
  { number: "12356", label: "心理援助热线", note: "全国统一，24 小时" },
  { number: "110", label: "紧急情况报警", note: "有人身危险时" }
]
</script>

<style scoped>
/*
 * 卡片的排版全部内嵌在本组件里。
 *
 * 之所以不放进全局 student.css：卡片只在「助手输出卡片」时才存在，
 * 放进全局会让每个学生都下载这份样式却多半用不上；
 * 放在组件里则由 Vite 随组件 chunk 代码分割，用到才取。
 *
 * 配色一律引用 student.css 定义的 --sc-* 令牌，因此明暗主题自动跟随。
 */

.mc {
  margin: 12px 0;
  font-family: var(--sc-font-sans);
  min-width:0;
  max-width:100%;
  overflow-wrap:anywhere;
}

/* ---------- 通用头部 ---------- */

.mc-head {
  margin-bottom: 10px;
}

/* 眉标：小字距、朱砂色，像书页上的类目小签 */
.mc-kind {
  display: inline-block;
  margin-bottom: 5px;
  font-size: 11px;
  letter-spacing: 3px;
  color: var(--sc-cinnabar);
}

.mc-title {
  margin: 0;
  font-family: var(--sc-font-serif);
  font-size: 16px;
  font-weight: 600;
  color: var(--sc-ink);
  letter-spacing: 0.5px;
}

.mc-intro {
  margin: 5px 0 0;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--sc-ink-soft);
}

.mc-note {
  padding: 5px 9px;
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--sc-dai);
  background: var(--sc-dai-soft);
  border-radius: 5px;
}

/* ---------- options ---------- */

.mc-opt-list {
  padding: 0;
  margin: 0;
  list-style: none;
}

.mc-opt {
  position: relative;
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 11px 13px;
  margin-bottom: 7px;
  cursor: pointer;
  background: var(--sc-card);
  border: 1px solid var(--sc-line);
  border-radius: var(--sc-radius);
  transition: border-color 0.16s ease, background 0.16s ease;
}

.mc-opt:hover {
  border-color: var(--sc-cinnabar);
}

.mc-opt.is-on {
  background: var(--sc-cinnabar-soft);
  border-color: var(--sc-cinnabar);
}

/* 原生控件保留但视觉隐藏：这样键盘操作与读屏语义都是真的 */
.mc-native {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
}

.mc-native:focus-visible + .mc-mark {
  outline: 2px solid var(--sc-cinnabar);
  outline-offset: 2px;
}

/* 自绘选择圈 */
.mc-mark {
  flex: 0 0 auto;
  width: 17px;
  height: 17px;
  margin-top: 1px;
  background: var(--sc-paper);
  border: 1.5px solid var(--sc-line-strong, var(--sc-line));
  border-radius: 50%;
  transition: all 0.16s ease;
}

.mc-opt.is-on .mc-mark {
  background: var(--sc-cinnabar);
  border-color: var(--sc-cinnabar);
  /* 内圈白点：用 inset 阴影画，省一个 DOM 节点 */
  box-shadow: inset 0 0 0 3.5px var(--sc-card);
}

.mc-opt-body {
  flex: 1;
  min-width: 0;
}

.mc-opt-label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: var(--sc-ink);
}

.mc-opt-desc {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--sc-ink-faint);
}

.mc-opt-hint {
  flex: 0 0 auto;
  align-self: center;
  padding: 2px 8px;
  font-size: 11px;
  color: var(--sc-dai);
  background: var(--sc-dai-soft);
  border-radius: 9px;
}

.mc-foot {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-top: 4px;
}

.mc-submit {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  height: 34px;
  padding: 0 18px;
  font-family: inherit;
  font-size: 13.5px;
  color: var(--platform-on-accent, #fff);
  cursor: pointer;
  background: var(--sc-cinnabar);
  border: 0;
  border-radius: 8px;
  transition: background 0.16s ease;
}

.mc-submit:hover:not(:disabled) {
  background: var(--sc-cinnabar-deep);
}

.mc-submit:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.mc-count {
  padding: 0 6px;
  font-size: 11px;
  background: rgba(255, 255, 255, 0.24);
  border-radius: 8px;
}

.mc-sent {
  font-size: 12.5px;
  color: var(--sc-bamboo);
}

/* ---------- guide ---------- */

.mc-guide-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.mc-guide {
  display: flex;
  gap: 10px;
  align-items: center;
  width: 100%;
  padding: 11px 13px;
  font-family: inherit;
  text-align: left;
  color: inherit;
  cursor: pointer;
  background: var(--sc-card);
  border: 1px solid var(--sc-line);
  border-radius: var(--sc-radius);
  transition: all 0.16s ease;
}

.mc-guide:hover {
  border-color: var(--sc-cinnabar);
  transform: translateX(2px);
}

.mc-guide-main {
  flex: 1;
  min-width: 0;
}

.mc-guide-label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: var(--sc-ink);
}

.mc-guide-desc {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  color: var(--sc-ink-faint);
}

.mc-guide-meta {
  display: inline-block;
  margin-top: 4px;
  font-size: 11px;
  color: var(--sc-dai);
}

/* 链接域名小字：点开前就知道会去哪，比整段 URL 好读 */
.mc-guide-host {
  display: inline-block;
  margin-top: 4px;
  margin-left: 8px;
  font-size: 10.5px;
  color: var(--sc-ink-faint);
  letter-spacing: 0.2px;
}

.mc-guide-arrow {
  display: flex;
  flex: 0 0 auto;
  color: var(--sc-ink-faint);
  transition: color 0.16s ease;
}

.mc-guide:hover .mc-guide-arrow {
  color: var(--sc-cinnabar);
}

.mc-guide-arrow svg {
  width: 16px;
  height: 16px;
}

/* ---------- steps ---------- */

.mc-steps {
  padding: 0;
  margin: 0;
  list-style: none;
}

.mc-step {
  position: relative;
  display: flex;
  gap: 9px;
  align-items: flex-start;
  padding: 9px 0;
}

/* 步骤之间的连接线，强化「按顺序走」的读感 */
.mc-step:not(:last-child)::after {
  position: absolute;
  top: 32px;
  bottom: -4px;
  left: 12px;
  width: 1px;
  content: "";
  background: var(--sc-line);
}

.mc-step-check {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 25px;
  height: 25px;
  color: transparent;
  cursor: pointer;
  background: var(--sc-paper);
  border: 1.5px solid var(--sc-line);
  border-radius: 50%;
  transition: all 0.16s ease;
}

.mc-step-check svg {
  width: 13px;
  height: 13px;
}

.mc-step-check:hover {
  border-color: var(--sc-cinnabar);
}

.mc-step.is-done .mc-step-check {
  color: var(--platform-on-accent, #fff);
  background: var(--sc-cinnabar);
  border-color: var(--sc-cinnabar);
}

.mc-step-idx {
  position: absolute;
  top: 12px;
  left: 34px;
  font-size: 11px;
  color: var(--sc-ink-faint);
  opacity: 0;
}

.mc-step-body {
  flex: 1;
  min-width: 0;
  padding-top: 2px;
}

.mc-step-title {
  display: block;
  font-size: 14px;
  color: var(--sc-ink);
}

.mc-step.is-done .mc-step-title {
  color: var(--sc-ink-faint);
  text-decoration: line-through;
}

.mc-step-desc {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.65;
  color: var(--sc-ink-faint);
}

.mc-progress {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 8px;
}

.mc-progress-bar {
  flex: 1;
  height: 3px;
  overflow: hidden;
  background: var(--sc-line);
  border-radius: 2px;
}

.mc-progress-fill {
  display: block;
  height: 100%;
  background: var(--sc-cinnabar);
  transition: width 0.24s ease;
}

.mc-progress-text {
  font-size: 11px;
  color: var(--sc-ink-faint);
}

/* ---------- poem：竖排排版卡 ---------- */

.mc-poem {
  padding: 22px 20px;
  background: var(--sc-card);
  border: 1px solid var(--sc-line);
  /* 四角留白的细框感：用双层边框色做「装裱」 */
  box-shadow: inset 0 0 0 4px var(--sc-paper);
  text-align: center;
}

.mc-poem-title {
  margin-bottom: 16px;
  font-family: var(--sc-font-serif);
  font-size: 15px;
  font-weight: 600;
  color: var(--sc-ink-soft);
  letter-spacing: 4px;
}

/* 竖排：从右往左读，是中国书法的天然顺序 */
.mc-poem.is-vertical .mc-poem-body {
  display: inline-flex;
  flex-direction: row-reverse;
  gap: 6px;
  max-height: 340px;
}

.mc-poem.is-vertical .mc-poem-line {
  writing-mode: vertical-rl;
  padding: 0 3px;
  font-family: var(--sc-font-serif);
  font-size: 18px;
  line-height: 2;
  color: var(--sc-ink);
  letter-spacing: 5px;
  text-orientation: upright;
}

/* 横排（内容较长或含标点时更易读） */
.mc-poem:not(.is-vertical) .mc-poem-body {
  display: block;
}

.mc-poem:not(.is-vertical) .mc-poem-line {
  display: block;
  font-family: var(--sc-font-serif);
  font-size: 17px;
  line-height: 2.1;
  color: var(--sc-ink);
  letter-spacing: 2px;
}

.mc-poem-foot {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: center;
  margin-top: 16px;
}

.mc-poem.is-vertical .mc-poem-foot {
  margin-top: 18px;
}

.mc-poem-author {
  font-family: var(--sc-font-serif);
  font-size: 12.5px;
  color: var(--sc-ink-faint);
  letter-spacing: 1px;
}

.mc-poem-seal {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  font-family: var(--sc-font-serif);
  font-size: 13px;
  font-weight: 700;
  color: var(--platform-on-accent, #fff);
  background: var(--sc-cinnabar);
  border-radius: 2px;
  opacity: 0.9;
}

/* 竖排诗在窄屏改回横排：竖排一列可能高过屏幕 */
@media (max-width: 860px) {
  .mc-poem.is-vertical .mc-poem-body {
    max-height: none;
  }

  .mc-poem.is-vertical .mc-poem-line {
    font-size: 16px;
    letter-spacing: 4px;
  }
}

/* ---------- article：内嵌文章卡 ---------- */

.mc-article {
  padding: 20px 22px;
  background: var(--sc-card);
  border: 1px solid var(--sc-line);
  border-radius: var(--sc-radius-lg);
}

.mc-art-kicker {
  display: inline-block;
  padding: 2px 9px;
  margin-bottom: 9px;
  font-size: 11px;
  letter-spacing: 2px;
  color: var(--sc-cinnabar);
  background: var(--sc-cinnabar-soft);
  border-radius: 3px;
}

.mc-art-title {
  margin: 0 0 8px;
  font-family: var(--sc-font-serif);
  font-size: 20px;
  font-weight: 600;
  line-height: 1.45;
  color: var(--sc-ink);
  letter-spacing: 1px;
}

.mc-art-lead {
  padding-bottom: 12px;
  margin: 0 0 4px;
  font-size: 13.5px;
  line-height: 1.85;
  color: var(--sc-ink-soft);
  /* 导语与正文之间的分隔线，只画一半宽度更像排版而不是分割线 */
  border-bottom: 1px solid var(--sc-line);
}

.mc-art-sec + .mc-art-sec {
  margin-top: 6px;
}

.mc-art-heading {
  margin: 14px 0 6px;
  font-family: var(--sc-font-serif);
  font-size: 15px;
  font-weight: 600;
  color: var(--sc-ink);
}

/* 小节标题前一道朱砂短竖线，替代编号 */
.mc-art-heading::before {
  display: inline-block;
  width: 3px;
  height: 13px;
  margin-right: 8px;
  vertical-align: -1px;
  content: "";
  background: var(--sc-cinnabar);
  border-radius: 2px;
}

.mc-art-para {
  margin: 7px 0;
  font-size: 14.5px;
  line-height: 1.95;
  color: var(--sc-ink-soft);
  text-align: justify;
}

/* 首段首字下沉：文章卡最有「排版感」的一处细节 */
.mc-art-sec:first-of-type .mc-art-para:first-of-type::first-letter {
  float: left;
  padding: 4px 8px 0 0;
  font-family: var(--sc-font-serif);
  font-size: 34px;
  font-weight: 600;
  line-height: 1;
  color: var(--sc-cinnabar);
}

.mc-art-quote {
  padding: 8px 0 8px 14px;
  margin: 12px 0;
  font-family: var(--sc-font-serif);
  font-size: 14.5px;
  line-height: 1.85;
  color: var(--sc-ink);
  border-left: 2px solid var(--sc-cinnabar);
}

.mc-art-list {
  padding-left: 20px;
  margin: 8px 0;
}

.mc-art-list li {
  margin: 4px 0;
  font-size: 14px;
  line-height: 1.8;
  color: var(--sc-ink-soft);
}

.mc-art-foot {
  padding-top: 12px;
  margin-top: 14px;
  font-size: 12px;
  color: var(--sc-ink-faint);
  border-top: 1px solid var(--sc-line);
}

/* ---------- agents 切换卡 ---------- */

.mc-switch-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.mc-switch {
  display: flex;
  gap: 10px;
  align-items: center;
  width: 100%;
  padding: 10px 12px;
  font-family: inherit;
  text-align: left;
  color: inherit;
  cursor: pointer;
  background: var(--sc-card);
  border: 1px solid var(--sc-line);
  border-radius: var(--sc-radius);
  transition: all 0.16s ease;
}

.mc-switch:hover {
  border-color: var(--sc-dai);
  box-shadow: var(--sc-shadow);
}

.mc-switch.is-skill {
  background: var(--sc-dai-soft);
  border-color: transparent;
}

.mc-switch-avatar {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  font-family: var(--sc-font-serif);
  font-size: 15px;
  font-weight: 600;
  color: var(--sc-dai);
  background: var(--sc-dai-soft);
  border-radius: 8px;
}

.mc-switch.is-skill .mc-switch-avatar {
  color: var(--platform-on-accent, #fff);
  background: var(--sc-dai);
}

.mc-switch-body {
  flex: 1;
  min-width: 0;
}

.mc-switch-name {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: var(--sc-ink);
}

.mc-switch-desc {
  display: block;
  margin-top: 2px;
  overflow: hidden;
  font-size: 12px;
  color: var(--sc-ink-faint);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mc-switch-cta {
  flex: 0 0 auto;
  padding: 3px 11px;
  font-size: 12px;
  color: var(--sc-cinnabar);
  border: 1px solid var(--sc-cinnabar);
  border-radius: 12px;
}

/* ---------- crisis 求助卡 ---------- */

.mc-crisis {
  padding: 18px 18px 16px;
  /*
   * 求助卡刻意不用朱砂而用黛青：朱砂是「强调/操作」色，
   * 在这里会变成警示感，让人更紧张。黛青偏静，更像「有人在旁边」。
   */
  background: var(--sc-dai-soft);
  border: 1px solid var(--sc-dai);
  border-left-width: 3px;
  border-radius: var(--sc-radius);
}

.mc-crisis-head {
  display: flex;
  gap: 9px;
  align-items: center;
}

.mc-crisis-icon {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  color: var(--sc-dai);
}

.mc-crisis-icon svg {
  width: 22px;
  height: 22px;
}

.mc-crisis-title {
  margin: 0;
  font-family: var(--sc-font-serif);
  font-size: 16px;
  font-weight: 600;
  color: var(--sc-ink);
}

.mc-crisis-body {
  margin: 9px 0 13px;
  font-size: 14px;
  line-height: 1.9;
  color: var(--sc-ink-soft);
}

.mc-crisis-lines {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.mc-crisis-line {
  display: flex;
  gap: 11px;
  align-items: center;
  padding: 10px 12px;
  color: inherit;
  text-decoration: none;
  background: var(--sc-card);
  border: 1px solid var(--sc-line);
  border-radius: 9px;
  transition: all 0.16s ease;
}

.mc-crisis-line:hover {
  border-color: var(--sc-dai);
  transform: translateY(-1px);
}

.mc-crisis-num {
  font-family: var(--sc-font-serif);
  font-size: 21px;
  font-weight: 700;
  color: var(--sc-dai);
  letter-spacing: 1px;
}

.mc-crisis-line-body {
  flex: 1;
  min-width: 0;
}

.mc-crisis-line-label {
  display: block;
  font-size: 13.5px;
  color: var(--sc-ink);
}

.mc-crisis-line-note {
  display: block;
  font-size: 11.5px;
  color: var(--sc-ink-faint);
}

.mc-crisis-call {
  flex: 0 0 auto;
  padding: 4px 12px;
  font-size: 12px;
  color: var(--platform-on-accent, #fff);
  background: var(--sc-dai);
  border-radius: 12px;
}

.mc-crisis-foot {
  margin: 12px 0 0;
  font-size: 12px;
  line-height: 1.75;
  color: var(--sc-ink-faint);
}

.mc-crisis-foot strong {
  color: var(--sc-ink);
}

/* ---------- 未知类型 ---------- */

.mc-unknown {
  padding: 12px 14px;
  font-size: 13px;
  color: var(--sc-ink-faint);
  background: var(--sc-paper-deep);
  border: 1px dashed var(--sc-line);
  border-radius: var(--sc-radius);
}

.mc-unknown p {
  margin: 5px 0 0;
}
</style>
