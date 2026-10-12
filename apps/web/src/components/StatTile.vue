<template>
  <el-card shadow="never" class="stat-tile" :body-style="{ padding: '16px' }">
    <div class="tile-top">
      <span class="tile-label">{{ label }}</span>
      <el-icon v-if="icon" class="tile-icon" :style="{ color: color || 'var(--cg-brand)' }">
        <component :is="icon" />
      </el-icon>
    </div>
    <div class="tile-value">{{ display }}</div>
    <div v-if="hint" class="tile-hint">{{ hint }}</div>
  </el-card>
</template>

<script setup lang="ts">
import { computed } from "vue"
import { formatNumber } from "@/utils/format"

const props = withDefaults(
  defineProps<{
    label: string
    value: number | string
    icon?: string
    color?: string
    hint?: string
    digits?: number
  }>(),
  { digits: 0 }
)

const display = computed(() =>
  typeof props.value === "number" ? formatNumber(props.value, props.digits) : props.value
)
</script>

<style scoped>
.stat-tile {
  border-radius: var(--cg-radius);
}
.tile-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.tile-label {
  font-size: 13px;
  color: var(--cg-text-muted);
}
.tile-icon {
  font-size: 18px;
}
.tile-value {
  margin-top: 8px;
  font-size: 25px;
  font-weight: 600;
  line-height: 1.15;
}
.tile-hint {
  margin-top: 6px;
  font-size: 12px;
  color: var(--cg-text-muted);
}
</style>