<template>
  <div class="learning-admin">
    <el-card shadow="never" style="margin-bottom:24px"><FeedbackQueue/></el-card>
    <!-- 概览卡片 -->
    <el-row :gutter="16" class="overview-row">
      <el-col :xs="12" :sm="8" :md="4">
        <div class="stat-card pending">
          <div class="stat-value">{{ overview?.pending ?? 0 }}</div>
          <div class="stat-label">待审核</div>
        </div>
      </el-col>
      <el-col :xs="12" :sm="8" :md="4">
        <div class="stat-card approved">
          <div class="stat-value">{{ overview?.approved ?? 0 }}</div>
          <div class="stat-label">已通过</div>
        </div>
      </el-col>
      <el-col :xs="12" :sm="8" :md="4">
        <div class="stat-card rejected">
          <div class="stat-value">{{ overview?.rejected ?? 0 }}</div>
          <div class="stat-label">已否决</div>
        </div>
      </el-col>
      <el-col :xs="12" :sm="8" :md="4">
        <div class="stat-card">
          <div class="stat-value">{{ overview?.feedbackTotal ?? 0 }}</div>
          <div class="stat-label">反馈总数（{{ days }}天）</div>
        </div>
      </el-col>
      <el-col :xs="12" :sm="8" :md="4">
        <div class="stat-card">
          <div class="stat-value">{{ overview?.positive ?? 0 }}</div>
          <div class="stat-label">点赞</div>
        </div>
      </el-col>
      <el-col :xs="12" :sm="8" :md="4">
        <div class="stat-card negative">
          <div class="stat-value">
            {{ overview?.negative ?? 0 }}
            <span class="stat-rate">({{ overview?.negativeRate ?? 0 }}%)</span>
          </div>
          <div class="stat-label">点踩</div>
        </div>
      </el-col>
    </el-row>

    <!-- 被踩最多的智能体 -->
    <el-card v-if="overview?.topAgents?.length" class="top-agents-card" shadow="never">
      <template #header>
        <span>被踩最多的智能体（{{ days }}天）</span>
      </template>
      <div class="top-agents">
        <div v-for="a in overview.topAgents" :key="a.agentId || a.name" class="top-agent-item">
          <el-avatar :size="28" :src="a.avatar || undefined">
            {{ a.name?.slice(0, 1) }}
          </el-avatar>
          <span class="agent-name">{{ a.name }}</span>
          <el-tag type="danger" size="small">{{ a.negative }} 次踩</el-tag>
        </div>
      </div>
    </el-card>

    <!-- 筛选与列表 -->
    <el-card shadow="never" class="list-card">
      <template #header>
        <div class="list-header">
          <div class="list-header-left">
            <el-select v-model="filterStatus" placeholder="状态" clearable @change="loadData">
              <el-option label="全部" value="ALL" />
              <el-option label="待审核" value="PENDING" />
              <el-option label="已通过" value="APPROVED" />
              <el-option label="已否决" value="REJECTED" />
            </el-select>
            <el-select
              v-model="filterAgentId"
              placeholder="智能体"
              clearable
              @change="loadData"
            >
              <el-option
                v-for="a in agentOptions"
                :key="a.id"
                :label="a.name"
                :value="a.id"
              />
            </el-select>
          </div>
          <div class="list-header-right">
            <el-radio-group v-model="days" size="small" @change="loadOverview">
              <el-radio-button :value="7">7天</el-radio-button>
              <el-radio-button :value="14">14天</el-radio-button>
              <el-radio-button :value="30">30天</el-radio-button>
            </el-radio-group>
          </div>
        </div>
      </template>

      <el-table :data="items" v-loading="loading" stripe>
        <el-table-column label="智能体" min-width="120">
          <template #default="{ row }">
            <div class="agent-cell">
              <el-avatar :size="24" :src="row.agent?.avatar || undefined">
                {{ row.agent?.name?.slice(0, 1) }}
              </el-avatar>
              <span>{{ row.agent?.name || "已删除" }}</span>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="类型" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="kindTagType(row.kind)">
              {{ kindLabel(row.kind) }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="经验内容" min-width="280">
          <template #default="{ row }">
            <div class="instruction-cell">
              <div class="instruction-text">{{ row.instruction || "（待填写）" }}</div>
              <div v-if="row.sampleQuestion" class="instruction-question">
                问题：{{ truncate(row.sampleQuestion, 60) }}
              </div>
              <div class="instruction-meta">
                <span>支撑 {{ row.supportCount }} 次</span>
                <span>注入 {{ row.injectedCount }} 次</span>
              </div>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)" size="small">
              {{ statusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="审核人" width="100">
          <template #default="{ row }">
            {{ row.reviewedBy?.name || "-" }}
          </template>
        </el-table-column>

        <el-table-column label="创建时间" width="160">
          <template #default="{ row }">
            {{ fromNow(row.createdAt) }}
          </template>
        </el-table-column>

        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="row.status === 'PENDING'"
              type="success"
              size="small"
              text
              @click="openReview(row, 'APPROVED')"
            >
              通过
            </el-button>
            <el-button
              v-if="row.status === 'PENDING'"
              type="danger"
              size="small"
              text
              @click="openReview(row, 'REJECTED')"
            >
              否决
            </el-button>
            <el-button
              v-if="row.status !== 'PENDING'"
              type="warning"
              size="small"
              text
              @click="openReview(row, 'PENDING')"
            >
              重审
            </el-button>
            <el-popconfirm
              title="确定删除此学习条目？"
              @confirm="doRemove(row.id)"
            >
              <template #reference>
                <el-button type="danger" size="small" text>删除</el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[20, 50, 100]"
          layout="total, sizes, prev, pager, next"
          @size-change="loadData"
          @current-change="loadData"
        />
      </div>
    </el-card>

    <!-- 审核对话框 -->
    <el-dialog
      v-model="reviewVisible"
      :title="reviewTitle"
      width="560px"
      :close-on-click-modal="false"
    >
      <div v-if="reviewItem" class="review-body">
        <div class="review-info">
          <div class="review-info-row">
            <span class="review-label">智能体：</span>
            <span>{{ reviewItem.agent?.name || "已删除" }}</span>
          </div>
          <div class="review-info-row">
            <span class="review-label">类型：</span>
            <el-tag size="small" :type="kindTagType(reviewItem.kind)">
              {{ kindLabel(reviewItem.kind) }}
            </el-tag>
          </div>
          <div class="review-info-row">
            <span class="review-label">支撑人数：</span>
            <span>{{ reviewItem.supportCount }}</span>
          </div>
          <div v-if="reviewItem.sampleQuestion" class="review-info-row">
            <span class="review-label">原始问题：</span>
            <span>{{ reviewItem.sampleQuestion }}</span>
          </div>
          <div v-if="reviewItem.evidence" class="review-info-row">
            <span class="review-label">证据：</span>
            <pre class="review-evidence">{{ JSON.stringify(reviewItem.evidence, null, 2) }}</pre>
          </div>
        </div>

        <el-form label-position="top">
          <el-form-item label="经验内容（审核通过后会注入智能体提示词）">
            <el-input
              v-model="reviewInstruction"
              type="textarea"
              :rows="4"
              placeholder="一句话经验，例如：回答事实性问题时必须先调用检索工具核对"
            />
          </el-form-item>
          <el-form-item label="类型">
            <el-select v-model="reviewKind">
              <el-option label="纠正" value="CORRECTION" />
              <el-option label="偏好" value="PREFERENCE" />
              <el-option label="常见问题" value="FAQ" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="reviewKind==='CORRECTION' && reviewAction==='APPROVED'"><el-checkbox v-model="pinAnswer">同时发布为固定纠错答案</el-checkbox></el-form-item>
          <el-form-item v-if="pinAnswer && reviewAction==='APPROVED'" label="原样返回的正确答案"><el-input v-model="fixedAnswer" type="textarea" :rows="5"/></el-form-item>
        </el-form>
      </div>

      <template #footer>
        <el-button @click="reviewVisible = false">取消</el-button>
        <el-button
          v-if="reviewAction === 'APPROVED'"
          type="success"
          :loading="reviewing"
          @click="doReview"
        >
          通过
        </el-button>
        <el-button
          v-else-if="reviewAction === 'REJECTED'"
          type="danger"
          :loading="reviewing"
          @click="doReview"
        >
          否决
        </el-button>
        <el-button
          v-else
          type="warning"
          :loading="reviewing"
          @click="doReview"
        >
          退回待审
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue"
import { learningApi, agentsApi } from "@/api"
import { toastError, toastOk } from "@/api/client"
import { fromNow, truncate } from "@/utils/format"
import type { AgentLearning, AgentItem, LearningOverview } from "@/api/types"
import FeedbackQueue from '@/components/FeedbackQueue.vue'

/*
 * 声明组件名，供 <keep-alive :include> 匹配（约定与路由 name 一致）。
 * 不声明的话缓存会静默失效：切走再回来仍会重建组件、重新拉数据。
 */
defineOptions({ name: "admin-learning" })

const overview = ref<LearningOverview | null>(null)
const items = ref<AgentLearning[]>([])
const loading = ref(false)
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const filterStatus = ref("PENDING")
const filterAgentId = ref("")
const days = ref(7)
const agentOptions = ref<AgentItem[]>([])

const reviewVisible = ref(false)
const reviewItem = ref<AgentLearning | null>(null)
const reviewAction = ref<"APPROVED" | "REJECTED" | "PENDING">("APPROVED")
const reviewInstruction = ref("")
const reviewKind = ref<"CORRECTION" | "PREFERENCE" | "FAQ">("PREFERENCE")
const reviewing = ref(false)
const pinAnswer=ref(false),fixedAnswer=ref('')

const reviewTitle = {
  APPROVED: "审核通过",
  REJECTED: "否决",
  PENDING: "退回待审"
}

onMounted(async () => {
  await Promise.all([loadOverview(), loadData(), loadAgents()])
})

async function loadOverview() {
  try {
    overview.value = await learningApi.overview(days.value)
  } catch (err) {
    toastError(err, "加载概览失败")
  }
}

async function loadData() {
  loading.value = true
  try {
    const res = await learningApi.list({
      agentId: filterAgentId.value || undefined,
      status: filterStatus.value || undefined,
      page: page.value,
      pageSize: pageSize.value
    })
    items.value = res.items
    total.value = res.total
  } catch (err) {
    toastError(err, "加载列表失败")
  } finally {
    loading.value = false
  }
}

async function loadAgents() {
  try {
    agentOptions.value = await agentsApi.list()
  } catch {
    // ignore
  }
}

function openReview(item: AgentLearning, action: "APPROVED" | "REJECTED" | "PENDING") {
  reviewItem.value = item
  reviewAction.value = action
  reviewInstruction.value = item.instruction
  reviewKind.value = item.kind
  pinAnswer.value=false;fixedAnswer.value=String(item.evidence?.correction || '')
  reviewVisible.value = true
}

async function doReview() {
  if (!reviewItem.value) return
  reviewing.value = true
  try {
    await learningApi.review(reviewItem.value.id, {
      status: reviewAction.value as "APPROVED" | "REJECTED",
      instruction: reviewInstruction.value.trim(),
      kind: reviewKind.value
      ,pinAnswer:pinAnswer.value,fixedAnswer:fixedAnswer.value
    })
    toastOk("审核完成")
    reviewVisible.value = false
    await Promise.all([loadOverview(), loadData()])
  } catch (err) {
    toastError(err, "审核失败")
  } finally {
    reviewing.value = false
  }
}

async function doRemove(id: string) {
  try {
    await learningApi.remove(id)
    toastOk("已删除")
    await Promise.all([loadOverview(), loadData()])
  } catch (err) {
    toastError(err, "删除失败")
  }
}

function kindLabel(kind: string) {
  return { CORRECTION: "纠正", PREFERENCE: "偏好", FAQ: "常见问题" }[kind] || kind
}

function kindTagType(kind: string): "" | "success" | "warning" | "danger" | "info" {
  return ({ CORRECTION: "danger", PREFERENCE: "warning", FAQ: "info" }[kind] || "") as "" | "success" | "warning" | "danger" | "info"
}

function statusLabel(status: string) {
  return { PENDING: "待审", APPROVED: "通过", REJECTED: "否决" }[status] || status
}

function statusTagType(status: string): "" | "success" | "warning" | "danger" | "info" {
  return ({ PENDING: "warning", APPROVED: "success", REJECTED: "danger" }[status] || "") as "" | "success" | "warning" | "danger" | "info"
}
</script>

<style scoped>
.learning-admin {
  padding: 0;
}

.overview-row {
  margin-bottom: 16px;
}

.stat-card {
  background: var(--cg-card-bg);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 16px;
  text-align: center;
  margin-bottom: 12px;
}

.stat-value {
  font-size: 24px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.stat-rate {
  font-size: 14px;
  color: var(--el-text-color-secondary);
  font-weight: normal;
}

.stat-label {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
}

.stat-card.pending .stat-value {
  color: var(--el-color-warning);
}

.stat-card.approved .stat-value {
  color: var(--el-color-success);
}

.stat-card.rejected .stat-value,
.stat-card.negative .stat-value {
  color: var(--el-color-danger);
}

.top-agents-card {
  margin-bottom: 16px;
}

.top-agents {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

.top-agent-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.agent-name {
  font-size: 13px;
}

.list-card {
  margin-bottom: 16px;
}

.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.list-header-left {
  display: flex;
  gap: 12px;
}

.agent-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.instruction-cell {
  font-size: 13px;
}

.instruction-text {
  line-height: 1.5;
  margin-bottom: 4px;
}

.instruction-question {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 4px;
}

.instruction-meta {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  display: flex;
  gap: 12px;
}

.pagination-wrap {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}

.review-body {
  padding: 0 4px;
}

.review-info {
  background: var(--el-fill-color-lighter);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 20px;
}

.review-info-row {
  margin-bottom: 12px;
  font-size: 13px;
  line-height: 1.6;
}

.review-info-row:last-child {
  margin-bottom: 0;
}

.review-label {
  color: var(--el-text-color-secondary);
  margin-right: 8px;
}

.review-evidence {
  margin: 8px 0 0;
  padding: 12px;
  background: var(--cg-card-bg);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.5;
  max-height: 200px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
