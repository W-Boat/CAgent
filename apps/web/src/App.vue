<template>
  <el-config-provider :locale="zhCn" :size="size">
    <router-view v-slot="{ Component }">
      <component :is="Component" />
    </router-view>

    <!--
      启动占位由 Vue 自己再盖一层。
      原因见 utils/boot.ts：app.mount() 会清空 index.html 里的占位，
      而此刻路由可能还卡在接口上，不补这一层用户看到的就是纯空白。
    -->
    <BootSplash v-if="!routeReady" />

    <!-- 校园网询问：每个标签会话出现一次，经典/新版外壳都经过这里 -->
  </el-config-provider>
</template>

<script setup lang="ts">
import {useTimetableReminders} from '@/utils/timetable-reminders'
useTimetableReminders()
import { onMounted,onBeforeUnmount,ref } from "vue"
// 中文语言包是纯数据，从具体路径导入，避免带出整个组件库
import zhCn from "element-plus/es/locale/lang/zh-cn"
import {useAuthStore} from "@/stores/auth"
import BootSplash from "@/components/BootSplash.vue"
import { routeReady } from "@/utils/boot"

/*
 * el-config-provider 由 unplugin-vue-components 按需自动引入。
 * 不要 `import { ElConfigProvider } from "element-plus"` ——
 * 从包根导入任何值都会把整个 element-plus 打进包里。
 */
const auth=useAuthStore()
let displayTimer:ReturnType<typeof setInterval>|undefined,lastRefresh=0
const refreshDisplay=(force=false)=>{if(force)lastRefresh=0;if(document.visibilityState==='hidden'||(!force&&Date.now()-lastRefresh<10000))return;lastRefresh=Date.now();void auth.loadPublicSettings()}
const onFocus=()=>refreshDisplay(true)
const onVisibility=()=>{if(document.visibilityState==='visible')refreshDisplay(true)}
const onDisplayUpdate=(event:StorageEvent)=>{if(event.key==='cagent-display-updated')refreshDisplay(true)}
onMounted(()=>{displayTimer=setInterval(()=>refreshDisplay(),60000);window.addEventListener('focus',onFocus);document.addEventListener('visibilitychange',onVisibility);window.addEventListener('storage',onDisplayUpdate)})
onBeforeUnmount(()=>{clearInterval(displayTimer);window.removeEventListener('focus',onFocus);document.removeEventListener('visibilitychange',onVisibility);window.removeEventListener('storage',onDisplayUpdate)})
const size = ref<"default" | "small" | "large">("default")
</script>
