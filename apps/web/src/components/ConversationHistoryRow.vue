<script setup lang="ts">
import {Check,MoreFilled,Star} from '@element-plus/icons-vue'
defineProps<{title?:string|null;active:boolean;editing:boolean;selected?:boolean;pinned?:boolean}>()
const emit=defineEmits<{select:[];command:[value:string]}>()
</script>

<template>
  <div class="history-row" :class="{'is-active':active,'is-selected':selected}">
    <button class="history-title" type="button" :title="title||'未命名对话'" :aria-current="active&&!editing?'page':undefined" :aria-pressed="editing?!!selected:undefined" @click="emit('select')">
      <span v-if="editing" class="history-check" aria-hidden="true"><el-icon v-if="selected"><Check/></el-icon></span>
      <el-icon v-else-if="pinned" class="history-pin"><Star/></el-icon>
      <span>{{title||'未命名对话'}}</span>
    </button>
    <el-dropdown v-if="!editing" class="history-actions" trigger="click" placement="bottom-end" @command="emit('command',$event)">
      <button type="button" class="nx-icon-btn history-more" :aria-label="(title||'未命名对话')+' · 会话操作'" title="会话操作"><el-icon><MoreFilled/></el-icon></button>
      <template #dropdown><el-dropdown-menu><slot/></el-dropdown-menu></template>
    </el-dropdown>
  </div>
</template>

<style scoped>
.history-row{display:flex;align-items:center;gap:3px;box-sizing:border-box;height:34px;margin:1px 0;padding:0 5px 0 2px;border:1px solid transparent;border-radius:999px;transition:background .14s ease,border-color .14s ease}
.history-row:hover,.history-row:focus-within{background:var(--nx-surface-hover)}.history-row.is-active,.history-row.is-selected{background:var(--nx-accent-soft);border-color:var(--nx-accent-border)}
.history-title{min-width:0;flex:1;display:flex;align-items:center;gap:6px;padding:0 8px;height:100%;text-align:left;color:var(--nx-text);border:0;border-radius:999px;background:none;font:inherit;font-size:12.5px;cursor:pointer}.history-title>span:last-child{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.history-title:focus-visible{outline:2px solid var(--nx-accent);outline-offset:-2px}.is-active .history-title,.is-selected .history-title,.history-pin{color:var(--nx-accent)}.is-active .history-title{font-weight:650}
.history-actions{opacity:0;transition:opacity .15s ease}.history-row:is(:hover,:focus-within) .history-actions,.history-actions:has([aria-expanded=true]){opacity:1}.history-more{width:26px;height:26px;border-radius:999px}.history-more:focus-visible{outline:2px solid var(--nx-accent)}
.history-check{display:grid;width:14px;height:14px;flex:none;border-radius:4px;place-items:center;border:1px solid var(--nx-border-strong);color:var(--nx-text-invert)}.is-selected .history-check{background:var(--nx-accent);border-color:var(--nx-accent)}
@media(hover:none){.history-row.is-active .history-actions{opacity:1}}
@media(prefers-reduced-motion:reduce){.history-row,.history-actions{transition:none}}
</style>
