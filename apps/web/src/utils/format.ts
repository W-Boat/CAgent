/** 通用格式化工具 */

export function formatDateTime(value?: string | number | Date | null): string {
  if (!value) return "-"
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function formatDate(value?: string | number | Date | null): string {
  if (!value) return "-"
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function fromNow(value?: string | number | Date | null): string {
  if (!value) return "-"
  const date = value instanceof Date ? value : new Date(value)
  const diff = Date.now() - date.getTime()
  if (Number.isNaN(diff)) return "-"
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < minute) return "刚刚"
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`
  return formatDate(date)
}

export function formatNumber(value?: number | null, digits = 0): string {
  if (value === null || value === undefined) return "0"
  return Number(value).toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })
}

/** 大数字缩写：12345 -> 1.23万 */
export function compactNumber(value?: number | null): string {
  const num = Number(value || 0)
  if (Math.abs(num) < 1000) return String(num)
  if (Math.abs(num) < 1_000_000) return `${(num / 1000).toFixed(2)}k`
  return `${(num / 1_000_000).toFixed(2)}M`
}

export function formatTokens(value?: number | null): string {
  return compactNumber(value)
}

export function formatCost(value?: number | null): string {
  const num = Number(value || 0)
  if (num === 0) return "$0"
  if (num < 0.01) return `$${num.toFixed(5)}`
  return `$${num.toFixed(4)}`
}

export function formatDuration(ms?: number | null): string {
  const num = Number(ms || 0)
  if (num < 1000) return `${num} ms`
  if (num < 60_000) return `${(num / 1000).toFixed(2)} s`
  const minutes = Math.floor(num / 60_000)
  const seconds = Math.round((num % 60_000) / 1000)
  return `${minutes} 分 ${seconds} 秒`
}

export function formatBytes(bytes?: number | null): string {
  const num = Number(bytes || 0)
  if (num < 1024) return `${num} B`
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`
  return `${(num / 1024 / 1024).toFixed(2)} MB`
}

/** 相对日期区间：近 N 天 */
export function lastNDays(days: number): { from: string; to: string } {
  const to = new Date()
  const from = new Date(to.getTime() - (days - 1) * 86_400_000)
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`
  return { from: fmt(from), to: fmt(to) }
}

export function truncate(text?: string | null, length = 60): string {
  if (!text) return ""
  const str = String(text).replace(/\s+/g, " ").trim()
  return str.length > length ? `${str.slice(0, length)}…` : str
}

export function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json;charset=utf-8"
  })
  downloadBlob(blob, filename)
}

export function downloadText(text: string, filename: string, mime = "text/plain") {
  downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), filename)
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text)
  return new Promise((resolve) => {
    const area = document.createElement("textarea")
    area.value = text
    area.style.position = "fixed"
    area.style.opacity = "0"
    document.body.appendChild(area)
    area.select()
    document.execCommand("copy")
    document.body.removeChild(area)
    resolve()
  })
}

const STATUS_TEXT: Record<string, string> = {
  ACTIVE: "正常",
  DISABLED: "已禁用",
  PENDING: "待激活",
  ARCHIVED: "已归档",
  DELETED: "已删除",
  SUCCESS: "成功",
  FAILED: "失败",
  RUNNING: "运行中",
  CANCELLED: "已取消",
  STREAMING: "生成中",
  ABORTED: "已中断",
  CLOSED: "已关闭",
  CRASHED: "已崩溃"
}

const STATUS_TYPE: Record<string, string> = {
  ACTIVE: "success",
  SUCCESS: "success",
  DISABLED: "info",
  CLOSED: "info",
  ARCHIVED: "info",
  DELETED: "info",
  PENDING: "warning",
  STREAMING: "warning",
  RUNNING: "warning",
  ABORTED: "warning",
  CANCELLED: "warning",
  FAILED: "danger",
  CRASHED: "danger"
}

export function statusText(status?: string | null): string {
  if (!status) return "-"
  return STATUS_TEXT[status] || status
}

export function statusType(status?: string | null): string {
  if (!status) return "info"
  return STATUS_TYPE[status] || "info"
}

const SOURCE_TEXT: Record<string, string> = {
  CHAT: "对话",
  SKILL: "技能",
  BROWSER: "浏览器",
  EMBEDDING: "向量化"
}

export function sourceText(source?: string | null): string {
  if (!source) return "-"
  return SOURCE_TEXT[source] || source
}

const SKILL_TYPE_TEXT: Record<string, string> = {
  PROMPT: "提示词",
  TOOL: "内置工具",
  HTTP: "HTTP 接口",
  BROWSER: "浏览器"
}

export function skillTypeText(type?: string | null): string {
  if (!type) return "-"
  return SKILL_TYPE_TEXT[type] || type
}

const VISIBILITY_TEXT: Record<string, string> = {
  PRIVATE: "仅自己",
  CAMPUS: "校内可见",
  PUBLIC: "公开"
}

export function visibilityText(value?: string | null): string {
  if (!value) return "-"
  return VISIBILITY_TEXT[value] || value
}

const ROLE_TEXT: Record<string, string> = {
  super_admin: "超级管理员",
  admin: "管理员",
  user: "普通用户"
}

export function roleText(key?: string | null): string {
  if (!key) return "-"
  return ROLE_TEXT[key] || key
}

/** 后端静态资源（截图）转可访问 URL */
export function artifactUrl(path?: string | null): string {
  if (!path) return ""
  if (/^https?:\/\//i.test(path)) return path
  const normalized = path.replace(/\\/g, "/").replace(/^\.?\/*/, "")
  const idx = normalized.indexOf("storage/")
  const rel = idx >= 0 ? normalized.slice(idx + "storage/".length) : normalized
  return `/static/${rel}`
}