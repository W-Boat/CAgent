<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { Headset, VideoPause } from '@element-plus/icons-vue'
import { http, toastError } from '@/api/client'
import { createAnswerProjector } from '@/utils/answer-projector'
import { uiContentText } from '@/utils/agent-ui'

const props = defineProps<{ content: string; maxChars: number }>()
const state = ref<'idle'|'loading'|'ready'|'playing'>('idle')
let audio: HTMLAudioElement | undefined, url = '', controller: AbortController | undefined
function stop() {
  controller?.abort()
  controller = undefined
  audio?.pause()
  audio = undefined
  if (url) URL.revokeObjectURL(url)
  url = ''; state.value = 'idle'
}
function speechText() {
  return createAnswerProjector().project(props.content, false, new Set(), true)
    .map(item => item.kind === 'markdown' ? item.text : item.kind === 'card' ? uiContentText(item.card) : '')
    .join('\n\n').trim().slice(0, props.maxChars)
}
async function toggle() {
  if (state.value === 'ready' && audio) {
    try { await audio.play(); if (audio) state.value = 'playing' }
    catch (error) { toastError(error, '无法播放音频') }
    return
  }
  if (state.value !== 'idle') return stop()
  const text = speechText()
  if (!text) return
  window.dispatchEvent(new Event('cagent:stop-voice'))
  const request = new AbortController()
  controller = request
  state.value = 'loading'
  try {
    const { data } = await http.post<Blob>('/experience/voice/tts', { text }, { responseType: 'blob', timeout: 95_000, signal: request.signal })
    if (request.signal.aborted) return
    url = URL.createObjectURL(data)
    audio = new Audio(url)
    audio.onended = stop
    audio.onerror = stop
    try {
      await audio.play()
      if (!request.signal.aborted) state.value = 'playing'
    } catch (error) {
      if ((error as Error).name !== 'NotAllowedError') throw error
      if (!request.signal.aborted) state.value = 'ready'
    }
  } catch (error) {
    if (request.signal.aborted) return
    stop()
    const data = (error as { response?: { data?: unknown } })?.response?.data
    if (data instanceof Blob) {
      const value = await data.text().then(JSON.parse).catch(() => null)
      if (typeof value?.message === 'string') { toastError(new Error(value.message)); return }
    }
    toastError(error, '语音播报失败')
  }
}
watch(() => props.content, stop)
window.addEventListener('cagent:stop-voice', stop)
onBeforeUnmount(() => { window.removeEventListener('cagent:stop-voice', stop); stop() })
</script>
<template>
  <button type="button" class="nx-icon-btn" :class="{ 'is-on': state !== 'idle' }"
    :title="state === 'loading' ? '取消准备播报' : state === 'playing' ? '停止播报' : state === 'ready' ? '播放已生成的语音' : '朗读回答'"
    :aria-label="state === 'loading' ? '取消准备播报' : state === 'playing' ? '停止播报' : state === 'ready' ? '播放已生成的语音' : '朗读回答'" @click="toggle">
    <el-icon><VideoPause v-if="state !== 'idle'" /><Headset v-else /></el-icon>
  </button>
</template>
