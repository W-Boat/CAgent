<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { request, errorMessage } from '@/api/client'
import StudentTopbar from '@/components/student/StudentTopbar.vue'
import MarkdownView from '@/components/MarkdownView.vue'
import PageLoading from '@/components/PageLoading.vue'

type Item = {
  id: string; title: string; category: string; summary: string; url: string
  kind?: string; source?: string; date?: string
  department?: string; campus?: string; place?: string; availability?: string; keywords?: string[]
}
type Feed = { items: Item[]; sourceUrl: string }
type Detail = { detail: string; steps: string[]; materials: string[]; place?: string; department?: string; campus?: string; officeTime?: string; note?: string }
const route = useRoute()
const section = computed(() => route.path.endsWith('/services') ? 'services' : route.path.endsWith('/applications') ? 'applications' : 'information')
const information = computed(() => section.value === 'information')
const heading = computed(() => ({services:'办事大厅',applications:'应用中心',information:'校园资讯'})[section.value])
const result = ref<Feed>(), query = ref(''), category = ref(''), source = ref(''), page = ref(1), busy = ref(false), error = ref('')
const details = ref<Record<string,{busy?:boolean; error?:string; data?:Detail}>>({})
const saved = ref<string[]>(readSaved()), savedOnly = ref(false)
const pageSize = 12
const cached = new Map<string, Feed>()
const sourceOptions = computed(() => [...new Set((result.value?.items || []).map(item => item.source).filter(Boolean))].sort())
const categories = computed(() => [...new Set((result.value?.items || []).map(item => item.category).filter(Boolean))])
const matching = computed(() => {
  const terms = query.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return (result.value?.items || []).filter(item =>
    (!category.value || item.category === category.value) &&
    (!source.value || item.source === source.value) && (!savedOnly.value || saved.value.includes(item.id)) &&
    terms.every(term => [item.title, item.summary, item.source, item.department, ...(item.keywords || [])]
      .join(' ').toLowerCase().includes(term)))
})
const lastPage = computed(() => Math.max(1, Math.ceil(matching.value.length / pageSize)))
const visible = computed(() => matching.value.slice((page.value - 1) * pageSize, page.value * pageSize))
let runId = 0

function readSaved(): string[] {
  try { const list = JSON.parse(localStorage.getItem('cagent.portal-favorites') || '[]'); return Array.isArray(list) ? list.filter(item => typeof item === 'string') : [] }
  catch { return [] }
}
function toggleSaved(id: string) {
  saved.value = saved.value.includes(id) ? saved.value.filter(key => key !== id) : [...saved.value, id]
  try { localStorage.setItem('cagent.portal-favorites', JSON.stringify(saved.value)) } catch { /* browser storage may be disabled */ }
}
async function load() {
  const current = section.value, id = ++runId
  result.value = cached.get(current)
  busy.value = true
  error.value = ''
  try {
    const data = await request<Feed>({ url: '/experience/portal/' + current })
    cached.set(current, data)
    if (id === runId) result.value = data
  } catch (cause) {
    if (id === runId) error.value = errorMessage(cause)
  } finally {
    if (id === runId) busy.value = false
  }
}
async function loadDetail(id: string, event?: Event) {
  if (event && !(event.currentTarget as HTMLDetailsElement).open) return
  if (details.value[id]?.busy || details.value[id]?.data) return
  details.value[id] = {busy:true}
  const current = section.value
  try {
    const data = await request<Detail>({url:'/experience/portal/'+current+'/'+encodeURIComponent(id)})
    if (section.value===current) details.value[id] = { data }
  } catch (cause) {
    if (section.value===current) details.value[id] = {error:errorMessage(cause)}
  }
}
watch(section, () => { query.value = ''; category.value = ''; source.value = ''; details.value = {}; savedOnly.value = false; void load() }, { immediate: true })
watch([section,()=>route.query.q],()=>{if(section.value==='applications')query.value=typeof route.query.q==='string'?route.query.q:''},{immediate:true})
watch([query, category, source, savedOnly], () => { page.value = 1 })
watch(lastPage, max => { if (page.value > max) page.value = max })
</script>

<template>
  <div class="nx-root campus-portal">
    <StudentTopbar v-if="route.query.embed!=='1'" :title="heading"/>
    <main>
      <header class="portal-heading">
        <div><h1>{{ heading }}</h1>
          <p>{{ section === 'services' ? '查看校园事务 2.0 的流程与材料，实际受理以学校服务平台为准。' : information ? '校园官网要闻' : '搜索新版校园门户应用中心 A–Z 目录。' }}</p>
        </div>
        <a v-if="result" :href="result.sourceUrl" class="nx-btn nx-btn-secondary" target="_blank" rel="noopener noreferrer">{{information?'打开官网要闻':'打开学校门户'}} ↗</a>
      </header>
      <div class="portal-filters">
        <input v-model="query" type="search" :aria-label="'搜索'+heading" :placeholder="information ? '搜标题或来源' : '搜名称、关键词或负责部门'" />
        <select v-model="category" aria-label="筛选分类">
          <option value="">全部分类</option>
          <option v-for="key in categories" :key="key" :value="key">{{ key }}</option>
        </select>
        <select v-if="information" v-model="source" aria-label="筛选来源">
          <option value="">全部来源</option><option v-for="name in sourceOptions" :key="name" :value="name">{{ name }}</option>
        </select>
        <button v-if="information" type="button" class="nx-btn nx-btn-secondary" :aria-pressed="savedOnly" @click="savedOnly = !savedOnly">{{ savedOnly ? '查看全部' : '我的收藏' }}</button>
      </div>
      <p v-if="error" class="portal-state" role="alert">{{ error }} <button class="nx-btn nx-btn-secondary" type="button" @click="load">重新加载</button></p>
      <PageLoading v-else-if="busy" :rows="result ? 0 : 5" :label="'正在读取'+heading"/>
      <p v-if="result" class="portal-count" aria-live="polite">共 {{ matching.length }} 条</p>
      <p v-if="result && !visible.length" class="portal-state">{{ result.items.length ? '没有找到符合条件的内容。' : '知识库还没有已发布的条目，可以打开学校门户查看。' }}</p>
      <div v-if="visible.length" class="portal-grid">
        <article v-for="item in visible" :key="item.id" class="portal-card">
          <div class="portal-meta"><span>{{ item.category }}</span><time v-if="item.date">{{ item.date }}</time></div>
          <h2>{{ item.title }}</h2>
          <p class="portal-secondary">{{ [item.source, item.department, item.availability].filter(Boolean).join(' · ') }}</p>
          <p v-if="item.summary">{{ item.summary }}</p>
          <details v-if="item.kind!=='official-link'" @toggle="loadDetail(item.id,$event)">
            <summary>{{ section === 'services' ? '查看办理详情' : '阅读详情' }}</summary>
            <PageLoading v-if="details[item.id]?.busy" :rows="2" label="正在读取条目详情"/>
            <p v-else-if="details[item.id]?.error" role="alert">{{ details[item.id]?.error }} <button type="button" class="nx-btn nx-btn-secondary" @click="loadDetail(item.id)">重试</button></p>
            <template v-else-if="details[item.id]?.data">
              <dl><template v-for="[label, value] in [['负责部门', details[item.id].data?.department], ['校区', details[item.id].data?.campus], ['地点', details[item.id].data?.place], ['时间', details[item.id].data?.officeTime]]" :key="label"><div v-if="value"><dt>{{ label }}</dt><dd>{{ value }}</dd></div></template></dl>
              <div v-if="details[item.id].data?.materials?.length"><h3>所需材料</h3><ul><li v-for="(entry, index) in details[item.id].data?.materials" :key="index">{{ entry }}</li></ul></div>
              <div v-if="details[item.id].data?.steps?.length"><h3>办理流程</h3><ol><li v-for="(entry, index) in details[item.id].data?.steps" :key="index">{{ entry }}</li></ol></div>
              <MarkdownView v-if="details[item.id].data?.detail" :content="details[item.id].data?.detail || ''"/>
              <p v-if="details[item.id].data?.note">{{ details[item.id].data?.note }}</p>
            </template>
          </details>
          <footer v-if="item.url || information">
            <a v-if="item.url" class="nx-btn nx-btn-secondary" :href="item.url" target="_blank" rel="noopener noreferrer">{{ information ? '阅读原文' : '打开官方入口' }} ↗</a>
            <button v-if="information" type="button" class="nx-btn nx-btn-secondary" :aria-pressed="saved.includes(item.id)" @click="toggleSaved(item.id)">{{ saved.includes(item.id) ? '取消收藏' : '收藏' }}</button>
          </footer>
        </article>
      </div>
      <nav v-if="lastPage > 1" class="portal-pages" aria-label="分页">
        <button type="button" class="nx-btn nx-btn-secondary" :disabled="page === 1" @click="page--">上一页</button>
        <span>{{ page }} / {{ lastPage }}</span>
        <button type="button" class="nx-btn nx-btn-secondary" :disabled="page === lastPage" @click="page++">下一页</button>
      </nav>
    </main>
  </div>
</template>

<style scoped>
.campus-portal{min-height:100dvh;background:var(--nx-bg);color:var(--nx-text)}
.portal-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid var(--nx-border);padding:12px max(14px,calc((100% - 1080px)/2))}
.portal-bar nav{display:flex;gap:4px;padding:4px;background:var(--nx-surface-2);border-radius:10px;white-space:nowrap}
.portal-bar nav a{padding:7px 12px;border-radius:7px;color:var(--nx-text-2);text-decoration:none}
.portal-bar nav a.router-link-active{background:var(--nx-surface);color:var(--nx-accent);font-weight:650}
main{max-width:1080px;margin:auto;padding:30px 16px 54px}
.portal-heading,.portal-filters,.portal-card footer,.portal-meta,.portal-pages{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.portal-heading{justify-content:space-between;margin-bottom:20px}
.portal-heading h1{font-size:clamp(26px,5vw,40px);margin:0}.portal-heading p,.portal-secondary,.portal-count{color:var(--nx-text-2)}
.portal-filters input,.portal-filters select{min-width:0;border-radius:9px;padding:10px 12px;border:1px solid var(--nx-border);background:var(--nx-surface);color:inherit;font:inherit}
.portal-filters input{flex:1 1 250px}.portal-filters select{max-width:100%}
.portal-count{margin:18px 0 12px;font-size:13px}.portal-state{padding:18px 0}
.portal-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:14px;align-items:start}
.portal-card{border:1px solid var(--nx-border);border-radius:14px;background:var(--nx-surface);padding:17px;overflow-wrap:anywhere}
.portal-card h2{font-size:17px;line-height:1.45;margin:8px 0}.portal-card h3{font-size:14px;margin:13px 0 5px}
.portal-card p,.portal-card li{line-height:1.6}.portal-card p{margin:6px 0 10px}
.portal-meta{color:var(--nx-text-2);font-size:12px}.portal-meta time{margin-left:auto}
.portal-demo{background:var(--nx-accent-soft);color:var(--nx-accent);border-radius:5px;padding:2px 6px}
.portal-card details{border-top:1px solid var(--nx-border);padding-top:10px}.portal-card summary{cursor:pointer;color:var(--nx-accent)}
.portal-card footer{margin-top:12px}.portal-card dl>div{display:grid;grid-template-columns:4.5em 1fr;gap:4px;margin:5px 0}.portal-card dt{color:var(--nx-text-2)}.portal-card dd{margin:0}
.portal-pages{justify-content:center;margin-top:20px}
@media(max-width:520px){.portal-bar{padding:8px;gap:4px}.portal-bar nav a{padding:6px}.portal-bar .nx-btn{padding-inline:7px}.portal-heading{align-items:start}}
</style>
