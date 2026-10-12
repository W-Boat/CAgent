<template>
  <!-- 体验版（/test）反馈统计：满意度分布、问题与期望标签、7 日趋势、最近问卷 -->
  <div class="tv">
    <header class="tv-head">
      <h2 class="tv-title">体验版反馈统计</h2>
      <button class="tv-refresh" :disabled="loading" @click="load">刷新</button>
    </header>

    <section class="tv-kpis">
      <div v-for="k in kpis" :key="k.label" class="tv-kpi">
        <span class="tv-kpi-num">{{ k.value }}</span>
        <span class="tv-kpi-label">{{ k.label }}</span>
      </div>
    </section>

    <section class="tv-grid">
      <div class="tv-card">
        <h3 class="tv-card-title">总体满意度分布</h3>
        <div v-for="d in stats.overallDist" :key="d.value" class="tv-bar-row">
          <span class="tv-bar-label">{{ labelOf(d.value) }}</span>
          <span class="tv-bar-track">
            <span class="tv-bar-fill" :style="{ width: pct(d.count, surveyTotal) }" :class="barClass(d.value)" />
          </span>
          <span class="tv-bar-count">{{ d.count }}</span>
        </div>
        <p class="tv-avg">平均 {{ stats.avgOverall || "—" }} / 5</p>
      </div>

      <div class="tv-card">
        <h3 class="tv-card-title">近 7 日问答与问卷</h3>
        <table class="tv-table">
          <thead>
            <tr><th>日期</th><th>问答轮次</th><th>问卷</th></tr>
          </thead>
          <tbody>
            <tr v-for="d in [...stats.days].reverse()" :key="d.date">
              <td>{{ d.date.slice(5) }}</td>
              <td>{{ d.rounds }}</td>
              <td>{{ d.surveys }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="tv-card">
        <h3 class="tv-card-title">回答存在的问题（标签计数）</h3>
        <p v-if="!stats.problems.length" class="tv-empty">暂无数据</p>
        <div v-for="p in stats.problems" :key="p.label" class="tv-bar-row">
          <span class="tv-bar-label tv-bar-label-wide">{{ p.label }}</span>
          <span class="tv-bar-track">
            <span class="tv-bar-fill is-warn" :style="{ width: pct(p.count, stats.problems[0]?.count || 1) }" />
          </span>
          <span class="tv-bar-count">{{ p.count }}</span>
        </div>
      </div>

      <div class="tv-card">
        <h3 class="tv-card-title">希望增加的回答内容</h3>
        <p v-if="!stats.wants.length" class="tv-empty">暂无数据</p>
        <div v-for="w in stats.wants" :key="w.label" class="tv-bar-row">
          <span class="tv-bar-label tv-bar-label-wide">{{ w.label }}</span>
          <span class="tv-bar-track">
            <span class="tv-bar-fill is-good" :style="{ width: pct(w.count, stats.wants[0]?.count || 1) }" />
          </span>
          <span class="tv-bar-count">{{ w.count }}</span>
        </div>
      </div>
    </section>

    <section class="tv-card">
      <h3 class="tv-card-title">最近问卷（{{ surveys.length }}）</h3>
      <p v-if="!surveys.length" class="tv-empty">暂无问卷</p>
      <table v-else class="tv-table">
        <thead>
          <tr><th>时间</th><th>满意度</th><th>问题标签</th><th>期望内容</th><th>建议</th><th>会话</th></tr>
        </thead>
        <tbody>
          <tr v-for="s in surveys" :key="s.id">
            <td class="tv-nowrap">{{ fmtTime(s.createdAt) }}</td>
            <td><span class="tv-score" :class="scoreClass(s.overall)">{{ s.overall }}</span></td>
            <td class="tv-tags">{{ joinTags(s.problems) }}</td>
            <td class="tv-tags">{{ joinTags(s.wants) }}</td>
            <td class="tv-advice">{{ s.advice || "—" }}</td>
            <td class="tv-nowrap">
              <button v-if="s.conversationId" class="tv-link" @click="viewSession(s)">查看对话</button>
              <span v-else class="tv-none">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
    <!-- 会话追溯抽屉：问卷 → 整段体验问答 -->
    <div v-if="session.visible" class="tv-mask" @click.self="session.visible = false">
      <div class="tv-session">
        <header class="tv-session-head">
          <div>
            <h3 class="tv-session-title">会话追溯</h3>
            <p class="tv-session-sub">
              {{ session.data?.conversationId }} · {{ session.data?.rounds?.length || 0 }} 轮 ·
              IP {{ session.data?.rounds?.[0]?.ip || "—" }}
            </p>
          </div>
          <button class="tv-refresh" @click="session.visible = false">关闭</button>
        </header>
        <div v-if="session.loading" class="tv-empty">加载中…</div>
        <div v-else-if="!session.data" class="tv-empty">找不到该会话的问答记录（可能已被清理）</div>
        <div v-else class="tv-session-body">
          <div v-for="r in session.data.rounds" :key="r.id" class="tv-round" :class="{ 'is-rated': r.id === session.roundId }">
            <div class="tv-round-meta">
              <span class="tv-round-idx">{{ r.createdAt.slice(5, 16).replace("T", " ") }}</span>
              <span class="tv-round-lat">{{ r.latencyMs }}ms</span>
              <span v-if="r.id === session.roundId" class="tv-round-badge">本问卷对应的轮次</span>
            </div>
            <p class="tv-round-q"><b>问：</b>{{ r.question }}</p>
            <p class="tv-round-a"><b>答：</b>{{ r.answer || "（无回答记录）" }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue"
import { http } from "@/api/client"

const stats = reactive<any>({
  totalRounds: 0,
  todayRounds: 0,
  uniqueIps: 0,
  totalSurveys: 0,
  avgOverall: 0,
  overallDist: [],
  problems: [],
  wants: [],
  days: []
})
const surveys = reactive<any[]>([])
const loading = ref(false)

const surveyTotal = computed(() => stats.overallDist.reduce((a: number, d: any) => a + d.count, 0))
const kpis = computed(() => [
  { label: "累计问答轮次", value: stats.totalRounds },
  { label: "今日轮次", value: stats.todayRounds },
  { label: "独立访客 IP", value: stats.uniqueIps },
  { label: "问卷数", value: stats.totalSurveys },
  { label: "平均满意度", value: stats.avgOverall || "—" }
])

function labelOf(v: number) {
  return ({ 5: "很满意", 4: "满意", 3: "一般", 2: "不满意", 1: "很不满意" } as any)[v] || String(v)
}
function barClass(v: number) {
  return v >= 4 ? "is-good" : v === 3 ? "is-mid" : "is-bad"
}
function scoreClass(v: number) {
  return v >= 4 ? "is-good" : v === 3 ? "is-mid" : "is-bad"
}
function pct(count: number, total: number) {
  if (!total) return "0%"
  return Math.round((count / total) * 100) + "%"
}
function joinTags(v: any) {
  return Array.isArray(v) && v.length ? v.join("、") : "—"
}
function fmtTime(t: string) {
  return String(t || "").replace("T", " ").slice(5, 16)
}

const session = reactive({ visible: false, loading: false, data: null as any, roundId: "" })

async function viewSession(survey: any) {
  session.visible = true
  session.loading = true
  session.roundId = survey.roundId || ""
  session.data = null
  try {
    const r = await http.get(`/trial/session/${survey.conversationId}`)
    session.data = r.data?.data
  } finally {
    session.loading = false
  }
}

async function load() {
  loading.value = true
  try {
    const [s, sv] = await Promise.all([
      http.get("/trial/stats"),
      http.get("/trial/surveys", { params: { take: 50 } })
    ])
    Object.assign(stats, s.data?.data || {})
    surveys.splice(0, surveys.length, ...(sv.data?.data || []))
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.tv {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.tv-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.tv-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}
.tv-refresh {
  padding: 7px 16px;
  font-size: 13px;
  cursor: pointer;
  background: var(--el-fill-color-light, #f4f4f5);
  border: 0;
  border-radius: 8px;
}
.tv-kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 12px;
}
.tv-kpi {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 16px;
  background: var(--el-bg-color, #fff);
  border: 1px solid var(--el-border-color-lighter, #e4e7ed);
  border-radius: 10px;
}
.tv-kpi-num {
  font-size: 24px;
  font-weight: 600;
}
.tv-kpi-label {
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
}
.tv-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 16px;
}
.tv-card {
  padding: 16px;
  background: var(--el-bg-color, #fff);
  border: 1px solid var(--el-border-color-lighter, #e4e7ed);
  border-radius: 10px;
}
.tv-card-title {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 600;
}
.tv-bar-row {
  display: flex;
  gap: 10px;
  align-items: center;
  margin: 7px 0;
}
.tv-bar-label {
  flex: 0 0 58px;
  font-size: 12.5px;
  color: var(--el-text-color-regular, #606266);
}
.tv-bar-label-wide {
  flex: 0 0 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tv-bar-track {
  flex: 1;
  height: 8px;
  overflow: hidden;
  background: var(--el-fill-color-light, #f0f2f5);
  border-radius: 4px;
}
.tv-bar-fill {
  display: block;
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s ease;
}
.tv-bar-fill.is-good {
  background: var(--el-color-success, #67c23a);
}
.tv-bar-fill.is-mid {
  background: var(--el-color-warning, #e6a23c);
}
.tv-bar-fill.is-bad {
  background: var(--el-color-danger, #f56c6c);
}
.tv-bar-fill.is-warn {
  background: var(--el-color-warning, #e6a23c);
}
.tv-bar-fill.is-dai {
  background: var(--el-color-primary, #409eff);
}
.tv-bar-fill.is-good.is-good {
  background: var(--el-color-primary, #409eff);
}
.tv-bar-count {
  flex: 0 0 28px;
  font-size: 12.5px;
  text-align: right;
  color: var(--el-text-color-secondary, #909399);
}
.tv-avg {
  margin: 10px 0 0;
  font-size: 12.5px;
  color: var(--el-text-color-secondary, #909399);
}
.tv-empty {
  margin: 0;
  font-size: 13px;
  color: var(--el-text-color-secondary, #909399);
}
.tv-table {
  width: 100%;
  font-size: 13px;
  border-collapse: collapse;
}
.tv-table th,
.tv-table td {
  padding: 7px 8px;
  text-align: left;
  border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5);
}
.tv-nowrap {
  white-space: nowrap;
}
.tv-tags {
  max-width: 220px;
  font-size: 12.5px;
  color: var(--el-text-color-regular, #606266);
}
.tv-advice {
  max-width: 260px;
  word-break: break-word;
}
.tv-link {
  padding: 0;
  font-size: 12.5px;
  color: var(--el-color-primary, #409eff);
  cursor: pointer;
  background: none;
  border: 0;
}
.tv-link:hover {
  text-decoration: underline;
}
.tv-none {
  color: var(--el-text-color-placeholder, #c0c4cc);
}
.tv-mask {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.45);
}
.tv-session {
  display: flex;
  flex-direction: column;
  width: min(760px, 100%);
  max-height: 84vh;
  padding: 18px 20px;
  background: var(--el-bg-color, #fff);
  border-radius: 12px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.2);
}
.tv-session-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.tv-session-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.tv-session-sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
  word-break: break-all;
}
.tv-session-body {
  flex: 1;
  overflow-y: auto;
}
.tv-round {
  padding: 10px 12px;
  margin-bottom: 10px;
  border: 1px solid var(--el-border-color-lighter, #ebeef5);
  border-radius: 8px;
}
.tv-round.is-rated {
  background: var(--el-color-success-light-9, #f0f9eb);
  border-color: var(--el-color-success-light-5, #b3e19d);
}
.tv-round-meta {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 6px;
  font-size: 11.5px;
  color: var(--el-text-color-secondary, #909399);
}
.tv-round-badge {
  padding: 1px 8px;
  color: var(--el-color-success, #67c23a);
  background: var(--el-color-success-light-8, #e1f3d8);
  border-radius: 6px;
}
.tv-round-q {
  margin: 4px 0;
  font-size: 13.5px;
  line-height: 1.7;
}
.tv-round-a {
  margin: 4px 0 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--el-text-color-regular, #606266);
  white-space: pre-wrap;
  word-break: break-word;
}
.tv-score {
  display: inline-block;
  min-width: 22px;
  padding: 1px 6px;
  font-size: 12px;
  text-align: center;
  color: #fff;
  border-radius: 6px;
}
.tv-score.is-good {
  background: var(--el-color-success, #67c23a);
}
.tv-score.is-mid {
  background: var(--el-color-warning, #e6a23c);
}
.tv-score.is-bad {
  background: var(--el-color-danger, #f56c6c);
}
</style>
