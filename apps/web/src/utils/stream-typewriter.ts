/**
 * 流式输出的「打字机」平滑器。
 *
 * ── 为什么需要 ──
 *
 * SSE 一帧可能吐来几十个字，直接整块追加进正文会出现「一顿一跳」的
 * 灌入感（Codex / ChatGPT 那种字符匀速流出的效果没有了）。
 * 这里把「网络到达的全文」与「界面已显示的长度」拆开：
 *   - push() 只累计全文；
 *   - 内部 rAF 循环每帧把显示进度推进一小步，write 回调把
 *     full.slice(0, shown) 写进响应式字段；
 *   - 步长自适应：剩余越多走得越快；结构化描述在下一帧完整显示，突发不积压、
 *     平时不拖尾；
 *   - end() 后下一帧完整显示并回调 onCaughtUp，缓存命中和网络完成不额外等待。
 *
 * ── 滚动为何也归它管 ──
 *
 * 自动滚动如果各自监听内容变化（watch / 事件），一帧内可能滚多次或
 * 与文字写入不同帧，看起来就是「跳」。onFrame 钩子在**每个有进展的帧**
 * 恰好调用一次，视图把「贴底滚动」挂上去，滚动与文字严格同帧，视觉连续。
 *
 * ── 键的选择 ──
 *
 * 状态按 **target 对象引用**（响应式代理）为键，而不是消息 id：
 * onMeta 会在流中途回填真实 id，按 id 键控会让缓冲「换了个键」断档。
 * 状态保留到 dispose()（每个状态只多持有一份全文引用，量级可忽略）。
 */

interface TyperState {
  /** 网络侧已到达的全文 */
  full: string
  /** 界面已显示的字符数 */
  shown: number
  /** 网络侧是否已结束（end 已调用） */
  ended: boolean
  /** 播完回调（end 时登记，播完帧触发一次） */
  onCaughtUp?: () => void
  /** 播完回调是否已触发 */
  reported: boolean
}

export interface StreamTyper {
  /** 追加文本（流式 onText） */
  reset(target: object): void
  push(target: object, text: string): void
  /** 网络侧结束；下一帧完整显示，触发 onCaughtUp */
  end(target: object, onCaughtUp?: () => void): void
  /** 立即完整显示（停止 / 出错 / 重开时用），并把该目标标记为已结束 */
  flush(target: object): void
  flushAll(): void
  /** 视图卸载时调用，停掉循环并清空状态 */
  dispose(): void
}

export function createStreamTyper(opts: {
  /** 每帧写入当前应显示的文本（写入响应式字段触发渲染） */
  write: (target: object, text: string) => void
  /** 每个有进展的帧调用一次（同步滚动） */
  onFrame?: () => void
  /** 基础速度：每帧最少推进的字符数，60fps 下默认 ≈ 每秒 210 字 */
  baseCharsPerFrame?: number
}): StreamTyper {
  const base = Math.max(1, opts.baseCharsPerFrame ?? 3.5)
  const states = new Map<object, TyperState>()
  let handle = 0

  const stateOf = (target: object): TyperState => {
    let st = states.get(target)
    if (!st) {
      st = { full: "", shown: 0, ended: false, reported: false }
      states.set(target, st)
    }
    return st
  }

  const tick = () => {
    handle = 0
    let active = false
    let moved = false

    for (const [target, st] of states) {
      const remaining = st.full.length - st.shown
      if (remaining > 0) {
        // JSON is an interface description, not visible prose. Don't type it character by character.
        const structured=/(?:^|\n)\s*```(?:card|json)\s*\n/.test(st.full)
        const step = st.ended||structured?remaining:Math.min(remaining, Math.max(base, Math.ceil(remaining / 16)))
        st.shown += step
        opts.write(target, st.full.slice(0, st.shown))
        moved = true
      }

      if (st.ended) {
        if (st.shown >= st.full.length && !st.reported) {
          st.reported = true
          const cb = st.onCaughtUp
          st.onCaughtUp = undefined
          cb?.()
        }
      }
      // push/end wake the loop. No 60fps polling while waiting for the network.
      if (st.full.length-st.shown>0 || st.ended&&!st.reported) active = true
    }

    if (moved) opts.onFrame?.()
    if (active) handle = window.requestAnimationFrame(tick)
  }

  const ensureLoop = () => {
    if (!handle) handle = window.requestAnimationFrame(tick)
  }

  return {
    reset(target) {states.delete(target)},
    push(target, text) {
      if (!text) return
      stateOf(target).full += text
      ensureLoop()
    },

    end(target, onCaughtUp) {
      const st = stateOf(target)
      st.ended = true
      if (onCaughtUp) {
        if (st.reported) onCaughtUp()
        else st.onCaughtUp = onCaughtUp
      }
      ensureLoop()
    },

    flush(target) {
      const st = states.get(target)
      if (!st) return
      st.shown = st.full.length
      opts.write(target, st.full)
      st.ended = true
      if (!st.reported) {
        st.reported = true
        const cb = st.onCaughtUp
        st.onCaughtUp = undefined
        cb?.()
      }
    },

    flushAll() {
      for (const target of [...states.keys()]) this.flush(target)
    },

    dispose() {
      if (handle) {
        window.cancelAnimationFrame(handle)
        handle = 0
      }
      states.clear()
    }
  }
}
