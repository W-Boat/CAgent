<script setup lang="ts">
import type {AgentRunProgress,AgentRunMetrics} from '@/api/chat-stream'
import {cleanAnswerReferences} from '@/utils/answer-references'
import {stripToolMarkup} from '@/utils/output-boundary'
const props=defineProps<{progress?:AgentRunProgress;metrics?:AgentRunMetrics;tools?:{id:string;name:string;state:string;args?:unknown;result?:string;cached?:boolean;durationMs?:number}[];status?:string;detailed?:boolean}>()
const phases={preparing:'正在准备',context:'正在整理上下文',model:'正在生成回答',tools:'正在查询与处理',retrying:'输出格式异常，正在自动重试',finalizing:'正在整理结果'}
const phaseLabel=()=>props.progress?.retryAttempt&&['context','model','retrying'].includes(props.progress.stage)?'输出格式异常，正在自动重试':phases[props.progress?.stage||'preparing']
const toolNames:Record<string,string>={knowledge_search:'查询知识库',skill_read:'读取任务指引',calculator:'计算',weather:'查询天气',web_fetch:'读取网页',browser_control:'查看网页',datetime:'查询时间',unit_convert:'换算单位',exchange_rate:'查询汇率'}
const states:Record<string,string>={running:'执行中',done:'已完成',failed:'失败',stopped:'已停止'}
</script>
<template>
 <div v-if="progress || metrics || tools?.length" class="agent-run" :class="{ 'is-active': status === 'STREAMING' }">
  <div v-if="status === 'STREAMING' && progress" class="agent-phase-wrap"><p class="agent-phase" role="status"><span class="agent-dot" aria-hidden="true"></span>{{ phaseLabel() }}<span v-if="detailed && progress.round">· 第 {{ progress.round }} 轮</span></p><div class="agent-progress-track" role="progressbar" :aria-label="phaseLabel()" :aria-valuetext="phaseLabel()"><span/></div></div>
  <p v-if="status !== 'STREAMING' && metrics?.cacheHit" class="agent-note">已复用服务器回答缓存 · 本轮未调用模型</p>
  <details v-if="tools?.length || (detailed && metrics)" class="agent-trace">
   <summary>查询与处理过程<span v-if="tools?.length">（{{ tools.length }}）</span></summary>
   <div v-for="tool in tools" :key="tool.id" class="agent-tool" :class="{ 'is-error': tool.state === 'failed' }">
    <div class="agent-tool-line"><span>{{ toolNames[tool.name] || (detailed ? tool.name : '使用辅助工具') }}</span><span>{{ states[tool.state] || '已完成' }}<template v-if="tool.cached"> · 复用本轮结果</template><template v-if="detailed && tool.durationMs !== undefined"> · {{ tool.durationMs }} ms</template></span></div>
    <pre v-if="detailed && tool.args">{{ stripToolMarkup(JSON.stringify(tool.args)) }}</pre><pre v-if="detailed && tool.result">{{ stripToolMarkup(cleanAnswerReferences(tool.result)).slice(0,1600) }}</pre>
   </div>
   <dl v-if="detailed && metrics" class="agent-metrics"><div><dt>模型轮次</dt><dd>{{ metrics.modelTurns }}</dd></div><div><dt>工具调用 / 复用</dt><dd>{{ metrics.toolCalls }} / {{ metrics.cachedCalls }}</dd></div><div><dt>工具失败</dt><dd>{{ metrics.failedTools }}</dd></div><div><dt>历史裁剪轮次</dt><dd>{{ metrics.removedTurns }}</dd></div><div><dt>峰值输入估算</dt><dd>{{ metrics.peakInputTokens }} token</dd></div><div><dt>耗时</dt><dd>{{ (metrics.latencyMs/1000).toFixed(1) }} 秒</dd></div><div v-if="metrics.nodeTransitions !== undefined"><dt>节点执行 / 检查点写入</dt><dd>{{ metrics.nodeTransitions }} / {{ metrics.checkpointWrites || 0 }}</dd></div></dl>
   <p v-if="detailed && metrics?.limitReached" class="agent-note">已达到工具预算，最后一轮依据现有结果完成回答。</p>
   <p v-if="status !== 'STREAMING' && metrics?.automaticRetries" class="agent-note">已自动重试 {{ metrics.automaticRetries }} 次，调用用量已计入本轮。</p>
  </details>
 </div>
</template>
<style scoped>
.agent-progress-track{height:3px;max-width:240px;overflow:hidden;border-radius:6px;background:var(--nx-surface-2,var(--el-fill-color-light));margin:7px 0 10px}.agent-progress-track span{display:block;width:38%;height:100%;border-radius:inherit;background:var(--nx-accent,var(--el-color-primary));animation:agent-scan 2.2s cubic-bezier(.45,0,.55,1) infinite}@keyframes agent-scan{from{transform:translateX(-110%)}to{transform:translateX(365%)}}@media(prefers-reduced-motion:reduce){.agent-progress-track span{animation:none;width:100%;opacity:.45}}
.agent-run{margin:8px 0;color:var(--nx-text-2,var(--el-text-color-regular));font-size:12px;line-height:1.6}.agent-phase{display:flex;gap:7px;align-items:center;margin:4px 0}.agent-dot{width:6px;height:6px;background:var(--nx-accent,var(--el-color-primary));border-radius:50%;animation:agent-pulse 1.4s ease infinite}.agent-trace{border:1px solid var(--nx-line,var(--el-border-color));border-radius:8px;padding:8px 10px;background:var(--nx-surface,var(--el-bg-color))}.agent-trace summary{cursor:pointer;user-select:none}.agent-tool{padding:8px 0;border-bottom:1px solid var(--nx-line,var(--el-border-color))}.agent-tool-line{display:flex;gap:12px;justify-content:space-between;flex-wrap:wrap}.is-error{color:var(--nx-danger,var(--el-color-danger))}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-family:inherit;margin:5px 0;max-height:180px;overflow:auto}.agent-metrics{display:flex;gap:12px 24px;flex-wrap:wrap;margin:10px 0 0}.agent-metrics div{display:flex;gap:8px}.agent-metrics dt{color:var(--nx-text-3,var(--el-text-color-secondary))}.agent-metrics dd{margin:0;font-variant-numeric:tabular-nums}.agent-note{margin-bottom:0}@keyframes agent-pulse{50%{opacity:.35}}@media(prefers-reduced-motion:reduce){.agent-dot{animation:none}}
</style>
