<template><header class="brand"><span class="brand-mark" aria-hidden="true"><CAgentMark :size="42" bubble-color="var(--nx-accent-soft)"/></span><div class="brand-copy"><h1>{{ title }}</h1><p>校园问答 · 办事指引</p></div></header></template>
<script setup lang="ts">
import '../styles/auth-typography.css'
import CAgentMark from './CAgentMark.vue'
defineProps<{title:string}>()
</script>
<style scoped>
.brand{display:flex;align-items:center;gap:12px;margin-bottom:28px;padding-bottom:22px;border-bottom:1px solid var(--nx-border);text-align:left}.brand-mark{display:grid;place-items:center;flex:0 0 44px;width:44px;height:44px;color:var(--nx-accent)}.brand-copy{min-width:0}.brand h1{margin:0;font-size:16px;font-weight:650;line-height:1.5;letter-spacing:-.2px;color:var(--nx-text);overflow-wrap:anywhere}.brand p{margin:3px 0 0;font-size:12px;line-height:1.6;color:var(--nx-text-2)}@media(max-width:380px){.brand{gap:10px}.brand h1{font-size:15px}}
</style>
