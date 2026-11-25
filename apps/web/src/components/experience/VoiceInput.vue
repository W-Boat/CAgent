<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { Microphone, VideoPause } from '@element-plus/icons-vue'
import { request, toastError } from '@/api/client'

const props = defineProps<{ maxSeconds: number; disabled?: boolean }>()
const emit = defineEmits<{ transcript: [text: string] }>()
const state = ref<'idle'|'setup'|'recording'|'processing'>('idle')
const holding = ref(false)
let holdTimer: ReturnType<typeof setTimeout> | undefined
let touchId: number | undefined, suppressClick = false, attempt = 0
let context: AudioContext | undefined, stream: MediaStream | undefined, processor: ScriptProcessorNode | undefined
let stopAt: ReturnType<typeof setTimeout> | undefined, active = true
let source: MediaStreamAudioSourceNode | undefined, mute: GainNode | undefined
let chunks: Float32Array[] = [], captured = 0
const abort = new AbortController()

function cleanup() {
  if (stopAt) clearTimeout(stopAt)
  if (processor) { processor.onaudioprocess = null; processor.disconnect() }
  source?.disconnect()
  mute?.disconnect()
  stream?.getTracks().forEach(track => track.stop())
  if (context && context.state !== 'closed') void context.close().catch(() => undefined)
  stream = undefined; processor = undefined; context = undefined; source = undefined; mute = undefined
}
function wave(samples: Float32Array[], sampleRate: number): Blob {
  const input = new Float32Array(captured)
  let index = 0
  for (const chunk of samples) { input.set(chunk, index); index += chunk.length }
  const rate = 16000, count = Math.floor(input.length * rate / sampleRate)
  const output = new DataView(new ArrayBuffer(44 + count * 2))
  const write = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) output.setUint8(offset + i, value.charCodeAt(i)) }
  write(0, 'RIFF'); output.setUint32(4, 36 + count * 2, true); write(8, 'WAVEfmt ')
  output.setUint32(16, 16, true); output.setUint16(20, 1, true); output.setUint16(22, 1, true)
  output.setUint32(24, rate, true); output.setUint32(28, rate * 2, true); output.setUint16(32, 2, true); output.setUint16(34, 16, true)
  write(36, 'data'); output.setUint32(40, count * 2, true)
  const ratio = sampleRate / rate
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * ratio), end = Math.max(start + 1, Math.floor((i + 1) * ratio))
    let sum = 0
    for (let j = start; j < end; j++) sum += input[j]
    output.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sum / (end - start))) * 32767, true)
  }
  return new Blob([output.buffer], { type: 'audio/wav' })
}
async function finish() {
  if (state.value !== 'recording') return
  state.value = 'processing'
  const rate = context?.sampleRate || 48000
  cleanup()
  try {
    if (captured < rate * 0.25) throw new Error('录音太短，请重试')
    const form = new FormData()
    form.append('file', wave(chunks, rate), 'voice.wav')
    const data = await request<{ text: string }>({ method: 'POST', url: '/experience/voice/asr', data: form, timeout: 95_000, signal: abort.signal })
    if (!data.text.trim()) throw new Error('没有识别到讲话，请再试一次')
    if (active) emit('transcript', data.text.trim())
  } catch (error) {
    if (active) toastError(error, '语音转写失败')
  } finally {
    chunks = []; captured = 0; state.value = 'idle'
  }
}
async function start() {
  if (state.value !== 'idle' || props.disabled) return
  if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) return toastError(new Error('请在 HTTPS 或本机地址打开页面，允许使用麦克风'))
  state.value = 'setup'
  const attemptId = ++attempt
  try {
    context = new AudioContext()
    void context.resume().catch(() => undefined)
    const obtained = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } })
    if (!active || attemptId !== attempt || !context) { obtained.getTracks().forEach(track => track.stop()); return }
    stream = obtained
    source = context.createMediaStreamSource(obtained)
    processor = context.createScriptProcessor(4096, 1, 1)
    mute = context.createGain()
    mute.gain.value = 0
    const cap = Math.floor(context.sampleRate * props.maxSeconds)
    processor.onaudioprocess = event => {
      const samples = event.inputBuffer.getChannelData(0).slice(0, cap - captured)
      chunks.push(samples); captured += samples.length
      if (captured >= cap) void finish()
    }
    source.connect(processor); processor.connect(mute); mute.connect(context.destination)
    state.value = 'recording'
    stopAt = setTimeout(finish, props.maxSeconds * 1000)
  } catch {
    if (attemptId !== attempt) return
    cleanup(); state.value = 'idle'
    if (active) toastError(new Error('无法使用麦克风，请检查浏览器权限'))
  }
}
function tap(event:MouseEvent) {
  if (suppressClick && event.detail > 0) { suppressClick=false;return }
  if (state.value==='recording') void finish()
  else void start()
}
function press(event:PointerEvent) {
  if (event.pointerType==='mouse') { suppressClick=false;return }
  if (touchId!==undefined || state.value!=='idle' || props.disabled) return
  suppressClick=true;touchId=event.pointerId;holding.value=true
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
  holdTimer=setTimeout(()=>void start(),220)
}
function release(event:PointerEvent, cancelled=false) {
  if (event.pointerId!==touchId) return
  clearTimeout(holdTimer);touchId=undefined;holding.value=false
  if (state.value==='recording' && !cancelled) {void finish();return}
  if (state.value==='setup' || state.value==='recording') {
    attempt++;cleanup();chunks=[];captured=0;state.value='idle'
  }
}
onBeforeUnmount(() => { active = false;clearTimeout(holdTimer);abort.abort();cleanup() })
</script>

<template>
  <button class="nx-icon-btn voice-input" type="button" :class="{ recording: state === 'recording', holding }"
    :disabled="state === 'processing' || (disabled && state === 'idle')"
    :aria-label="state === 'recording' ? '结束录音并转写' : '语音输入'"
    :title="state === 'recording' ? '结束录音并转写' : state === 'processing' ? '正在转写' : '手机端长按说话'"
    @click="tap" @contextmenu.prevent @pointerdown="press" @pointerup="release($event)" @pointercancel="release($event,true)" @lostpointercapture="release($event,true)">
    <el-icon><VideoPause v-if="state === 'recording'" /><Microphone v-else /></el-icon>
  </button>
  <Transition name="voice-feedback"><span v-if="state !== 'idle' || holding" class="voice-state" role="status">{{ state === 'recording' ? (holding ? '松开转写' : '录音中') : state === 'processing' ? '正在转写' : '准备录音' }}</span></Transition>
</template>
<style scoped>
.voice-input{touch-action:none;user-select:none;-webkit-touch-callout:none;transition:transform .14s ease,background .18s ease}.voice-input.holding{transform:scale(.92)}.voice-input.recording{color:var(--nx-danger);background:var(--nx-danger-soft)}.voice-state{font-size:12px;color:var(--nx-text-2);white-space:nowrap}.voice-feedback-enter-active,.voice-feedback-leave-active{transition:opacity .13s ease,transform .18s ease}.voice-feedback-enter-from,.voice-feedback-leave-to{opacity:0;transform:translateY(3px)}@media(prefers-reduced-motion:reduce){.voice-input,.voice-feedback-enter-active,.voice-feedback-leave-active{transition:none}}
</style>
