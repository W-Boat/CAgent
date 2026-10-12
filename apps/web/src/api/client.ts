import axios, {
  AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig
} from "axios"
import type { ApiEnvelope } from "./types"

const BASE_URL = import.meta.env.VITE_API_BASE || "/api"

const ACCESS_KEY = "cagent.accessToken"
const REFRESH_KEY = "cagent.refreshToken"

export const tokenStore = {
  get access() {
    return localStorage.getItem(ACCESS_KEY) || ""
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY) || ""
  },
  set(access: string, refresh?: string) {
    if (access) localStorage.setItem(ACCESS_KEY, access)
    if (refresh) localStorage.setItem(REFRESH_KEY, refresh)
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY)
    localStorage.removeItem(REFRESH_KEY)
  }
}

export interface ApiError {
  code: number
  message: string
  details?: unknown
  path?: string
}

export const http: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 60000,
  headers: { "Content-Type": "application/json" }
})

http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = tokenStore.access
  if (token) config.headers.Authorization = `Bearer ${token}`

  /*
   * 上传 FormData 时必须让浏览器自己设置 Content-Type。
   *
   * 全局默认头写死了 application/json，若不摘掉，浏览器不会补上
   * `multipart/form-data; boundary=...`，服务端就解析不出文件字段
   * （表现为「未收到压缩包」）。
   */
  if (typeof FormData !== "undefined" && config.data instanceof FormData) {
    config.headers.delete?.("Content-Type")
    // 兼容 axios 内部以普通对象存储 headers 的情况
    if (config.headers["Content-Type"]) delete config.headers["Content-Type"]
  }

  return config
})

/** 令牌过期时只发起一次刷新，其余请求排队等待 */
let refreshing: Promise<string> | null = null
let onUnauthorized: (() => void) | null = null

export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn
}

async function doRefresh(): Promise<string> {
  const refreshToken = tokenStore.refresh
  if (!refreshToken) throw new Error("NO_REFRESH_TOKEN")
  // 使用裸 axios，避免再次进入拦截器造成递归
  const res = await axios.post<ApiEnvelope<{ accessToken: string; refreshToken: string }>>(
    `${BASE_URL}/auth/refresh`,
    { refreshToken },
    { timeout: 20000 }
  )
  const data = res.data?.data
  if (!data?.accessToken) throw new Error("REFRESH_FAILED")
  tokenStore.set(data.accessToken, data.refreshToken)
  return data.accessToken
}

http.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiError>) => {
    const status = error.response?.status
    const original = error.config as AxiosRequestConfig & { _retried?: boolean }

    if (status === 401 && original && !original._retried) {
      const url = original.url || ""
      const isAuthRoute = url.includes("/auth/login") || url.includes("/auth/refresh")
      if (!isAuthRoute && tokenStore.refresh) {
        original._retried = true
        try {
          refreshing = refreshing || doRefresh()
          const token = await refreshing
          refreshing = null
          original.headers = { ...(original.headers || {}), Authorization: `Bearer ${token}` }
          return http.request(original)
        } catch (refreshError) {
          refreshing = null
          const status = (refreshError as AxiosError)?.response?.status
          if (status === 401 || status === 403 || (refreshError as Error)?.message === 'REFRESH_FAILED') {
            tokenStore.clear()
            onUnauthorized?.()
          }
          return Promise.reject(refreshError)
        }
      } else if (!isAuthRoute) {
        tokenStore.clear()
        onUnauthorized?.()
      }
    }

    return Promise.reject(error)
  }
)

/** 统一解包 { code, message, data }，失败时抛出可读错误 */
export async function request<T>(config: AxiosRequestConfig): Promise<T> {
  const res = await http.request<ApiEnvelope<T>>(config)
  const body = res.data
  if (body && typeof body === "object" && "code" in body) {
    if (body.code !== 0) throw new Error(body.message || "请求失败")
    return body.data
  }
  return body as unknown as T
}

export function get<T>(url: string, params?: object) {
  return request<T>({ url, method: "GET", params })
}

export function post<T>(url: string, data?: unknown) {
  return request<T>({ url, method: "POST", data })
}

export function patch<T>(url: string, data?: unknown) {
  return request<T>({ url, method: "PATCH", data })
}

export function put<T>(url: string, data?: unknown) {
  return request<T>({ url, method: "PUT", data })
}

export function del<T>(url: string, params?: object) {
  return request<T>({ url, method: "DELETE", params })
}

/** 把 axios 错误转换为人类可读文案 */
export function errorMessage(error: unknown): string {
  const err = error as AxiosError<ApiError>
  if (err?.response?.data?.message) return err.response.data.message
  if (err?.code === "ECONNABORTED") return "请求超时，请稍后重试"
  if (err?.message === "Network Error") return "无法连接服务器，请确认后端已启动"
  return err?.message || "未知错误"
}

/** 弹出一条错误提示，返回文案 */
export function toastError(error: unknown, fallback = "操作失败"): string {
  const msg = errorMessage(error) || fallback
  ElMessage.error(msg)
  return msg
}

export function toastOk(message = "操作成功") {
  ElMessage.success(message)
}