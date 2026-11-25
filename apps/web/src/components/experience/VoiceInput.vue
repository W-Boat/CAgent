<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Close, Microphone } from '@element-plus/icons-vue'
import { request, toastError } from '@/api/client'

const props = defineProps<{ maxSeconds: number; disabled?: boolean; holdTarget?: HTMLTextAreaElement }>()
const emit = defineEmits<{ transcript: [text: string] }>()
const state = ref<'idle'|'setup'|'recording'|'processing'>('idle')
const holding = ref(false)
let holdTimer: ReturnType<typeof setTimeout> | undefined
let touchId: number | undefined, holdOrigin: { x: number; y: number } | undefined
let suppressClick = false, suppressEditorClick = false, attempt = 0
let context: AudioContext | undefined, stream: MediaStream | undefined, processor: ScriptProcessorNode | undefined
let stopAt: ReturnType<typeof setTimeout> | undefined, active = true
let source: MediaStreamAudioSourceNode | undefined, mute: GainNode | undefined
let chunks: Float32Array[] = [], captured = 0
const abort = new AbortController()
const canCancel = computed(() => state.value === 'setup' || state.value === 'recording')
const statusText = computed(() => state.value === 'recording' ? '正在录音' : state.value === 'processing' ? '正在转写' : '准备录音')

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
function cancelRecording() {
  attempt++
  cleanup()
  chunks = []
  captured = 0
  state.value = 'idle'
}
function tap(event: MouseEvent) {
  if (suppressClick && event.detail > 0) { suppressClick=false;return }
  if (canCancel.value) cancelRecording()
  else void start()
}
function press(event: PointerEvent, editor = false) {
  if (editor) suppressEditorClick = false
  else suppressClick = false
  if (event.pointerType === 'mouse' || !event.isPrimary || touchId !== undefined || state.value !== 'idle' || props.disabled) return
  touchId = event.pointerId
  holdOrigin = { x: event.clientX, y: event.clientY }
  const target = event.currentTarget as HTMLElement
  holdTimer = setTimeout(() => {
    if (props.disabled) return
    holding.value = true
    if (editor) {
      suppressEditorClick = true
      target.blur()
    } else {
      suppressClick = true
    }
    target.setPointerCapture?.(event.pointerId)
    void start()
  }, editor ? 380 : 220)
}
function release(event: PointerEvent, cancelled = false) {
  if (event.pointerId !== touchId) return
  clearTimeout(holdTimer)
  touchId = undefined
  holdOrigin = undefined
  if (!holding.value) return
  holding.value = false
  if (state.value === 'recording' && !cancelled) void finish()
  else if (canCancel.value) cancelRecording()
}
watch(() => props.holdTarget, (target, _, onCleanup) => {
  if (!target) return
  const listeners = new AbortController()
  const options = { signal: listeners.signal }
  target.addEventListener('pointerdown', event => press(event, true), options)
  target.addEventListener('pointermove', event => {
    if (event.pointerId === touchId && !holding.value && holdOrigin &&
        Math.hypot(event.clientX - holdOrigin.x, event.clientY - holdOrigin.y) > 10) {
      release(event, true)
    }
  }, options)
  target.addEventListener('pointerup', event => release(event), options)
  target.addEventListener('pointercancel', event => release(event, true), options)
  target.addEventListener('lostpointercapture', event => release(event, true), options)
  target.addEventListener('contextmenu', event => {
    if (holding.value && suppressEditorClick) event.preventDefault()
  }, options)
  target.addEventListener('click', event => {
    if (!suppressEditorClick || event.detail === 0) return
    suppressEditorClick = false
    event.preventDefault()
    target.blur()
  }, { ...options, capture: true })
  onCleanup(() => {
    listeners.abort()
    if (touchId === undefined) return
    clearTimeout(holdTimer)
    touchId = undefined
    holdOrigin = undefined
    if (!holding.value) return
    holding.value = false
    if (canCancel.value) cancelRecording()
  })
}, { immediate: true })
onBeforeUnmount(() => { active = false;clearTimeout(holdTimer);abort.abort();cleanup() })
</script>

<template>
  <div class="voice-control">
    <button class="nx-icon-btn voice-input" type="button" :class="{ recording: canCancel, holding }"
      :disabled="state === 'processing' || (disabled && state === 'idle')"
      :aria-label="canCancel ? '取消录音' : '语音输入'"
      :title="canCancel ? '取消录音' : state === 'processing' ? '正在转写' : '点击录音，手机端可长按输入框'"
      @click="tap" @contextmenu.prevent @pointerdown="press($event)" @pointerup="release($event)" @pointercancel="release($event,true)" @lostpointercapture="release($event,true)">
      <el-icon><Close v-if="canCancel&&!holding"/><Microphone v-else/></el-icon>
    </button>
    <span v-if="state==='idle'&&!holding" class="voice-touch-hint" aria-hidden="true">长按输入框说话</span>
    <Transition name="voice-feedback">
      <div v-if="state !== 'idle' || holding" class="voice-panel">
        <div class="voice-meter" :class="{'is-recording':state==='recording'}" aria-hidden="true"><i/><i/><i/><i/><i/></div>
        <div class="voice-state" role="status">
          <strong>{{statusText}}</strong>
          <small v-if="holding">松开转写</small>
          <small v-else-if="canCancel">再点麦克风可取消</small>
        </div>
        <button v-if="state==='recording'&&!holding" class="nx-btn nx-btn-primary voice-transcribe" type="button" @click="finish">转写</button>
      </div>
    </Transition>
  </div>
</template>
<style scoped>
.voice-control{position:relative;display:flex;align-items:center;gap:4px}
.voice-input{touch-action:none;user-select:none;-webkit-touch-callout:none;transition:transform .14s ease,background .18s ease}
.voice-input.holding{transform:scale(.92)}
.voice-input.recording{color:var(--nx-danger);background:var(--nx-danger-soft)}
.voice-touch-hint{display:none;color:var(--nx-text-2);font-size:10px;white-space:nowrap}
.voice-panel{position:absolute;z-index:5;inset-inline-start:0;bottom:calc(100% + 10px);display:flex;align-items:center;gap:10px;width:max-content;max-width:calc(100vw - 48px);padding:9px 10px;border:1px solid var(--nx-border);border-radius:12px;background:var(--nx-surface);box-shadow:0 6px 20px #0002}
.voice-meter{display:flex;align-items:center;gap:3px;height:24px;color:var(--nx-text-2)}
.voice-meter i{width:3px;height:5px;border-radius:999px;background:currentColor}
.voice-meter.is-recording{color:var(--nx-danger)}
.voice-meter.is-recording i{animation:voice-meter .7s ease-in-out infinite alternate}
.voice-meter.is-recording i:nth-child(2n){animation-delay:-.34s}
.voice-meter.is-recording i:nth-child(3n){animation-delay:-.53s}
.voice-state{display:grid;gap:2px;font-size:12px;color:var(--nx-text);white-space:nowrap}
.voice-state small{color:var(--nx-text-2);font-size:10px}
.voice-transcribe{padding:4px 9px;min-height:28px;font-size:12px}
.voice-feedback-enter-active,.voice-feedback-leave-active{transition:opacity .14s ease,transform .18s ease}
.voice-feedback-enter-from,.voice-feedback-leave-to{opacity:0;transform:translateY(4px)}
@keyframes voice-meter{to{transform:scaleY(3.6)}}
@media(pointer:coarse) and (min-width:350px){.voice-touch-hint{display:inline}}
@media(prefers-reduced-motion:reduce){
  .voice-input,.voice-feedback-enter-active,.voice-feedback-leave-active{transition:none}
  .voice-meter.is-recording i{animation:none}
  .voice-meter.is-recording i:nth-child(2n){transform:scaleY(2.4)}
}
</style>
