<template><div v-if="shortcuts.length" class="knowledge-shortcuts"><span>知识库</span><button v-for="item in shortcuts" :key="item.id" type="button" :disabled="disabled" :title="item.question" @click="$emit('ask',item.question)">{{ item.label }}</button></div></template>
<script setup lang="ts">
import {useKnowledgeShortcuts} from '@/utils/knowledge-shortcuts'
const shortcuts=useKnowledgeShortcuts()
defineProps<{disabled?:boolean}>()
defineEmits<{(e:'ask',text:string):void}>()
</script>
<style scoped>.knowledge-shortcuts{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin:0 0 10px;font-size:10px;color:var(--nx-text-2,var(--el-text-color-secondary))}.knowledge-shortcuts button{font:inherit;font-size:11px;padding:4px 8px;border:1px solid var(--nx-border,var(--el-border-color));border-radius:8px;color:var(--nx-text-2,var(--el-text-color-secondary));background:var(--nx-surface-2,var(--el-fill-color-light));cursor:pointer}.knowledge-shortcuts button:hover{color:var(--nx-accent,var(--el-color-primary))}.knowledge-shortcuts button:disabled{opacity:.5;cursor:default}</style>
