<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title">智能体广场</h2>
        <p class="page-subtitle">
          挑选一个开箱即用的智能体开始对话，每个智能体已预置角色设定、模型与技能
        </p>
      </div>
      <div class="page-actions">
        <el-button @click="load">
          <el-icon><Refresh /></el-icon> 刷新
        </el-button>
      </div>
    </div>

    <el-input
      v-model="keyword"
      placeholder="搜索智能体名称或用途"
      clearable
      class="search"
      size="large"
    >
      <template #prefix><el-icon><Search /></el-icon></template>
    </el-input>

    <el-row :gutter="16" v-loading="loading">
      <el-col v-for="agent in filtered" :key="agent.id" :xs="24" :sm="12" :lg="8">
        <el-card shadow="hover" class="agent-card" @click="startChat(agent)">
          <div class="ac-head">
            <el-avatar :size="48" :src="agent.avatar || undefined">
              {{ (agent.name || "A").slice(0, 1) }}
            </el-avatar>
            <div class="ac-title">
              <div class="ac-name">{{ agent.name }}</div>
              <div class="ac-model">
                {{ agent.modelName || "系统默认模型" }}
                <el-tag size="small" effect="plain" type="info" class="ac-vis">
                  {{ visibilityText(agent.visibility) }}
                </el-tag>
              </div>
            </div>
          </div>

          <p class="ac-desc">{{ agent.description || "暂无描述" }}</p>

          <div v-if="agent.greeting" class="ac-greeting">{{ truncate(agent.greeting, 70) }}</div>

          <div class="ac-skills">
            <el-tag v-for="s in agent.skills.slice(0, 3)" :key="s.id" size="small" effect="plain">
              {{ s.name }}
            </el-tag>
            <el-tag v-if="agent.skills.length > 3" size="small" type="info" effect="plain">
              +{{ agent.skills.length - 3 }}
            </el-tag>
            <span v-if="agent.skills.length === 0" class="muted">未绑定技能</span>
          </div>

          <div class="ac-foot">
            <span v-if="agent.allowBrowser" class="ac-flag">
              <el-icon><Monitor /></el-icon> 支持网页操控
            </span>
            <span v-else class="muted">纯对话</span>
            <el-button type="primary" size="small">
              开始对话 <el-icon><ArrowRight /></el-icon>
            </el-button>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-empty v-if="!loading && filtered.length === 0" description="暂无可用智能体" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { useRouter } from "vue-router"
import { agentsApi } from "@/api"
import { toastError } from "@/api/client"
import type { AgentItem } from "@/api/types"
import { truncate, visibilityText } from "@/utils/format"

/*
 * 声明组件名，供 <keep-alive :include> 匹配（约定与路由 name 一致）。
 * 不声明的话缓存会静默失效：切走再回来仍会重建组件、重新拉数据。
 */
defineOptions({ name: "agents" })

const router = useRouter()
const agents = ref<AgentItem[]>([])
const loading = ref(false)
const keyword = ref("")

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return agents.value
  return agents.value.filter(
    (a) =>
      a.name.toLowerCase().includes(kw) ||
      (a.description || "").toLowerCase().includes(kw)
  )
})

async function load() {
  loading.value = true
  try {
    agents.value = await agentsApi.available()
  } catch (error) {
    toastError(error, "智能体列表加载失败")
  } finally {
    loading.value = false
  }
}

function startChat(agent: AgentItem) {
  router.push({ path: "/chat", query: { agentId: agent.id } })
}

onMounted(load)
</script>

<style scoped>
.search {
  max-width: 420px;
  margin-bottom: 16px;
}
.agent-card {
  margin-bottom: 16px;
  cursor: pointer;
  border-radius: var(--cg-radius);
  transition: transform 0.15s, box-shadow 0.15s;
}
.agent-card:hover {
  transform: translateY(-2px);
}
.ac-head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.ac-title {
  min-width: 0;
}
.ac-name {
  font-size: 15px;
  font-weight: 600;
}
.ac-model {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 3px;
  font-size: 12px;
  color: var(--cg-text-muted);
}
.ac-vis {
  transform: scale(0.92);
}
.ac-desc {
  min-height: 42px;
  margin: 12px 0 8px;
  font-size: 13px;
  line-height: 1.65;
  color: var(--cg-text-muted);
}
.ac-greeting {
  padding: 8px 12px;
  margin-bottom: 10px;
  font-size: 12.5px;
  line-height: 1.6;
  background: var(--cg-brand-soft);
  border-radius: 8px;
}
.ac-skills {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-height: 24px;
}
.ac-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--cg-border);
  font-size: 12px;
}
.ac-flag {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--cg-brand);
}
</style>