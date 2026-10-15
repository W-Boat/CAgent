<template><AnswerPending compact :phase="progress?.stage || 'preparing'"/></template>
<script setup lang="ts">
import AnswerPending from './AnswerPending.vue'
defineProps<{progress?:{stage:string}}>()
</script>
