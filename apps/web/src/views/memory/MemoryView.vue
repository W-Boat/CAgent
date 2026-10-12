<template>
  <div class="memory-view">
    <el-card class="stats-card">
      <template #header>
        <div class="card-header">
          <span>记忆统计</span>
        </div>
      </template>
      <el-row :gutter="20">
        <el-col :span="8">
          <div class="stat-item">
            <div class="stat-label">总记忆数</div>
            <div class="stat-value">{{ stats.total }}</div>
          </div>
        </el-col>
        <el-col :span="8">
          <div class="stat-item">
            <div class="stat-label">活跃记忆</div>
            <div class="stat-value active">{{ stats.active }}</div>
          </div>
        </el-col>
        <el-col :span="8">
          <div class="stat-item">
            <div class="stat-label">已归档</div>
            <div class="stat-value archived">{{ stats.archived }}</div>
          </div>
        </el-col>
      </el-row>
      <div v-if="stats.byCategory.length > 0" class="category-stats">
        <div class="category-title">按类别统计</div>
        <el-tag
          v-for="cat in stats.byCategory"
          :key="cat.category"
          class="category-tag"
          type="info"
        >
          {{ categoryNames[cat.category] || cat.category }}: {{ cat.count }}
        </el-tag>
      </div>
    </el-card>

    <el-card class="memories-card">
      <template #header>
        <div class="card-header">
          <span>我的记忆</span>
          <el-button type="primary" @click="showCreateDialog = true">
            <el-icon><Plus /></el-icon>
            添加记忆
          </el-button>
        </div>
      </template>

      <div class="filter-bar">
        <el-select v-model="filterCategory" placeholder="按类别筛选" clearable>
          <el-option label="全部" value="" />
          <el-option
            v-for="(name, key) in categoryNames"
            :key="key"
            :label="name"
            :value="key"
          />
        </el-select>
        <el-select v-model="filterAgent" placeholder="按智能体筛选" clearable>
          <el-option label="全局记忆" value="null" />
          <el-option
            v-for="agent in agents"
            :key="agent.id"
            :label="agent.name"
            :value="agent.id"
          />
        </el-select>
      </div>

      <el-table :data="filteredMemories" v-loading="loading">
        <el-table-column label="内容" min-width="300">
          <template #default="{ row }">
            <div class="memory-content">{{ row.content }}</div>
          </template>
        </el-table-column>
        <el-table-column label="类别" width="120">
          <template #default="{ row }">
            <el-tag size="small" type="info">
              {{ categoryNames[row.category] || row.category }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="重要性" width="100">
          <template #default="{ row }">
            <el-rate v-model="row.importance" disabled :max="5" />
          </template>
        </el-table-column>
        <el-table-column label="使用次数" width="100" prop="usedCount" />
        <el-table-column label="来源" width="120">
          <template #default="{ row }">
            <el-tag size="small" :type="sourceType(row.source)">
              {{ sourceNames[row.source] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="180">
          <template #default="{ row }">
            {{ formatDate(row.createdAt) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="editMemory(row)">编辑</el-button>
            <el-button size="small" type="danger" @click="deleteMemory(row)">
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 创建/编辑记忆对话框 -->
    <el-dialog
      v-model="showCreateDialog"
      :title="editingMemory ? '编辑记忆' : '添加记忆'"
      width="500px"
    >
      <el-form :model="memoryForm" label-width="80px">
        <el-form-item label="内容" required>
          <el-input
            v-model="memoryForm.content"
            type="textarea"
            :rows="3"
            placeholder="例如：我喜欢用Python编程、我的专业是计算机科学..."
          />
        </el-form-item>
        <el-form-item label="类别">
          <el-select v-model="memoryForm.category" placeholder="选择类别">
            <el-option
              v-for="(name, key) in categoryNames"
              :key="key"
              :label="name"
              :value="key"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="重要性">
          <el-rate v-model="memoryForm.importance" :max="5" />
        </el-form-item>
        <el-form-item label="关联智能体">
          <el-select v-model="memoryForm.agentId" placeholder="全局记忆" clearable>
            <el-option
              v-for="agent in agents"
              :key="agent.id"
              :label="agent.name"
              :value="agent.id"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="submitMemory" :loading="submitting">
          {{ editingMemory ? '保存' : '创建' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import { memoryApi, type UserMemory, type MemoryStats } from '@/api/memory'
import { agentsApi } from '@/api'
import type { AgentItem } from '@/api/types'

/*
 * 声明组件名，供 <keep-alive :include> 匹配（约定与路由 name 一致）。
 * 不声明的话缓存会静默失效：切走再回来仍会重建组件、重新拉数据。
 */
defineOptions({ name: "memory" })

// ElMessage / ElMessageBox 由 unplugin-auto-import 按需引入（见 vite.config.ts）

const stats = ref<MemoryStats>({
  total: 0,
  active: 0,
  archived: 0,
  byCategory: []
})

const memories = ref<UserMemory[]>([])
const agents = ref<AgentItem[]>([])
const loading = ref(false)
const showCreateDialog = ref(false)
const submitting = ref(false)
const editingMemory = ref<UserMemory | null>(null)

const filterCategory = ref('')
const filterAgent = ref('')

const memoryForm = ref({
  content: '',
  category: 'general',
  importance: 3,
  agentId: ''
})

const categoryNames: Record<string, string> = {
  general: '通用',
  name: '姓名',
  preference: '偏好',
  fact: '事实',
  context: '背景',
  other: '其他'
}

const sourceNames: Record<string, string> = {
  USER_EXPLICIT: '用户主动',
  SYSTEM_INFERRED: '系统推断',
  USER_EXTRACTED: '用户提取'
}

const sourceType = (source: string) => {
  const types: Record<string, string> = {
    USER_EXPLICIT: 'success',
    SYSTEM_INFERRED: 'warning',
    USER_EXTRACTED: 'info'
  }
  return types[source] || 'info'
}

const filteredMemories = computed(() => {
  return memories.value.filter(m => {
    if (filterCategory.value && m.category !== filterCategory.value) return false
    if (filterAgent.value) {
      if (filterAgent.value === 'null' && m.agentId !== null) return false
      if (filterAgent.value !== 'null' && m.agentId !== filterAgent.value) return false
    }
    return true
  })
})

const formatDate = (dateStr: string) => {
  const date = new Date(dateStr)
  return date.toLocaleString('zh-CN')
}

const loadStats = async () => {
  try {
    stats.value = await memoryApi.getStats()
  } catch (error) {
    console.error('加载统计失败:', error)
  }
}

const loadMemories = async () => {
  loading.value = true
  try {
    memories.value = await memoryApi.getMemories()
  } catch (error) {
    console.error('加载记忆失败:', error)
    ElMessage.error('加载记忆失败')
  } finally {
    loading.value = false
  }
}

const loadAgents = async () => {
  try {
    agents.value = await agentsApi.list()
  } catch (error) {
    console.error('加载智能体列表失败:', error)
  }
}

const editMemory = (memory: UserMemory) => {
  editingMemory.value = memory
  memoryForm.value = {
    content: memory.content,
    category: memory.category,
    importance: memory.importance,
    agentId: memory.agentId || ''
  }
  showCreateDialog.value = true
}

const submitMemory = async () => {
  if (!memoryForm.value.content.trim()) {
    ElMessage.warning('请输入记忆内容')
    return
  }

  submitting.value = true
  try {
    const data = {
      content: memoryForm.value.content,
      category: memoryForm.value.category,
      importance: memoryForm.value.importance,
      agentId: memoryForm.value.agentId || undefined
    }

    if (editingMemory.value) {
      await memoryApi.update(editingMemory.value.id, data)
      ElMessage.success('记忆已更新')
    } else {
      await memoryApi.create(data)
      ElMessage.success('记忆已创建')
    }

    showCreateDialog.value = false
    editingMemory.value = null
    memoryForm.value = {
      content: '',
      category: 'general',
      importance: 3,
      agentId: ''
    }

    await Promise.all([loadMemories(), loadStats()])
  } catch (error) {
    console.error('提交记忆失败:', error)
    ElMessage.error('提交失败')
  } finally {
    submitting.value = false
  }
}

const deleteMemory = async (memory: UserMemory) => {
  try {
    await ElMessageBox.confirm(
      '确定要删除这条记忆吗？删除后无法恢复。',
      '确认删除',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )

    await memoryApi.delete(memory.id)
    ElMessage.success('记忆已删除')
    await Promise.all([loadMemories(), loadStats()])
  } catch (error) {
    if (error !== 'cancel') {
      console.error('删除记忆失败:', error)
      ElMessage.error('删除失败')
    }
  }
}

onMounted(() => {
  Promise.all([loadStats(), loadMemories(), loadAgents()])
})
</script>

<style scoped>
.memory-view {
  padding: 20px;
}

.stats-card {
  margin-bottom: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.stat-item {
  text-align: center;
  padding: 20px;
  background: var(--cg-card-bg-soft);
  border-radius: 8px;
}

.stat-label {
  font-size: 14px;
  color: #909399;
  margin-bottom: 8px;
}

.stat-value {
  font-size: 32px;
  font-weight: bold;
  color: #303133;
}

.stat-value.active {
  color: #67c23a;
}

.stat-value.archived {
  color: #909399;
}

.category-stats {
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid #ebeef5;
}

.category-title {
  font-size: 14px;
  color: #606266;
  margin-bottom: 10px;
}

.category-tag {
  margin-right: 8px;
  margin-bottom: 8px;
}

.memories-card {
  margin-bottom: 20px;
}

.filter-bar {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
}

.memory-content {
  font-size: 14px;
  line-height: 1.5;
}
</style>
