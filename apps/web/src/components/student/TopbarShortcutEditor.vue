<script lang="ts">
export type TopbarLayout = { order: string[]; pinned: string[]; hidden: string[] }
</script>

<script setup lang="ts">
import {computed, onBeforeUnmount, ref, type Component} from 'vue'
import {ArrowDown, ArrowUp, Grid, MoreFilled, Rank, Star} from '@element-plus/icons-vue'

type Shortcut = {id: string; label: string; icon: Component}
type Zone = 'top' | 'menu'
type Drop = {zone: Zone; index: number}
type Drag = {id: string; pointer: number; x: number; y: number}

const props = defineProps<{items: Shortcut[]; limit: number}>()
const layout = defineModel<TopbarLayout>({required: true})
const board = ref<HTMLElement>()
const dragging = ref<Drag>()
const target = ref<Drop>()
const feedback = ref('')
let start: Drag | undefined
let frame = 0

const visible = computed(() => props.items.filter(item => !layout.value.hidden.includes(item.id)))
const hidden = computed(() => props.items.filter(item => layout.value.hidden.includes(item.id)))
const groups = computed(() => ({
  top: visible.value.filter(item => layout.value.pinned.includes(item.id)),
  menu: visible.value.filter(item => !layout.value.pinned.includes(item.id)),
}))
const zones = [
  {id: 'top', label: '顶栏', icon: Star, hint: '直接显示在对话顶栏'},
  {id: 'menu', label: '校园功能菜单', icon: Grid, hint: '点击「校园功能」后显示'},
] as const
const moving = computed(() => props.items.find(item => item.id === dragging.value?.id))
const full = computed(() => groups.value.top.length >= props.limit)
const blocked = computed(() => target.value?.zone === 'top' && !!moving.value && !canPin(moving.value.id))
const before = computed(() => {
  if (!target.value || !dragging.value || blocked.value) return
  const {zone, index} = target.value
  return groups.value[zone].filter(item => item.id !== dragging.value?.id)[index]?.id
})

function canPin(id: string) {
  return !full.value || groups.value.top.some(item => item.id === id)
}

function place(id: string, zone: Zone | 'hidden', index?: number) {
  if (zone === 'top' && !canPin(id)) {
    feedback.value = '顶栏已满，请先移出一个入口。'
    return
  }
  const item = props.items.find(row => row.id === id)
  if (!item) return
  const top = groups.value.top.map(row => row.id).filter(key => key !== id)
  const menu = groups.value.menu.map(row => row.id).filter(key => key !== id)
  const inactive = layout.value.hidden.filter(key => key !== id)
  if (zone === 'hidden') inactive.push(id)
  else {
    const list = zone === 'top' ? top : menu
    list.splice(index ?? list.length, 0, id)
  }
  const available = new Set(props.items.map(row => row.id))
  const hiddenPins = layout.value.pinned.filter(key => !available.has(key))
  layout.value = {
    order: [...top, ...menu, ...inactive, ...layout.value.order.filter(key => !available.has(key) && !inactive.includes(key))],
    pinned: [...top, ...hiddenPins].slice(0, props.limit),
    hidden: inactive,
  }
  const destination = zone === 'top' ? '顶栏' : zone === 'menu' ? '校园功能菜单' : '停用区'
  feedback.value = `${item.label}已移到${destination}。`
}

function shift(id: string, zone: Zone, delta: number) {
  const index = groups.value[zone].findIndex(item => item.id === id) + delta
  if (index >= 0 && index < groups.value[zone].length) place(id, zone, index)
}

function command(value: unknown, id: string, zone: Zone) {
  if (value === 'up' || value === 'down') shift(id, zone, value === 'up' ? -1 : 1)
  if (value === 'top' || value === 'menu' || value === 'hidden') place(id, value)
}

function pointerDown(event: PointerEvent, id: string) {
  if (!event.isPrimary || event.button !== 0) return
  const handle = event.currentTarget as HTMLElement
  handle.setPointerCapture(event.pointerId)
  start = {id, pointer: event.pointerId, x: event.clientX, y: event.clientY}
}

function updateDrop() {
  const drag = dragging.value
  if (!drag) return
  const hit = document.elementFromPoint(drag.x, drag.y)?.closest<HTMLElement>('[data-topbar-zone]')
  const zone = hit?.dataset.topbarZone as Zone | undefined
  if (!hit || !zone || !board.value?.contains(hit)) {
    target.value = undefined
    return
  }
  const rows = [...hit.querySelectorAll<HTMLElement>('[data-shortcut]')].filter(row => row.dataset.shortcut !== drag.id)
  const index = rows.findIndex(row => {
    const bounds = row.getBoundingClientRect()
    return drag.y < bounds.top + bounds.height / 2
  })
  target.value = {zone, index: index < 0 ? rows.length : index}
}

function autoScroll() {
  frame = 0
  const drag = dragging.value
  if (!drag) return
  const list = document.elementFromPoint(drag.x, drag.y)?.closest<HTMLElement>('.topbar-zone-items')
  if (!list || !board.value?.contains(list)) return
  const bounds = list.getBoundingClientRect()
  const previous = list.scrollTop
  if (drag.y < bounds.top + 22) list.scrollTop -= 7
  if (drag.y > bounds.bottom - 22) list.scrollTop += 7
  if (list.scrollTop !== previous) {
    updateDrop()
    frame = requestAnimationFrame(autoScroll)
  }
}

function pointerMove(event: PointerEvent) {
  if (start?.pointer !== event.pointerId) return
  const {clientX: x, clientY: y} = event
  if (!dragging.value && Math.hypot(x - start.x, y - start.y) < 5) return
  dragging.value = {...start, x, y}
  updateDrop()
  if (!frame) frame = requestAnimationFrame(autoScroll)
}

function finish(event: PointerEvent, commit = false) {
  if (start?.pointer !== event.pointerId) return
  const drag = dragging.value
  if (commit && drag && target.value) place(drag.id, target.value.zone, target.value.index)
  start = undefined
  dragging.value = undefined
  target.value = undefined
  cancelAnimationFrame(frame)
  frame = 0
}

onBeforeUnmount(() => cancelAnimationFrame(frame))
</script>

<template>
  <p class="topbar-editor-help">拖动手柄排序，或把入口拖到另一区。也可用「⋯」调整。</p>
  <div ref="board" class="topbar-editor-board">
    <section v-for="zone in zones" :key="zone.id" :aria-label="zone.label" :data-topbar-zone="zone.id"
      class="topbar-zone" :class="{'is-drop-zone':target?.zone===zone.id,'is-blocked':target?.zone===zone.id&&blocked}">
      <header class="topbar-zone-header">
        <div>
          <h3><el-icon><component :is="zone.icon"/></el-icon>{{zone.label}}</h3>
          <p>{{zone.hint}}</p>
        </div>
        <span v-if="zone.id==='top'" class="topbar-zone-count">{{groups.top.length}} / {{limit}}</span>
      </header>
      <ul class="topbar-zone-items">
        <li v-for="(item,index) in groups[zone.id]" :key="item.id" :data-shortcut="item.id" class="topbar-shortcut"
          :class="{'is-dragging':dragging?.id===item.id,'insert-before':target?.zone===zone.id&&before===item.id}">
          <button type="button" class="topbar-drag" :aria-label="'拖动'+item.label" :title="'拖动'+item.label+'，或用上下键排序'"
            @pointerdown="pointerDown($event,item.id)" @pointermove="pointerMove"
            @pointerup="finish($event,true)" @pointercancel="finish($event)" @lostpointercapture="finish($event)"
            @keydown.up.prevent="shift(item.id,zone.id,-1)" @keydown.down.prevent="shift(item.id,zone.id,1)">
            <el-icon><Rank/></el-icon>
          </button>
          <span class="topbar-shortcut-label"><el-icon><component :is="item.icon"/></el-icon>{{item.label}}</span>
          <el-dropdown trigger="click" placement="bottom-end" @command="command($event,item.id,zone.id)">
            <button type="button" class="topbar-row-menu" :aria-label="'调整'+item.label" :title="'调整'+item.label"><el-icon><MoreFilled/></el-icon></button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item v-if="zone.id==='top'" command="menu">移到校园功能菜单</el-dropdown-item>
                <el-dropdown-item v-else command="top" :disabled="full">移到顶栏</el-dropdown-item>
                <el-dropdown-item command="up" :icon="ArrowUp" :disabled="index===0" divided>上移</el-dropdown-item>
                <el-dropdown-item command="down" :icon="ArrowDown" :disabled="index===groups[zone.id].length-1">下移</el-dropdown-item>
                <el-dropdown-item command="hidden" divided>停用</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </li>
        <li v-if="!groups[zone.id].length" class="topbar-zone-empty">拖到这里</li>
        <li v-if="target?.zone===zone.id&&!before&&!blocked" class="topbar-insert-end" aria-hidden="true"></li>
      </ul>
    </section>
  </div>
  <p class="topbar-editor-feedback" role="status">{{blocked ? '顶栏已满，请先移出一个入口。' : feedback}}</p>
  <details v-if="hidden.length" class="topbar-inactive">
    <summary>已停用（{{hidden.length}}）</summary>
    <ul>
      <li v-for="item in hidden" :key="item.id">
        <span>{{item.label}}</span><el-button text size="small" :aria-label="'启用'+item.label" @click="place(item.id,'menu')">移回菜单</el-button>
      </li>
    </ul>
  </details>
  <div v-if="dragging&&moving" class="topbar-drag-preview" aria-hidden="true" :style="{left:dragging.x+'px',top:dragging.y+'px'}">
    <el-icon><component :is="moving.icon"/></el-icon>{{moving.label}}
  </div>
</template>

<style scoped>
.topbar-editor-help{margin:0 0 12px;color:var(--el-text-color-secondary);font-size:13px}
.topbar-editor-board{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:12px;align-items:start}
.topbar-zone{min-width:0;border:1px solid var(--el-border-color);border-radius:14px;background:var(--el-fill-color-lighter);padding:10px}
.topbar-zone.is-drop-zone{border-color:var(--el-color-primary);background:var(--el-color-primary-light-9)}
.topbar-zone.is-blocked{border-color:var(--el-color-warning);background:var(--el-color-warning-light-9)}
.topbar-zone-header{display:flex;align-items:flex-start;justify-content:space-between;gap:6px;padding:0 3px 8px}
.topbar-zone-header h3{display:flex;align-items:center;gap:6px;margin:0;color:var(--el-text-color-primary);font-size:14px}
.topbar-zone-header p{margin:4px 0 0;color:var(--el-text-color-secondary);font-size:12px}
.topbar-zone-count{border-radius:999px;background:var(--el-color-primary-light-9);color:var(--el-color-primary);padding:2px 8px;font-size:12px;white-space:nowrap}
.topbar-zone-items,.topbar-inactive ul{list-style:none;margin:0;padding:3px}
.topbar-zone-items{display:grid;gap:6px;min-height:54px;max-height:min(40dvh,295px);overflow:auto;overscroll-behavior:contain;scrollbar-width:thin}
.topbar-shortcut{position:relative;display:flex;align-items:center;gap:4px;min-height:40px;padding:0 4px;border:1px solid var(--el-border-color-lighter);border-radius:9px;background:var(--el-bg-color);color:var(--el-text-color-primary)}
.topbar-shortcut.is-dragging{opacity:.45}
.topbar-shortcut.insert-before::before{content:'';position:absolute;inset:-5px 0 auto;height:3px;border-radius:3px;background:var(--el-color-primary)}
.topbar-insert-end{height:3px;border-radius:3px;background:var(--el-color-primary)}
.topbar-shortcut-label{display:flex;align-items:center;gap:6px;flex:1;min-width:0;font-size:13px}
.topbar-shortcut-label .el-icon{flex:none;color:var(--el-text-color-secondary)}
.topbar-drag,.topbar-row-menu{display:grid;place-items:center;flex:none;width:32px;height:36px;border:0;border-radius:7px;background:transparent;color:var(--el-text-color-secondary)}
.topbar-drag{cursor:grab;touch-action:none;user-select:none}
.topbar-drag:active{cursor:grabbing}
.topbar-row-menu{cursor:pointer}
.topbar-drag:is(:hover,:focus-visible),.topbar-row-menu:is(:hover,:focus-visible){background:var(--el-color-primary-light-9);color:var(--el-color-primary)}
.topbar-zone-empty{display:grid;place-items:center;min-height:46px;border:1px dashed var(--el-border-color);border-radius:8px;color:var(--el-text-color-secondary);font-size:12px}
.topbar-editor-feedback{min-height:16px;margin:6px 0 2px;color:var(--el-text-color-secondary);font-size:12px}
.topbar-inactive{border-top:1px solid var(--el-border-color-lighter);padding-top:6px;font-size:13px}
.topbar-inactive summary{cursor:pointer;color:var(--el-text-color-secondary)}
.topbar-inactive li{display:flex;align-items:center;justify-content:space-between;gap:8px}
.topbar-drag-preview{position:fixed;z-index:1;display:flex;align-items:center;gap:7px;transform:translate(12px,-55%);pointer-events:none;white-space:nowrap;padding:7px 12px;border:1px solid var(--el-color-primary-light-5);border-radius:9px;background:var(--el-bg-color);box-shadow:var(--el-box-shadow-light);color:var(--el-color-primary)}
@media(max-width:540px){
  .topbar-editor-board{grid-template-columns:minmax(0,1fr);gap:8px}
  .topbar-zone{padding:7px}
  .topbar-zone-header{padding-bottom:6px}
  .topbar-zone-header p{display:none}
  .topbar-zone-items{max-height:min(29dvh,210px)}
  .topbar-drag,.topbar-row-menu{width:36px}
}
</style>
