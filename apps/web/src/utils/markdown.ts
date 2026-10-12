import MarkdownIt from "markdown-it"
import {shallowRef} from "vue"
import {cjkStrong} from './cjk-strong'

export const highlightRevision=shallowRef(0)
let highlighter:typeof import("./syntax-highlight")|null=null
let highlightingRequest:Promise<void>|null=null
function loadHighlighter(){
  if(highlighter||highlightingRequest)return
  highlightingRequest=import("./syntax-highlight").then(module=>{highlighter=module;cache.clear();highlightRevision.value++}).catch(()=>{highlightingRequest=null})
}

const shared = {
  html: false,
  linkify: true,
  breaks: true
} as const

/** 外链统一新窗口打开 */
function hardenLinks(instance: MarkdownIt) {
  const defaultLinkOpen =
    instance.renderer.rules.link_open ||
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))

  instance.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    tokens[idx].attrSet("target", "_blank")
    tokens[idx].attrSet("rel", "noopener noreferrer")
    return defaultLinkOpen(tokens, idx, options, env, self)
  }
}

/**
 * 代码块外壳：带语言标签与「复制」按钮。
 *
 * 复制按钮不内联代码内容（避免转义地狱），点击时从同级的 <code> 读取文本，
 * 事件由 MarkdownView 代理处理。
 */
function wrapFence(instance: MarkdownIt) {
  instance.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx]
    const declared = (token.info || "").trim().split(/\s+/)[0]
    const highlighted=highlighter?.highlightCode(token.content,declared)
    const body=`<pre class="hljs"><code>${highlighted ?? instance.utils.escapeHtml(token.content)}</code></pre>`

    return (
      `<div class="md-code">` +
      `<div class="md-code-bar">` +
      `<span class="md-code-lang">${instance.utils.escapeHtml(declared || "text")}</span>` +
      `<button type="button" class="md-copy" aria-label="复制代码">复制</button>` +
      `</div>` +
      body +
      `</div>`
    )
  }
}

/**
 * 流式期间不做语法高亮：hljs 对「还在长出来的、可能未闭合的」代码块既慢又没意义，
 * 等回答结束再做一次完整高亮即可。两个实例只差 fence 渲染规则。
 */
function createRenderer(withHighlight: boolean): MarkdownIt {
  const instance = new MarkdownIt(shared)
  cjkStrong(instance)
  hardenLinks(instance)
  if (withHighlight) wrapFence(instance)
  else plainFence(instance)
  return instance
}

const fullRenderer = createRenderer(true)
const plainRenderer = createRenderer(false)

// 流式期间用「不高亮」版本渲染：把 fence 渲染成纯文本壳。
// 用 function 声明而不是 const 箭头函数 —— createRenderer() 在模块顶层立刻执行，
// 若这里是 const，会因为「暂时性死区」直接抛
// ReferenceError: Cannot access 'plainFence' before initialization。
function plainFence(instance: MarkdownIt) {
  instance.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx]
    const declared = (token.info || "").trim().split(/\s+/)[0]
    return (
      `<div class="md-code">` +
      `<div class="md-code-bar">` +
      `<span class="md-code-lang">${instance.utils.escapeHtml(declared || "text")}</span>` +
      `<button type="button" class="md-copy" aria-label="复制代码">复制</button>` +
      `</div>` +
      `<pre class="hljs"><code>${instance.utils.escapeHtml(token.content)}</code></pre>` +
      `</div>`
    )
  }
}

export interface RenderOptions {
  /** 传 false 表示正在流式输出，跳过语法高亮 */
  highlight?: boolean
}

// 同一段文本 + 同一模式只渲染一次。
// 流式合并后仍可能重复渲染相同内容（比如一帧内没有新 token），命中缓存就省掉整次解析。
const cache = new Map<string, string>()
const CACHE_LIMIT = 120

export function renderMarkdown(text?: string | null, options: RenderOptions = {}): string {
  if (!text) return ""
  void highlightRevision.value
  if(options.highlight!==false && /(?:^|\n)\s*(?:```|~~~)[^\n]*\n/.test(text))loadHighlighter()
  const mode = options.highlight === false ? "0" : "1"
  const key = `${mode}\u0000${text}`

  const hit = cache.get(key)
  if (hit !== undefined) return hit

  const html = (options.highlight === false ? plainRenderer : fullRenderer).render(text)

  if (cache.size >= CACHE_LIMIT) cache.clear()
  cache.set(key, html)
  return html
}
