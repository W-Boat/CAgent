<template>
  <el-dialog
    :model-value="modelValue"
    :title="positive ? '点赞反馈' : '点踩反馈'"
    width="min(480px,94vw)"
    :close-on-click-modal="false"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
    @closed="reset"
  >
    <div class="feedback-body">
      <div v-if="positive" class="feedback-positive">
        <el-icon :size="48" color="#67c23a"><CircleCheck /></el-icon>
        <p class="feedback-thanks">感谢你的反馈！这有助于改进回答质量。</p>
      </div>

      <template v-else>
        <p class="feedback-intro">
          请告诉我们哪里不满意，帮助改进回答质量。你的反馈会经过管理员审核后用于优化智能体。
        </p>

        <!-- 原因选择 -->
        <div class="feedback-reasons">
          <div class="reason-label">不满意的原因（可选）：</div>
          <div class="reason-tags">
            <el-check-tag
              v-for="r in reasons"
              :key="r"
              :checked="selectedReason === r"
              @change="toggleReason(r)"
            >
              {{ r }}
            </el-check-tag>
          </div>
        </div>

        <!-- 纠正答案 -->
        <div class="feedback-correction">
          <div class="correction-label">
            如果你知道正确答案，请填写（最有价值的反馈）：
          </div>
          <el-input
            v-model="correction"
            type="textarea"
            :rows="4"
            placeholder="例如：正确的电话号码是 010-12345678，办理地点在良乡校区…"
            resize="none"
            maxlength="2000"
            show-word-limit
          />
        </div>
      </template>
    </div>

    <template #footer>
      <div class="feedback-footer">
        <el-button @click="emit('update:modelValue', false)">取消</el-button>
        <el-button
          v-if="!positive && hasExisting"
          type="danger"
          plain
          :loading="revoking"
          @click="doRevoke"
        >
          撤销评价
        </el-button>
        <el-button type="primary" :loading="submitting" @click="doSubmit">
          {{ positive ? '确认' : '提交反馈' }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue"
import { learningApi } from "@/api"
import { toastError, toastOk } from "@/api/client"

const props = defineProps<{
  modelValue: boolean
  messageId: string
  positive: boolean
  hasExisting?: boolean
}>()

const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void
  (e: "submitted", state: 'positive' | 'negative' | null): void
}>()

const reasons = ref<string[]>([])
const selectedReason = ref<string | null>(null)
const correction = ref("")
const submitting = ref(false)
const revoking = ref(false)

function reset() {
  selectedReason.value = null
  correction.value = ""
}

function toggleReason(r: string) {
  selectedReason.value = selectedReason.value === r ? null : r
}

// 加载可选原因
watch(
  () => props.modelValue,
  async (v) => {
    if(v && !props.positive){try{const current=await learningApi.forMessage(props.messageId);if(current){selectedReason.value=current.reason || null;correction.value=current.correction || ''}}catch{/* no saved feedback */}}
    if (v && !props.positive && reasons.value.length === 0) {
      try {
        reasons.value = await learningApi.reasons()
      } catch {
        reasons.value = ["不准确", "太啰嗦", "没答到点上", "信息过时", "格式混乱", "答非所问"]
      }
    }
  }
)

async function doSubmit() {
  submitting.value = true
  try {
    await learningApi.submit({
      messageId: props.messageId,
      positive: props.positive,
      reason: selectedReason.value ?? undefined,
      correction: correction.value.trim() || undefined
    })
    toastOk(props.positive ? "感谢点赞！" : "反馈已提交，感谢你的帮助！")
    emit("submitted", props.positive ? 'positive' : 'negative')
    emit("update:modelValue", false)
  } catch (err) {
    toastError(err, "提交失败")
  } finally {
    submitting.value = false
  }
}

async function doRevoke() {
  revoking.value = true
  try {
    await learningApi.revoke(props.messageId)
    toastOk("已撤销评价")
    emit("submitted", null)
    emit("update:modelValue", false)
  } catch (err) {
    toastError(err, "撤销失败")
  } finally {
    revoking.value = false
  }
}
</script>

<style scoped>
.feedback-body {
  padding: 0 4px;
}

.feedback-positive {
  text-align: center;
  padding: 20px 0;
}

.feedback-thanks {
  margin-top: 16px;
  font-size: 14px;
  color: #606266;
}

.feedback-intro {
  font-size: 13.5px;
  color: #606266;
  line-height: 1.7;
  margin-bottom: 18px;
}

.feedback-reasons {
  margin-bottom: 18px;
}

.reason-label,
.correction-label {
  font-size: 13px;
  color: #303133;
  margin-bottom: 10px;
  font-weight: 500;
}

.reason-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.feedback-correction {
  margin-top: 4px;
}

.feedback-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
