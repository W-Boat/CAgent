<template>
 <div class="nx-root student-lectures">
  <StudentTopbar title="讲座日历"/>
  <LectureCalendarView student-mode/>
 </div>
</template>
<script setup lang="ts">
import LectureCalendarView from '@/views/campus/LectureCalendarView.vue'
import StudentTopbar from '@/components/student/StudentTopbar.vue'
</script>
<style scoped>
.student-lectures{min-height:100dvh;background:var(--nx-bg);color:var(--nx-text)}.student-lecture-bar{display:flex;align-items:center;gap:16px;height:60px;padding:0 24px;border-bottom:1px solid var(--nx-border);background:var(--nx-bg)}.student-lecture-bar>a{display:flex;align-items:center;gap:8px;color:var(--nx-text);text-decoration:none;font-size:13px}.student-lecture-bar>span{margin-left:auto;color:var(--nx-text-2);font-size:12px}.student-lecture-bar .el-icon{width:20px;height:20px;font-size:20px}.student-lecture-bar a:focus-visible{outline:2px solid var(--nx-accent);outline-offset:5px;border-radius:4px}@media(max-width:600px){.student-lecture-bar{height:54px;padding:0 16px;gap:10px}}
</style>
