<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title">导览统计</h2>
        <p class="page-subtitle">
          知识库调用、资料阅读、链接卡片跳转和地图使用；保留办理导览的进度统计。
        </p>
      </div>
      <div class="page-actions">
        <el-radio-group v-model="days" size="small" @change="load">
          <el-radio-button :value="7">近 7 天</el-radio-button>
          <el-radio-button :value="14">近 14 天</el-radio-button>
          <el-radio-button :value="30">近 30 天</el-radio-button>
        </el-radio-group>
        <el-button @click="load">
          <el-icon><Refresh /></el-icon> 刷新
        </el-button>
      </div>
    </div>

    <CampusUsageStats :days="days" :refresh-key="refreshKey"/>
    <h3>办理导览会话</h3>
    <el-row :gutter="14" class="tiles">
      <el-col :xs="24" :sm="8">
        <StatTile label="导览次数" :value="stats?.total ?? 0" icon="Compass" hint="打开页面的次数" />
      </el-col>
      <el-col :xs="24" :sm="8">
        <StatTile
          label="走完全部步骤"
          :value="stats?.completed ?? 0"
          icon="Select"
          color="#16a34a"
          hint="学生自己勾完所有步骤"
        />
      </el-col>
      <el-col :xs="24" :sm="8">
        <StatTile
          label="完成率"
          :value="stats?.completionRate ?? 0"
          icon="TrendCharts"
          color="#f59e0b"
          :digits="1"
          hint="完成 / 总次数"
        />
      </el-col>
    </el-row>

    <el-row :gutter="14" class="charts">
      <el-col :xs="24" :lg="14">
        <ChartPanel title="每日导览次数" :option="trendOption" :height="300" :is-empty="!hasTrend" />
      </el-col>
      <el-col :xs="24" :lg="10">
        <ChartPanel
          title="按访问方式分布"
          :option="accessOption"
          :height="300"
          :is-empty="!hasAccess"
        />
      </el-col>
    </el-row>

    <div class="table-card rank-card">
      <div class="rank-head">最常被打开的事项</div>
      <el-table :data="stats?.topItems ?? []" v-loading="loading" size="default">
        <el-table-column type="index" label="#" width="60" />
        <el-table-column label="事项" min-width="320">
          <template #default="{ row }">
            <div class="rank-title">{{ row.item?.title || "（已删除）" }}</div>
            <el-link
              v-if="row.item?.url"
              type="primary"
              :href="row.item.url"
              target="_blank"
              class="rank-url"
            >
              {{ row.item.url }}
            </el-link>
          </template>
        </el-table-column>
        <el-table-column label="办理部门" width="180">
          <template #default="{ row }">{{ row.item?.dept || "-" }}</template>
        </el-table-column>
        <el-table-column label="打开次数" width="140" sortable :sort-by="(r: any) => r.opens">
          <template #default="{ row }">
            <el-tag type="primary" effect="plain">{{ row.opens }} 次</el-tag>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="这段时间还没有导览记录" :image-size="80" />
        </template>
      </el-table>
    </div>

    <el-alert
      class="notice"
      type="info"
      show-icon
      :closable="false"
      title="口径说明"
      description="导览只把校内办事页面打开并给出提示，登录、填表、提交均由学生本人完成后自行勾选步骤。因此这里的「完成」是学生的自述进度，不是业务系统的办结状态。"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import type { EChartsOption } from "@/utils/echarts"
import { campusApi } from "@/api"
import { toastError } from "@/api/client"
import ChartPanel from "@/components/ChartPanel.vue"
import StatTile from "@/components/StatTile.vue"
import CampusUsageStats from '@/components/CampusUsageStats.vue'
import type { CampusRunStats } from "@/api/types"

/*
 * 声明组件名，供 <keep-alive :include> 匹配（约定与路由 name 一致）。
 * 不声明的话缓存会静默失效：切走再回来仍会重建组件、重新拉数据。
 */
defineOptions({ name: "admin-campus-stats" })

const days = ref(14)
const loading = ref(false)
const refreshKey=ref(0)
const stats = ref<CampusRunStats | null>(null)

const hasTrend = computed(() => (stats.value?.trend ?? []).some((t) => t.runs > 0))
const hasAccess = computed(() => (stats.value?.byAccess ?? []).length > 0)

const trendOption = computed<EChartsOption>(() => {
  const trend = stats.value?.trend ?? []
  return {
    tooltip: { trigger: "axis" },
    grid: { left: 44, right: 20, top: 24, bottom: 32 },
    xAxis: {
      type: "category",
      data: trend.map((t) => t.date.slice(5)),
      axisLabel: { fontSize: 11 }
    },
    yAxis: { type: "value", minInterval: 1, splitLine: { lineStyle: { color: "#eef1f7" } } },
    series: [
      {
        name: "导览次数",
        type: "line",
        smooth: true,
        symbolSize: 6,
        data: trend.map((t) => t.runs),
        itemStyle: { color: "#2563eb" },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(37,99,235,.28)" },
              { offset: 1, color: "rgba(37,99,235,.02)" }
            ]
          }
        }
      }
    ]
  }
})

const accessOption = computed<EChartsOption>(() => {
  const rows = stats.value?.byAccess ?? []
  const colorMap: Record<string, string> = {
    公网: "#16a34a",
    "校园网/VPN": "#f59e0b",
    已合并下线: "#ef4444",
    未标注: "#94a3b8"
  }
  return {
    tooltip: { trigger: "item", formatter: "{b}：{c} 次（{d}%）" },
    legend: { bottom: 0, itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 11 } },
    series: [
      {
        type: "pie",
        radius: ["46%", "68%"],
        center: ["50%", "44%"],
        avoidLabelOverlap: true,
        label: { show: false },
        data: rows.map((r) => ({
          name: r.access,
          value: r.count,
          itemStyle: { color: colorMap[r.access] || "#2563eb" }
        }))
      }
    ]
  }
})

async function load() {
  refreshKey.value++
  loading.value = true
  try {
    stats.value = await campusApi.stats(days.value)
  } catch (error) {
    toastError(error, "导览统计加载失败")
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.tiles {
  margin-bottom: 14px;
}
.tiles :deep(.el-col) {
  margin-bottom: 14px;
}
.charts {
  margin-bottom: 14px;
}
.charts :deep(.el-col) {
  margin-bottom: 14px;
}
.rank-card {
  padding: 14px 16px 12px;
}
.rank-head {
  margin-bottom: 10px;
  font-size: 15px;
  font-weight: 600;
}
.rank-title {
  font-size: 13.5px;
  font-weight: 500;
  line-height: 1.5;
}
.rank-url {
  font-size: 11.5px;
  word-break: break-all;
}
.notice {
  margin-top: 14px;
}
</style>
