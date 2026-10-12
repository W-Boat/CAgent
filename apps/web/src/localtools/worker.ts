/**
 * 本地浏览器「工作循环」。
 *
 * 服务端只入队指令，这里负责：
 *   1. 心跳（让后台知道本地浏览器在线）
 *   2. 长轮询领取指令
 *   3. 在本地页面执行
 *   4. 回填结果与截图
 *
 * 之所以用轮询而不是 WebSocket：浏览器扩展的 Service Worker 会随时休眠，
 * 长连接会被掐断；轮询实现简单且在各端都稳定。
 */
import { get, post } from "@/api/client"
import { executeLocalAction, type ExecContext, type LocalActionResult } from "./executor"

export interface ClaimedCommand {
  id: string
  seq: number
  action: string
  selector?: string | null
  value?: string | null
  timeout?: number
}

export interface LoopOptions {
  sessionId: string
  clientKind: "WEB" | "EXTENSION"
  /** 取当前要操作的 document/window（扩展模式下由插件注入目标标签页） */
  getContext: () => Promise<ExecContext> | ExecContext
  /** 截图能力（可选）：网页端通常没有，扩展端由插件提供 */
  capture?: () => Promise<string | null>
  /** 每条指令执行完的回调，便于界面即时刷新 */
  onResult?: (command: ClaimedCommand, result: LocalActionResult) => void
  onError?: (err: unknown) => void
}

const POLL_INTERVAL = 1200
const HEARTBEAT_INTERVAL = 15_000

/**
 * 启动工作循环，返回停止函数。
 *
 * 轮询间隔 1.2 秒：足够跟手，又不会把服务器打满；
 * 没有指令时服务端立刻返回空，不占用连接。
 */
export function startLocalWorker(options: LoopOptions): () => void {
  let stopped = false
  let running = false

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  async function tick() {
    if (stopped || running) return
    running = true
    try {
      const res = await post<{ command: ClaimedCommand | null; sessionClosed?: boolean }>(
        `/browser/sessions/${options.sessionId}/commands/claim`,
        { clientKind: options.clientKind }
      )

      if (res?.sessionClosed) {
        stopped = true
        return
      }

      const command = res?.command
      if (!command) return

      const started = Date.now()
      let result: LocalActionResult

      try {
        const ctx = await options.getContext()
        if (options.capture && !ctx.capture) ctx.capture = options.capture
        result = await executeLocalAction(ctx, {
          action: command.action,
          selector: command.selector ?? undefined,
          value: command.value ?? undefined,
          timeout: command.timeout ?? undefined
        })
      } catch (err) {
        result = {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - started
        }
      }

      await post(`/browser/commands/${command.id}/report`, {
        ok: result.ok,
        result: result.result,
        screenshot: result.screenshot,
        url: result.url,
        title: result.title,
        error: result.error,
        durationMs: result.durationMs
      })

      options.onResult?.(command, result)
    } catch (err) {
      // 网络抖动不该让循环退出；上报错误后继续下一轮
      options.onError?.(err)
    } finally {
      running = false
    }
  }

  // 心跳与轮询分开：claim 本身也会刷新心跳，这里只是兜底
  const heartbeatTimer = window.setInterval(() => {
    if (stopped) return
    void post(`/browser/sessions/${options.sessionId}/heartbeat`, {
      clientKind: options.clientKind
    }).catch(() => undefined)
  }, HEARTBEAT_INTERVAL)

  let timer = 0
  const loop = async () => {
    if (stopped) return
    await tick()
    if (!stopped) timer = window.setTimeout(loop, POLL_INTERVAL)
  }
  void loop()

  return () => {
    stopped = true
    window.clearInterval(heartbeatTimer)
    window.clearTimeout(timer)
  }
}

/** 创建会话（本地执行） */
export function createLocalSession(payload: {
  name?: string
  startUrl?: string
  clientKind: "WEB" | "EXTENSION"
}) {
  return post<{ id: string; name: string }>("/browser/sessions", {
    ...payload,
    executor: "LOCAL"
  })
}

/** 下发一条指令 */
export function enqueueCommand(
  sessionId: string,
  payload: { action: string; selector?: string; value?: string; timeout?: number }
) {
  return post<ClaimedCommand>(`/browser/sessions/${sessionId}/commands`, payload)
}

/** 拉取指令队列（展示进度用） */
export function listCommands(sessionId: string, sinceSeq = 0) {
  return get<{ items: unknown[] }>(`/browser/sessions/${sessionId}/commands`, {
    sinceSeq
  })
}
