<script setup lang="ts">
import {Check,Close,EditPen,Search} from '@element-plus/icons-vue'
const value=defineModel<string>({required:true})
defineProps<{editing:boolean}>()
const emit=defineEmits<{search:[];edit:[]}>()
function clear(){value.value='';emit('search')}
</script>

<template>
  <div class="conversation-search">
    <div class="conversation-search-field">
      <el-icon><Search/></el-icon>
      <input v-model="value" type="search" aria-label="搜索历史对话" placeholder="搜索历史对话" @input="emit('search')"/>
      <button v-if="value" type="button" class="nx-icon-btn" aria-label="清空搜索" @click="clear"><el-icon><Close/></el-icon></button>
    </div>
    <button type="button" class="nx-icon-btn conversation-edit" :class="{'is-on':editing}" :aria-pressed="editing" :aria-label="editing?'完成编辑':'编辑对话列表'" :title="editing?'完成编辑':'编辑对话列表'" @click="emit('edit')"><el-icon><Check v-if="editing"/><EditPen v-else/></el-icon></button>
  </div>
</template>

<style scoped>
.conversation-search {
  display: grid;
  grid-template-columns: minmax(0, 1fr) var(--history-control-height);
  align-items: center;
  gap: 5px;
  padding: 0 var(--history-control-inset) 9px;
}
.conversation-search-field {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  height: var(--history-control-height);
  padding: 0 8px;
  box-sizing: border-box;
  border: 1px solid var(--nx-border-strong);
  border-radius: var(--history-control-radius);
  background: var(--nx-surface);
  color: var(--nx-text-2);
  transition: border-color .16s ease, box-shadow .16s ease;
}
.conversation-search-field:focus-within {
  border-color: var(--nx-accent);
  box-shadow: var(--nx-focus-ring);
}
.conversation-search-field input {
  flex: 1;
  width: 100%;
  min-width: 0;
  outline: none;
  border: 0;
  background: none;
  color: var(--nx-text);
  font: inherit;
  font-size: 12px;
}
.conversation-search-field input::placeholder { color: var(--nx-text-2); }
.conversation-search-field input::-webkit-search-cancel-button { display: none; }
.conversation-search-field > .el-icon { flex: none; }
.conversation-search .nx-icon-btn { flex: none; width: 27px; height: 28px; }
.conversation-search .conversation-edit {
  box-sizing: border-box;
  border: 1px solid var(--nx-border-strong);
  width: var(--history-control-height);
  height: var(--history-control-height);
  border-radius: var(--history-control-radius);
}
.conversation-search .conversation-edit.is-on {
  color: var(--nx-accent);
  background: var(--nx-accent-soft);
  border-color: var(--nx-accent-border);
}
@media (prefers-reduced-motion: reduce) {
  .conversation-search-field { transition: none; }
}
</style>
