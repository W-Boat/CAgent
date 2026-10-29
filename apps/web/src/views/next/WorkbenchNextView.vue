<template>
  <AdminDashboardNextView title="工作台">
    <template #actions>
      <button type="button" class="nx-btn nx-btn-primary" @click="router.push('/chat')">
        <el-icon><ChatDotRound /></el-icon>开始对话
      </button>
    </template>
  </AdminDashboardNextView>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import AdminDashboardNextView from '@/views/admin/next/AdminDashboardNextView.vue'

// Both entry points share the permission-protected platform statistics and chart lifecycle.
defineOptions({ name: 'dashboard' })
const router = useRouter()
</script>
