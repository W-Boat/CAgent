<template>
 <div class="nx-root student-lectures">
  <header class="student-lecture-bar"><RouterLink to="/student"><el-icon><Back/></el-icon><span>返回对话</span></RouterLink><span>校园学术生活</span><button v-if="theme.allowToggle" class="nx-icon-btn" type="button" :aria-label="theme.isDark?'切换到浅色':'切换到深色'" @click="theme.toggle()"><el-icon><Sunny v-if="theme.isDark"/><Moon v-else/></el-icon></button></header>
  <LectureCalendarView student-mode/>
 </div>
</template>
<script setup lang="ts">
import LectureCalendarView from '@/views/campus/LectureCalendarView.vue'
import {useThemeStore} from '@/stores/theme'
const theme=useThemeStore()
</script>
<style scoped>
.student-lectures{min-height:100dvh;background:var(--nx-bg);color:var(--nx-text)}.student-lecture-bar{display:flex;align-items:center;gap:16px;height:60px;padding:0 24px;border-bottom:1px solid var(--nx-border);background:var(--nx-bg)}.student-lecture-bar>a{display:flex;align-items:center;gap:8px;color:var(--nx-text);text-decoration:none;font-size:13px}.student-lecture-bar>span{margin-left:auto;color:var(--nx-text-2);font-size:12px}.student-lecture-bar .el-icon{width:20px;height:20px;font-size:20px}.student-lecture-bar a:focus-visible{outline:2px solid var(--nx-accent);outline-offset:5px;border-radius:4px}@media(max-width:600px){.student-lecture-bar{height:54px;padding:0 16px;gap:10px}}
</style>
