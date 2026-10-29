<template>
  <div class="pg-page">
    <header class="pg-head">
      <div>
        <span class="pg-kicker">AGENT UI / 0.1</span>
        <h1>界面实验室</h1>
        <p>浏览组件示例，检查回答结构与交互。编辑内容仅用于本地预览。</p>
      </div>
      <button class="pg-button pg-copy" type="button" @click="copy">{{ copied ? '已复制' : '复制 JSON' }}</button>
    </header>

    <div class="pg-layout">
      <aside class="pg-explorer" aria-label="示例浏览">
        <div class="pg-explorer-head">
          <h2>组件示例</h2>
          <span>{{ visibleExamples.length }}</span>
        </div>
        <label class="pg-search-wrap">
          <span class="pg-sr">搜索组件示例</span>
          <input v-model="search" type="search" class="pg-search" placeholder="搜索示例" aria-label="搜索组件示例" />
        </label>
        <nav class="pg-examples" aria-label="组件示例">
          <section v-for="group in exampleGroups" :key="group.category" class="pg-example-group">
            <h3>{{ group.category }}</h3>
            <button
              v-for="example in group.examples"
              :key="example.label"
              type="button"
              class="pg-example"
              :class="{ active: selectedLabel === example.label }"
              :aria-current="selectedLabel === example.label ? 'true' : undefined"
              @click="select(example.index)"
            >{{ example.label }}</button>
          </section>
          <p v-if="!visibleExamples.length" class="pg-empty">没有匹配的示例</p>
        </nav>
      </aside>

      <main class="pg-main">
        <div class="pg-current">
          <div class="pg-current-copy">
            <span class="pg-eyebrow">{{ currentExample ? '当前示例' : '自定义内容' }}</span>
            <h2>{{ selectedLabel }}</h2>
            <p v-if="currentExample">{{ currentExample.document.fallback }}</p>
            <p v-else>修改下方 JSON 后，预览和结构校验会同步更新。</p>
          </div>
          <div class="pg-switch" role="group" aria-label="移动端工作区">
            <button type="button" :aria-pressed="mobilePane === 'preview'" @click="mobilePane = 'preview'">预览</button>
            <button type="button" :aria-pressed="mobilePane === 'editor'" @click="mobilePane = 'editor'">编辑</button>
          </div>
        </div>

        <div class="pg-workspace">
          <section class="pg-preview" :class="{ 'pg-pane-hidden': mobilePane !== 'preview' }" aria-labelledby="pg-preview-title">
            <div class="pg-bar">
              <div class="pg-bar-title"><span class="pg-dot" aria-hidden="true"></span><h2 id="pg-preview-title">实时预览</h2></div>
              <div class="pg-modes" role="group" aria-label="预览设置">
                <button type="button" :aria-pressed="mobile" @click="mobile = !mobile">{{ mobile ? '手机宽度' : '桌面宽度' }}</button>
                <button type="button" :aria-pressed="disabled" @click="disabled = !disabled">{{ disabled ? '交互已禁用' : '交互可用' }}</button>
              </div>
            </div>
            <div class="pg-canvas" :class="{ mobile }">
              <p v-if="input.length > 150000" class="pg-limit">输入超过预览上限，请缩小内容。</p>
              <CardMessage v-else-if="fenced" :content="input" :disabled="disabled" :knowledge-sources="previewSources" @ask="capture" />
              <AgentUiRenderer v-else :document="document" :disabled="disabled" :source-ids="sourceIds" @ask="capture" />
            </div>
            <div class="pg-feedback">
              <section class="pg-validation" :class="{ invalid: !validation.ok }" role="status" aria-live="polite">
                <span class="pg-feedback-label">结构状态</span>
                <strong>{{ validation.ok ? '校验通过' : '需要调整' }}</strong>
                <span v-if="validation.ok" class="pg-feedback-detail">{{ validation.nodes }} 个组件已检查字段、布局与操作</span>
                <ul v-else><li v-for="error in validation.errors" :key="error">{{ error }}</li></ul>
              </section>
              <section class="pg-events" aria-labelledby="pg-events-title">
                <div class="pg-events-head">
                  <h3 id="pg-events-title">交互记录</h3>
                  <button v-if="events.length" type="button" class="pg-text-button" @click="events = []">清空</button>
                </div>
                <p v-if="!events.length">预览中的按钮和表单操作会显示在这里。</p>
                <pre v-for="(event, i) in events" :key="i">{{ event }}</pre>
              </section>
            </div>
          </section>

          <section class="pg-editor" :class="{ 'pg-pane-hidden': mobilePane !== 'editor' }" aria-labelledby="pg-editor-title">
            <div class="pg-bar">
              <div><h2 id="pg-editor-title">界面描述</h2><p>可编辑 JSON 或含 card 围栏的完整回答</p></div>
              <span class="pg-char-count">{{ input.length.toLocaleString() }} 字</span>
            </div>
            <label class="pg-sr" for="ui-json">Agent UI JSON 或模型的完整回答</label>
            <textarea id="ui-json" v-model="input" spellcheck="false" placeholder="粘贴 JSON 或含 card 围栏的模型回答" />
            <label class="pg-sources">预览来源 ID <span>仅用于本地校验</span>
              <input v-model="sources" placeholder="用逗号分隔，可填写 id 或 citationId" />
            </label>
          </section>
        </div>
      </main>
    </div>

    <details class="pg-registry">
      <summary>组件注册表 <span>{{ Object.keys(UI_COMPONENTS).length }} 类</span></summary>
      <div class="pg-registry-grid">
        <article v-for="(component, type) in UI_COMPONENTS" :key="type">
          <h3>{{ component.name }} <code>{{ type }}</code></h3>
          <p>{{ component.purpose }}</p>
          <code class="pg-shape">{{ component.shape }}</code>
        </article>
      </div>
    </details>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AgentUiRenderer from '@/components/presentation/AgentUiRenderer.vue'
import CardMessage from '@/components/CardMessage.vue'
import { UI_COMPONENTS, isUiDocument, validateUiDocument } from '@/utils/agent-ui'
import { UI_EXAMPLES } from '@/utils/agent-ui-examples'
import { parseCardSegments } from '@/utils/card-segments'
import { parseCardJson } from '@/utils/card-json'

const index = ref(0)
const input = ref(JSON.stringify(UI_EXAMPLES[0].document, null, 2))
const sources = ref('')
const mobile = ref(false)
const mobilePane = ref<'preview' | 'editor'>('preview')
const disabled = ref(false)
const events = ref<string[]>([])
const copied = ref(false)
const search = ref('')

watch(input, value => {
  if (index.value >= 0 && value !== JSON.stringify(UI_EXAMPLES[index.value]?.document, null, 2)) index.value = -1
  copied.value = false
  events.value = []
})

const currentExample = computed(() => index.value >= 0 ? UI_EXAMPLES[index.value] : undefined)
const selectedLabel = computed(() => currentExample.value?.label ?? '自定义内容')
const fenced = computed(() => /^\s*```(?:card|json)\s*$/m.test(input.value))
const parsed = computed(() => {
  if (input.value.length > 150000) return { error: '输入超过 150000 字上限' }
  try {
    if (fenced.value) {
      const pages = parseCardSegments(input.value).filter(segment => segment.kind === 'card' && isUiDocument(segment.card))
      return { value: pages.map(segment => segment.kind === 'card' ? segment.card : null), multi: true }
    }
    return { value: parseCardJson(input.value) }
  } catch {
    return { error: 'JSON 尚未完整或存在语法错误' }
  }
})
const document = computed(() => parsed.value.multi ? (parsed.value.value as unknown[])?.[0] : parsed.value.value)
const sourceIds = computed(() => new Set(sources.value.split(/[,，\s]+/).filter(Boolean)))
const previewSources = computed(() => [...sourceIds.value].map(id => ({ id })))
const validation = computed(() => {
  if (parsed.value.error) return { ok: false, nodes: 0, errors: [parsed.value.error] }
  if (parsed.value.multi) {
    const pages = parsed.value.value as unknown[]
    if (!pages.length) return { ok: false, nodes: 0, errors: ['未找到 Agent UI 页面或注册组件；旧版卡片可在右侧兼容预览'] }
    const results = pages.map(page => validateUiDocument(page, { sourceIds: sourceIds.value }))
    return { ok: results.every(result => result.ok), nodes: results.reduce((sum, result) => sum + result.nodes, 0), errors: results.flatMap(result => result.errors) }
  }
  return validateUiDocument(document.value, { sourceIds: sourceIds.value })
})

const visibleExamples = computed(() => {
  const query = search.value.trim().toLocaleLowerCase()
  return UI_EXAMPLES.map((example, exampleIndex) => ({
    ...example,
    index: exampleIndex,
    category: categoryFor(example),
  })).filter(example => !query || `${example.label} ${example.document.fallback} ${example.category}`.toLocaleLowerCase().includes(query))
})
const exampleGroups = computed(() => {
  const groups = new Map<string, typeof visibleExamples.value>()
  for (const example of visibleExamples.value) {
    if (!groups.has(example.category)) groups.set(example.category, [])
    groups.get(example.category)!.push(example)
  }
  return [...groups].map(([category, examples]) => ({ category, examples }))
})

function categoryFor(example: typeof UI_EXAMPLES[number]): string {
  const types = new Set<string>(example.document.children.map(node => node.type))
  if (types.has('service_card') || types.has('key_values') || /业务|服务/.test(example.label)) return '服务与信息'
  if (['steps', 'checklist', 'timeline', 'notice', 'faq'].some(type => types.has(type))) return '流程与说明'
  if (['table', 'chart', 'info_card', 'card_group'].some(type => types.has(type))) return '数据与卡片'
  if (['button', 'form', 'options'].some(type => types.has(type))) return '交互组件'
  return '基础内容'
}

function select(exampleIndex: number) {
  index.value = exampleIndex
  input.value = JSON.stringify(UI_EXAMPLES[exampleIndex].document, null, 2)
  events.value = []
  sources.value = ''
  copied.value = false
  mobilePane.value = 'preview'
}

function capture(message: string) {
  events.value = [message, ...events.value].slice(0, 5)
}

async function copy() {
  try {
    await navigator.clipboard.writeText(input.value)
    copied.value = true
  } catch {
    copied.value = false
  }
}
</script>

<style scoped>
.pg-page{max-width:1680px;margin:0 auto;padding:24px;color:var(--nx-text)}
.pg-head{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:22px}
.pg-kicker,.pg-eyebrow{font-size:11px;letter-spacing:.1em;color:var(--nx-text-3)}
.pg-head h1{margin:5px 0 7px;font-size:25px;letter-spacing:-.3px}
.pg-head p,.pg-current p{margin:0;color:var(--nx-text-2);font-size:13px;line-height:1.65}
.pg-button,.pg-modes button,.pg-switch button,.pg-text-button{font:inherit;cursor:pointer;border:1px solid var(--nx-border);border-radius:8px;background:var(--nx-surface);color:var(--nx-text-2)}
.pg-button{padding:9px 13px;white-space:nowrap}.pg-button:hover,.pg-modes button:hover,.pg-switch button:hover,.pg-text-button:hover{border-color:var(--nx-accent-border);color:var(--nx-accent)}
.pg-layout{display:grid;grid-template-columns:226px minmax(0,1fr);gap:18px;align-items:start}
.pg-explorer,.pg-preview,.pg-editor,.pg-registry{min-width:0;border:1px solid var(--nx-border);border-radius:12px;background:var(--nx-surface)}
.pg-explorer{position:sticky;top:16px;overflow:hidden}
.pg-explorer-head{display:flex;justify-content:space-between;align-items:center;padding:15px 15px 11px}
.pg-explorer-head h2,.pg-bar h2,.pg-events h3{font-size:13px;margin:0;font-weight:650}
.pg-explorer-head>span,.pg-char-count{color:var(--nx-text-3);font-size:11px;font-variant-numeric:tabular-nums}
.pg-search-wrap{display:block;padding:0 12px 12px}
.pg-search{width:100%;height:34px;padding:0 10px;border:1px solid var(--nx-border);border-radius:7px;background:var(--nx-surface-2);color:var(--nx-text);font:inherit;font-size:12px}
.pg-examples{max-height:min(68vh,720px);overflow:auto;padding:0 8px 10px}
.pg-example-group{padding:8px 4px 6px}.pg-example-group+h3{margin-top:5px}
.pg-example-group h3{padding:0 8px 5px;color:var(--nx-text-3);font-size:10px;font-weight:600;letter-spacing:.06em}
.pg-example{display:block;width:100%;min-width:0;padding:7px 9px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--nx-text-2);font:inherit;font-size:12px;text-align:left;overflow-wrap:anywhere;cursor:pointer}
.pg-example:hover{background:var(--nx-surface-2);color:var(--nx-text)}
.pg-example.active{border-color:var(--nx-accent-border);background:var(--nx-accent-soft);color:var(--nx-accent);font-weight:600}
.pg-empty{padding:8px;color:var(--nx-text-3);font-size:12px}
.pg-main{min-width:0}.pg-current{display:flex;justify-content:space-between;align-items:center;gap:18px;margin:1px 2px 14px}
.pg-current-copy{min-width:0}.pg-current h2{margin:3px 0 4px;font-size:17px;font-weight:650}.pg-current p{max-width:860px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pg-switch{display:none;flex:none;gap:4px;padding:3px;border:1px solid var(--nx-border);border-radius:9px;background:var(--nx-surface-2)}
.pg-switch button{padding:6px 10px;border-color:transparent;background:transparent;font-size:12px}
.pg-switch button[aria-pressed="true"]{border-color:var(--nx-border);background:var(--nx-surface);color:var(--nx-text);box-shadow:0 1px 2px #0000000d}
.pg-workspace{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(300px,.85fr);gap:14px;align-items:start}
.pg-preview,.pg-editor{overflow:hidden}
.pg-bar{min-height:56px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 14px;border-bottom:1px solid var(--nx-border)}
.pg-bar-title{display:flex;align-items:center;gap:9px}.pg-dot{width:8px;height:8px;border-radius:50%;background:var(--nx-accent)}
.pg-bar>div>p{margin:4px 0 0;font-size:11px;color:var(--nx-text-3)}
.pg-modes{display:flex;gap:5px}.pg-modes button{max-width:120px;padding:5px 8px;font-size:10px;overflow-wrap:anywhere;white-space:normal;line-height:1.35}
.pg-modes button[aria-pressed="true"]{border-color:var(--nx-accent-border);background:var(--nx-accent-soft);color:var(--nx-accent)}
.pg-canvas{min-height:320px;padding:20px;background:var(--nx-surface)}
.pg-canvas.mobile{max-width:390px;margin:12px auto;padding:16px;border:1px solid var(--nx-border);border-radius:14px;box-shadow:0 8px 28px #0000000c}
.pg-limit{margin:0;color:var(--nx-text-2);font-size:13px}
.pg-feedback{border-top:1px solid var(--nx-border);background:var(--nx-surface-2)}
.pg-validation{display:grid;grid-template-columns:auto auto 1fr;align-items:baseline;gap:8px;padding:12px 14px;border-bottom:1px solid var(--nx-border);font-size:12px}
.pg-feedback-label{color:var(--nx-text-3);font-size:11px}.pg-validation strong{color:var(--nx-accent);font-size:12px}.pg-feedback-detail{min-width:0;color:var(--nx-text-2);font-size:11px;text-align:right}
.pg-validation.invalid strong{color:var(--nx-text-2)}.pg-validation ul{grid-column:1/-1;margin:0;padding-left:18px;color:var(--nx-text-2);overflow-wrap:anywhere}
.pg-events{padding:11px 14px 13px}.pg-events-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.pg-events p{margin:7px 0 0;color:var(--nx-text-3);font-size:11px;line-height:1.55}
.pg-text-button{padding:3px 7px;font-size:11px}.pg-events pre{margin:8px 0 0;padding:9px 10px;border-left:2px solid var(--nx-accent-border);background:var(--nx-surface);color:var(--nx-text-2);font:12px/1.6 ui-monospace,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
.pg-editor textarea{display:block;resize:vertical;width:100%;height:390px;min-height:220px;padding:14px;border:0;background:var(--nx-surface);color:var(--nx-text);font:12px/1.7 ui-monospace,Consolas,monospace;tab-size:2}
.pg-sources{display:grid;gap:6px;padding:11px 14px;border-top:1px solid var(--nx-border);color:var(--nx-text-2);font-size:11px}
.pg-sources span{color:var(--nx-text-3);font-weight:400}.pg-sources input{width:100%;min-width:0;height:33px;padding:0 9px;border:1px solid var(--nx-border);border-radius:6px;background:var(--nx-surface-2);color:var(--nx-text);font:inherit}
.pg-registry{margin-top:14px;padding:12px 14px}.pg-registry summary{display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;font-weight:600}.pg-registry summary span{color:var(--nx-text-3);font-size:11px;font-weight:400}
.pg-registry-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;margin-top:12px}.pg-registry article{min-width:0;padding:10px;border:1px solid var(--nx-border);border-radius:8px;background:var(--nx-surface-2);overflow-wrap:anywhere}
.pg-registry article h3{margin:0;font-size:12px}.pg-registry p{margin:6px 0;color:var(--nx-text-2);font-size:11px;line-height:1.5}.pg-registry code{color:var(--nx-text-3);font-size:10px;overflow-wrap:anywhere}.pg-shape{display:block}
.pg-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
:where(.pg-page) button:focus-visible,:where(.pg-page) input:focus-visible,:where(.pg-page) textarea:focus-visible,:where(.pg-page) summary:focus-visible{outline:2px solid var(--nx-accent);outline-offset:2px}
@media(max-width:1120px){.pg-workspace{grid-template-columns:minmax(0,1.1fr) minmax(300px,.9fr)}.pg-layout{grid-template-columns:205px minmax(0,1fr)}.pg-page{padding:18px}}
@media(max-width:820px){.pg-page{padding:16px}.pg-layout{grid-template-columns:minmax(0,1fr);gap:14px}.pg-explorer{position:static}.pg-examples{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));max-height:230px}.pg-example-group{min-width:0}.pg-workspace{grid-template-columns:minmax(0,1fr)}.pg-switch{display:flex}.pg-pane-hidden{display:none}.pg-editor textarea{height:55vh;min-height:260px}.pg-canvas{padding:14px;min-height:240px}}
@media(max-width:480px){.pg-page{padding:13px}.pg-head{align-items:flex-start;gap:10px;margin-bottom:16px}.pg-head h1{font-size:21px}.pg-head p{max-width:34ch;font-size:12px}.pg-copy{padding:7px 9px;font-size:12px}.pg-current{align-items:flex-start;gap:8px}.pg-current h2{font-size:15px}.pg-current p{font-size:12px}.pg-switch button{padding:6px 8px}.pg-examples{grid-template-columns:minmax(0,1fr)}.pg-modes{max-width:58%}.pg-modes button{padding:5px 6px}.pg-validation{grid-template-columns:auto 1fr}.pg-feedback-detail{grid-column:1/-1;text-align:left}.pg-char-count{white-space:nowrap}}
@media(prefers-reduced-motion:reduce){.pg-page *{scroll-behavior:auto!important;transition:none!important;animation:none!important}}
</style>
