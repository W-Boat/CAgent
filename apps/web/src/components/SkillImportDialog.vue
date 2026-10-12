<template>
  <el-dialog
    :model-value="modelValue"
    title="导入技能"
    width="720px"
    :close-on-click-modal="false"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
    @closed="reset"
  >
    <el-alert
      type="info"
      :closable="false"
      show-icon
      class="imp-tip"
      title="支持三种格式，会自动识别"
    >
      <template #default>
        <div class="imp-tip-body">
          <div><b>JSON</b>：本平台导出的技能结构，或含 <code>key/name/description</code> 的对象</div>
          <div><b>Markdown</b>：SKILL.md 风格 —— 一级标题当名称，首段当描述，正文当提示词</div>
          <div><b>纯文本</b>：整体作为 PROMPT 型提示词，首行当名称</div>
        </div>
      </template>
    </el-alert>

    <!-- 来源选择 -->
    <div class="imp-source">
      <el-radio-group v-model="source" size="small">
        <el-radio-button value="paste">粘贴内容</el-radio-button>
        <el-radio-button value="file">上传文件</el-radio-button>
        <el-radio-button value="zip">技能包 zip</el-radio-button>
      </el-radio-group>

      <el-button
        size="small"
        text
        :disabled="!content && !zipFile"
        @click="clearAll"
      >
        <el-icon><Delete /></el-icon> 清空
      </el-button>
    </div>

    <div v-if="source === 'file'" class="imp-file">
      <input
        ref="fileRef"
        type="file"
        accept=".json,.md,.markdown,.txt,.yaml,.yml"
        class="hidden-input"
        @change="onFile"
      />
      <el-button @click="fileRef?.click()">
        <el-icon><UploadFilled /></el-icon> 选择文件
      </el-button>
      <span v-if="fileName" class="muted">{{ fileName }}</span>
      <span v-else class="muted">支持 .json / .md / .txt</span>
    </div>

    <!-- 技能包：zip 内含 SKILL.md / skill.json 等 -->
    <div v-if="source === 'zip'" class="imp-file imp-zip">
      <input
        ref="zipRef"
        type="file"
        accept=".zip,application/zip"
        class="hidden-input"
        @change="onZip"
      />
      <el-button @click="zipRef?.click()">
        <el-icon><FolderOpened /></el-icon> 选择技能包
      </el-button>
      <span v-if="zipFile" class="muted">{{ zipFile.name }}（{{ zipSizeText }}）</span>
      <span v-else class="muted">支持 .zip，内含 SKILL.md 或 skill.json</span>
      <div class="zip-hint">
        包内可包含 <code>SKILL.md</code>（主文档）、<code>skill.json</code>（结构化定义）
        以及其他 Markdown 附件；脚本/模板等非文本文件不会被保存，只在提示词里列出文件名。
      </div>
    </div>

    <el-input
      v-if="source !== 'zip'"
      v-model="content"
      type="textarea"
      :rows="10"
      resize="none"
      class="imp-textarea"
      placeholder="在这里粘贴技能内容：&#10;&#10;例如：&#10;# 论文选题顾问&#10;&#10;帮助学生把宽泛的兴趣收敛成可写的论文题目。&#10;&#10;## 工作流程&#10;1. 先问清学科、篇幅与截止时间&#10;2. 给出 3 个可写的题目方向"
    />

    <!-- 预览结果 -->
    <div v-if="preview" class="imp-preview">
      <div class="prev-head">
        <SkillAvatar
          :icon="preview.icon"
          :name="preview.name"
          :seed="preview.key"
          :size="38"
        />
        <div class="prev-title">
          <div class="prev-name">
            {{ preview.name }}
            <el-tag size="small" effect="plain">{{ formatText(preview.format) }}</el-tag>
            <el-tag size="small" type="info" effect="plain">{{ preview.type }}</el-tag>
          </div>
          <div class="prev-key mono">{{ preview.key }}</div>
        </div>
      </div>

      <div class="prev-desc">{{ preview.description }}</div>

      <el-alert
        v-if="preview.exists"
        type="warning"
        :closable="false"
        show-icon
        class="prev-alert"
        :title="`标识「${preview.key}」已存在，请选择处理方式`"
      />

      <el-alert
        v-for="(w, i) in preview.warnings"
        :key="i"
        type="warning"
        :closable="false"
        show-icon
        class="prev-alert"
        :title="w"
      />

      <div v-if="preview.systemPrompt" class="prev-prompt">
        <div class="prev-label">系统提示词（{{ preview.systemPrompt.length }} 字）</div>
        <pre class="prev-pre">{{ truncate(preview.systemPrompt, 600) }}</pre>
      </div>

      <!-- 技能包：列出包内文件，让管理员确认解析范围 -->
      <div v-if="preview.files?.length" class="prev-files">
        <div class="prev-label">包内文件（{{ preview.files.length }} 个）</div>
        <div class="file-list">
          <el-tag
            v-for="f in preview.files.slice(0, 20)"
            :key="f"
            size="small"
            effect="plain"
            class="file-tag"
          >
            {{ f }}
          </el-tag>
          <span v-if="preview.files.length > 20" class="muted">
            另有 {{ preview.files.length - 20 }} 个文件
          </span>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="imp-footer">
        <div class="imp-conflict">
          <span class="muted">标识冲突时：</span>
          <el-radio-group v-model="onConflict" size="small" :disabled="!preview?.exists">
            <el-radio-button value="rename">自动改名</el-radio-button>
            <el-radio-button value="skip">跳过</el-radio-button>
            <el-radio-button value="overwrite">覆盖</el-radio-button>
          </el-radio-group>
        </div>

        <div class="imp-actions">
          <el-button @click="emit('update:modelValue', false)">取消</el-button>
          <el-button :loading="previewing" :disabled="!canAct" @click="doPreview">
            预览
          </el-button>
          <el-button
            type="primary"
            :loading="importing"
            :disabled="!preview || (preview.exists && onConflict === 'skip')"
            @click="doImport"
          >
            {{ preview?.exists && onConflict === "overwrite" ? "覆盖导入" : "确认导入" }}
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { skillsApi } from "@/api"
import { toastError, toastOk } from "@/api/client"
import { truncate } from "@/utils/format"
import SkillAvatar from "@/components/SkillAvatar.vue"
import type { SkillType } from "@/api/types"

type Preview = {
  key: string
  name: string
  description: string
  type: SkillType
  icon: string | null
  systemPrompt: string | null
  warnings: string[]
  format: "json" | "markdown" | "text" | "zip"
  /** zip 包内的文件清单 */
  files?: string[]
  exists?: boolean
}

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void
  (e: "imported"): void
}>()

const source = ref<"paste" | "file" | "zip">("paste")
const content = ref("")
const fileName = ref("")
const fileRef = ref<HTMLInputElement>()

/** 选中的 zip 技能包；导入时以 multipart 上传 */
const zipFile = ref<File | null>(null)
const zipRef = ref<HTMLInputElement>()

const onConflict = ref<"rename" | "skip" | "overwrite">("rename")
const preview = ref<Preview | null>(null)
const previewing = ref(false)
const importing = ref(false)

const FORMAT_TEXT: Record<string, string> = {
  json: "JSON",
  markdown: "Markdown",
  text: "纯文本",
  zip: "技能包"
}
const formatText = (f: string) => FORMAT_TEXT[f] || f

/** 「确认导入」按钮是否可用 */
const canAct = computed(() => (source.value === "zip" ? Boolean(zipFile.value) : Boolean(content.value.trim())))

const zipSizeText = computed(() => {
  const f = zipFile.value
  if (!f) return ""
  const kb = f.size / 1024
  return kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`
})

function clearAll() {
  content.value = ""
  fileName.value = ""
  zipFile.value = null
  preview.value = null
}

function reset() {
  clearAll()
  onConflict.value = "rename"
  source.value = "paste"
}

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  if (file.size > 400_000) {
    toastError(new Error("文件过大（上限约 400KB）"))
    input.value = ""
    return
  }
  fileName.value = file.name
  content.value = await file.text()
  preview.value = null
  input.value = ""
}

function onZip(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  if (!/\.zip$/i.test(file.name)) {
    toastError(new Error("请选择 .zip 格式的技能包"))
    input.value = ""
    return
  }
  if (file.size > 10 * 1024 * 1024) {
    toastError(new Error("技能包过大（上限 10MB）"))
    input.value = ""
    return
  }

  zipFile.value = file
  preview.value = null
  input.value = ""
}

async function doPreview() {
  if (!canAct.value) return
  previewing.value = true
  try {
    const res =
      source.value === "zip" && zipFile.value
        ? await skillsApi.importZip(zipFile.value, { dryRun: true })
        : await skillsApi.import({ content: content.value, dryRun: true })
    preview.value = res
    // 已存在且没有选过策略时，默认自动改名 —— 最不容易出错
    if (res.exists) onConflict.value = "rename"
  } catch (error) {
    preview.value = null
    toastError(error, "解析失败")
  } finally {
    previewing.value = false
  }
}

async function doImport() {
  importing.value = true
  try {
    const res =
      source.value === "zip" && zipFile.value
        ? await skillsApi.importZip(zipFile.value, { onConflict: onConflict.value })
        : await skillsApi.import({ content: content.value, onConflict: onConflict.value })
    if (res.skipped) {
      toastOk("已跳过：同标识技能已存在")
    } else if (res.overwritten) {
      toastOk(`已覆盖技能「${res.name}」`)
    } else {
      toastOk(`已导入技能「${res.name}」`)
    }
    emit("imported")
    emit("update:modelValue", false)
  } catch (error) {
    toastError(error, "导入失败")
  } finally {
    importing.value = false
  }
}

// 内容变化后旧的预览就失效了，避免拿旧结果去导入新内容
watch(content, () => {
  preview.value = null
})

// 换来源同样作废旧预览
watch(source, () => {
  preview.value = null
})

void props
</script>

<style scoped>
.imp-tip {
  margin-bottom: 14px;
}

.imp-tip-body {
  font-size: 12.5px;
  line-height: 1.9;
}

.imp-tip-body code {
  padding: 1px 4px;
  font-size: 12px;
  background: rgba(0, 0, 0, 0.06);
  border-radius: 3px;
}

.imp-source {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.imp-file {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

/* 技能包：文件选择 + 结构说明需要纵向排布 */
.imp-zip {
  flex-wrap: wrap;
  padding: 12px 14px;
  background: var(--cg-card-bg-soft);
  border: 1px dashed var(--cg-border-strong);
  border-radius: 10px;
}

.zip-hint {
  flex: 1 1 100%;
  font-size: 12px;
  line-height: 1.7;
  color: var(--cg-text-muted);
}

.zip-hint code {
  padding: 1px 4px;
  font-size: 11.5px;
  background: var(--cg-inline-code-bg);
  border-radius: 3px;
}

/* 技能包文件清单 */
.prev-files {
  margin-top: 12px;
}

.file-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}

.file-tag {
  font-family: "JetBrains Mono", Consolas, monospace;
  font-size: 11.5px;
}

.hidden-input {
  display: none;
}

.imp-textarea :deep(.el-textarea__inner) {
  font-family: "JetBrains Mono", Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.7;
}

.imp-preview {
  padding: 14px;
  margin-top: 14px;
  background: var(--cg-card-bg-soft);
  border: 1px solid var(--cg-border);
  border-radius: 10px;
}

.prev-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.prev-title {
  min-width: 0;
}

.prev-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14.5px;
  font-weight: 600;
}

.prev-key {
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--cg-text-muted);
}

.prev-desc {
  margin-top: 10px;
  font-size: 13px;
  line-height: 1.7;
  color: #374151;
}

.prev-alert {
  margin-top: 10px;
}

.prev-prompt {
  margin-top: 12px;
}

.prev-label {
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--cg-text-muted);
}

.prev-pre {
  max-height: 160px;
  padding: 10px 12px;
  margin: 0;
  overflow: auto;
  font-family: "JetBrains Mono", Consolas, monospace;
  font-size: 12px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--cg-card-bg);
  border: 1px solid var(--cg-border);
  border-radius: 8px;
}

.imp-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.imp-conflict {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
}

.imp-actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}
</style>
