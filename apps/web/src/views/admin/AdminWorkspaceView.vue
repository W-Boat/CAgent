<template>
  <div class="admin-workspace">
    <el-tabs v-if="visible.length>1" :model-value="active?.id" class="workspace-tabs" @tab-change="go">
      <el-tab-pane v-for="tab in visible" :key="tab.id" :name="tab.id" :label="tab.title"/>
    </el-tabs>
    <KeepAlive :max="5"><component :is="active.component" v-if="active" :key="active.id"/></KeepAlive>
    <el-empty v-if="!active" description="当前账号没有此工作区的访问权限"/>
  </div>
</template>
<script setup lang="ts">
import {computed,defineAsyncComponent,type Component} from 'vue'
import {useRoute,useRouter} from 'vue-router'
import {useAuthStore} from '@/stores/auth'
const props=defineProps<{section:string}>(),route=useRoute(),router=useRouter(),auth=useAuthStore()
type Tab={id:string;title:string;permission?:string;component:Component}
const make=(id:string,title:string,load:()=>Promise<{default:Component}>,permission?:string):Tab=>({id,title,permission,component:defineAsyncComponent(load)})
const workspaces:Record<string,Tab[]>={
 dashboard:[make('overview','全站概览',()=>import('@/views/next/WorkbenchNextView.vue'),'dashboard:read'),make('campus','导览统计',()=>import('./CampusStatsView.vue'),'campus:admin'),make('usage','用量统计',()=>import('./UsageAdminView.vue'),'usage:read:all'),make('runs','技能运行',()=>import('./SkillRunsView.vue'),'skill:read')],
 agents:[make('gallery','智能体广场',()=>import('@/views/agents/AgentGalleryView.vue')),make('manage','管理智能体',()=>import('./AgentsAdminView.vue'),'agent:read')],
 skills:[make('catalog','技能与工具',()=>import('@/views/skills/SkillCenterView.vue')),make('manage','管理与安装',()=>import('./SkillsAdminView.vue'),'skill:read')],
 models:[make('providers','模型供应商',()=>import('./ProvidersView.vue'),'provider:read'),make('models','模型配置',()=>import('./ModelsView.vue'),'model:read')],
 people:[make('users','用户',()=>import('./UsersView.vue'),'user:read'),make('roles','角色与权限',()=>import('./RolesView.vue'),'role:read')],
 knowledge:[make('entries','知识条目与信息源',()=>import('./KnowledgeAdminView.vue'),'campus:admin'),make('guide','校园导览目录',()=>import('@/views/campus/CampusGuideView.vue'),'campus:read')],
 audit:[make('conversations','会话',()=>import('./ConversationsView.vue'),'conversation:read'),make('messages','消息',()=>import('./MessagesView.vue'),'message:read'),make('campus','导览记录',()=>import('./CampusRunsView.vue'),'campus:read')],
}
const visible=computed(()=> (workspaces[props.section]||[]).filter(tab=>!tab.permission||auth.can(tab.permission)))
const active=computed(()=>visible.value.find(tab=>tab.id===route.query.tab)||visible.value[0])
function go(tab:string|number){void router.replace({path:route.path,query:{...route.query,tab:String(tab)}})}
</script>
<style scoped>
.admin-workspace{width:100%;min-width:0}
</style>
