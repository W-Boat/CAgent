<script setup lang="ts">
import { computed, onDeactivated, onUnmounted, ref } from 'vue'
import { post, toastError, toastOk } from '@/api/client'
import FilePicker from '@/components/FilePicker.vue'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{ group: 'test'|'presentation'; enabled: boolean; disabled: boolean }>()
const auth = useAuthStore()
const role = ref('user'), hours = ref(8), busy = ref(false), file = ref<File>()
const result = ref<{ email: string; password: string; expiresAt: string }>()
const image = ref(''), preview = ref('')
const assetUrl = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '') + '/experience/mascot'
const shownImage = computed(() => preview.value || image.value || assetUrl)
const imageError = ref(false)
onDeactivated(() => { result.value = undefined })
onUnmounted(() => { if (preview.value) URL.revokeObjectURL(preview.value) })
function selectFile(event: Event) {
  const input = event.target as HTMLInputElement
  const selected = input.files?.[0]
  input.value = ''
  if (!selected) return
  if (selected.size > 1024 * 1024) return toastError(new Error('吉祥物图片不得超过 1 MB'))
  if (preview.value) URL.revokeObjectURL(preview.value)
  preview.value = URL.createObjectURL(selected)
  file.value = selected
  imageError.value = false
}
async function saveImage() {
  if (!file.value) return
  busy.value = true
  const data = new FormData()
  data.append('file', file.value)
  try {
    await post('/experience/mascot', data)
    toastOk('吉祥物图片已保存')
    image.value = assetUrl + '?v=' + Date.now()
    if (preview.value) { URL.revokeObjectURL(preview.value); preview.value = '' }
    file.value = undefined
  } catch (error) { toastError(error) }
  finally { busy.value = false }
}
async function issue() {
  busy.value = true
  result.value = undefined
  try { result.value = await post('/experience/test-accounts', { role: role.value, hours: hours.value }) }
  catch (error) { toastError(error) }
  finally { busy.value = false }
}
</script>
<template>
  <div v-if="group === 'presentation'" class="experience-settings">
    <h3>统一吉祥物形象</h3>
    <p>常驻辛瓜、开始等待、思考和小游戏共用形象。</p>
    <div class="experience-actions">
      <img :src="imageError?'/mascot/xingua-placeholder.png':shownImage" alt="吉祥物预览" @error="imageError = true">
      <FilePicker accept="image/png,image/jpeg,image/gif,image/webp" :file="file" :disabled="disabled || busy" label="选择吉祥物" hint="PNG、JPG、GIF 或 WebP，最多 1 MB" @change="selectFile"/>
      <el-button type="primary" :loading="busy" :disabled="disabled || !file" @click="saveImage">上传形象</el-button>
    </div>
  </div>
  <div v-else-if="auth.roles.includes('super_admin')" class="experience-settings">
    <h3>分配测试账号</h3>
    <p>先保存「测试账号模式」。签发后显示一次密码，到期或关闭测试模式后账号和已登录会话失效。</p>
    <p>测试超管拥有完整后台权限，需在专用测试部署设置 <code>ALLOW_TEST_SUPER_ADMIN=true</code>。</p>
    <div class="experience-actions">
      <el-select v-model="role" aria-label="测试账号角色" style="width:145px"><el-option label="测试学生" value="user"/><el-option label="测试超管" value="super_admin"/></el-select>
      <label>有效小时 <el-input-number v-model="hours" :min="1" :max="72"/></label>
      <el-button type="primary" :loading="busy" :disabled="disabled || !enabled" @click="issue">签发账号</el-button>
    </div>
    <dl v-if="result" class="test-account" aria-live="polite">
      <dt>登录邮箱</dt><dd><code>{{ result.email }}</code></dd>
      <dt>初始密码</dt><dd><code>{{ result.password }}</code></dd>
      <dt>有效期至</dt><dd>{{ new Date(result.expiresAt).toLocaleString() }}</dd>
    </dl>
  </div>
</template>
<style scoped>
.experience-settings{margin:16px 0;padding:16px;border:1px solid var(--nx-border);border-radius:12px}.experience-settings h3{margin:0 0 9px}.experience-settings p{color:var(--nx-text-2);line-height:1.6;margin:6px 0}.experience-actions{display:flex;align-items:center;flex-wrap:wrap;gap:10px}.experience-actions img{width:60px;height:60px;object-fit:contain}.test-account{display:grid;grid-template-columns:max-content 1fr;gap:8px;margin:12px 0 0}.test-account dd{margin:0;overflow-wrap:anywhere}
</style>
