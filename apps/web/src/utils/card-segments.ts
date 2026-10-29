/**
 * 消息正文的分段解析：把一段助手回复拆成「普通 Markdown」与「卡片」交替的序列。
 *
 * ── 为什么需要它 ──
 *
 * 卡片是**可交互的 Vue 组件**（选项卡要能点、要能提交），不能走 v-html。
 * MarkdownView 的产物是 HTML 字符串，把组件塞进去不会被挂载、事件也不会绑上。
 * 所以必须先把「哪一段是卡片」切出来，再分别交给 MarkdownView 与卡片组件。
 *
 * ── 卡片的载体：```card 围栏 ──
 *
 * 约定助手用 ```card 围栏输出一段 JSON：
 *
 *     ```card
 *     { "type": "options", "title": "…" }
 *     ```
 *
 * 选围栏代码块而不是自定义 HTML 标签，有三个理由：
 *   1. 模型对「输出围栏 JSON」极熟练，可靠性远高于让它写 HTML；
 *   2. 前端不认识该类型时，它会退化成一段可读代码块，
 *      而不是把半截 HTML 泼到页面上；
 *   3. 只需处理一种语法，不必引入 HTML 解析器（学生端刻意保持零重依赖）。
 *
 * ── 流式期间必须特殊处理 ──
 *
 * 回复是一点点长出来的，围栏只到一半时 JSON 必然不合法。
 * 若按「解析失败 → 当普通文本」处理，用户会看到一坨花括号在屏幕上闪烁，
 * 然后突然变成卡片。因此显式区分三种状态：
 *   完整且合法   → 卡片
 *   完整但不合法 → 退化成代码块（保留原文，不吞内容）
 *   尚未闭合     → 占位（渲染成「卡片生成中」，不展示半截 JSON）
 */

/** 卡片围栏语言标记。提示词侧与解析侧共用这一个常量 */
import {isUiDocument} from './agent-ui'
import {parseCardJson} from './card-json'
export const CARD_FENCE = "card"

export type Segment =
  | { kind: "markdown"; text: string }
  /** JSON 解析成功的卡片 */
  | { kind: "card"; card: Record<string, unknown> }
  /** 围栏完整但 JSON 不合法：按代码块原样展示 */
  | { kind: "broken"; text: string }
  /** 围栏尚未闭合（流式中） */
  | { kind: "pending"; text?:string }

/** Per-answer cache: complete immutable blocks survive subsequent text chunks. */
export class CardBlockCache {
  private blocks=new Map<string,unknown>();private size=0
  parses=0;hits=0
  parse(raw:string):unknown {
    if(this.blocks.has(raw)){this.hits++;return this.blocks.get(raw)}
    this.parses++;const value=parseCardJson(raw)
    // Legacy skill migration below mutates its input; do not retain those objects.
    if(value&&typeof value==='object'&&!Array.isArray(value)&&!['agents','skills'].includes(String((value as any).type))&&raw.length<=131072){
      while(this.blocks.size&&(this.blocks.size>=24||this.size+raw.length>262144)){const first=this.blocks.keys().next().value!;this.size-=first.length;this.blocks.delete(first)}
      this.blocks.set(raw,value);this.size+=raw.length
    }
    return value
  }
}

/**
 * 这里刻意**不**再维护一份「已知类型」常量表。
 *
 * 类型清单的权威来源已经有两处，且各自必要：
 *   - utils/card-protocol.ts —— 告诉模型能输出什么（提示词侧）
 *   - StudentCard.vue 的模板分支 —— 前端能渲染什么
 * 下方兼容校验仅用于辨认误标为 json 或旧标签的模型输出，
 * 不限制 card 围栏的类型扩展；新类型仍由组件处理。
 * 模型输出未知类型时由 StudentCard 的兜底分支接住，不会白屏。
 */

/** 围栏起始行：```card（允许前置空白，忽略大小写） */
function fenceLanguage(line: string): string | null {
  const m = /^\s*```([a-zA-Z0-9_-]*)\s*$/.exec(line)
  const language=m?.[1].toLowerCase()
  return language===CARD_FENCE || language==='json'?language:null
}

/** Some models label an actual card as json; leave ordinary JSON code intact. */
export function isCompatibleCard(value:Record<string,unknown>):boolean{
  const type=value.type
  if(isUiDocument(value))return type==='page'?Array.isArray(value.children):typeof value.id==='string'
  if(['care','comfort','crisis','notice','reading','poem'].includes(String(type)))return typeof value.body==='string'
  if(['sections','article'].includes(String(type)))return Array.isArray(value.sections)
  if(['facts','timeline','checklist','guide','places','sources'].includes(String(type)))return Array.isArray(value.items)
  if(type==='compare')return Array.isArray(value.columns)&&Array.isArray(value.rows)
  if(type==='steps')return Array.isArray(value.steps)
  if(type==='options')return Array.isArray(value.options)
  if(type==='agents')return Array.isArray(value.agents)||Array.isArray(value.skills)
  if(type==='map')return ['liangxiang','wangjing'].includes(String(value.campus))
  if(type==='takeout')return typeof value.title==='string'
  if(type==='effect')return ['tiger','melon','cat'].includes(String(value.effect))
  if(type==='dinner')return Array.isArray(value.restaurants)&&value.restaurants.length>0&&value.restaurants.length<=500&&value.restaurants.every(name=>typeof name==='string'&&name.trim().length>0&&name.length<=80)
  return false
}

/** 围栏闭合行：单独三个反引号 */
function isCloseFence(line: string): boolean {
  return /^\s*```\s*$/.test(line)
}

/** Accept historical JSON-in-card tags as data, never render their HTML. Skip code examples. */
function normalizeLegacyCards(text:string):string{
  const result:string[]=[],plain:string[]=[];let fence=''
  const flush=()=>{if(!plain.length)return;result.push(plain.join('\n').replace(/<card\s+type=["']([a-z_-]+)["']\s*>\s*([\s\S]*?)\s*<\/card>/gi,(original,type,raw)=>{
    try{const value:any=parseCardJson(raw);if(!value||typeof value!=='object'||Array.isArray(value)||value.type!==type||!isCompatibleCard(value))return original;return '\n```card\n'+JSON.stringify(value)+'\n```\n'}catch{return original}
  }));plain.length=0}
  for(const line of text.split('\n')){const mark=/^\s*(`{3,}|~{3,})(.*)$/.exec(line)
    if(fence){result.push(line);if(mark&&mark[1][0]===fence[0]&&mark[1].length>=fence.length&&!mark[2].trim())fence='';continue}
    if(mark){flush();fence=mark[1];result.push(line)}else plain.push(line)
  }
  flush();return result.join('\n')
}

/**
 * 扫描出所有 ```card 围栏。
 *
 * 手写逐行状态机而不用正则：围栏可能出现在列表项、引用块内部，
 * 还可能与普通代码块混排。正则处理这些边界很容易出错，
 * 而状态机短且可推理。
 */
export function parseCardSegments(text: string,cache?:CardBlockCache): Segment[] {
  const out: Segment[] = []
  if (!text) return out

  const lines = normalizeLegacyCards(text).split("\n")
  let buffer: string[] = []
  let i = 0

  const flushMarkdown = () => {
    if (!buffer.length) return
    const joined = buffer.join("\n")
    // 纯空白段不产出，避免多出空节点影响间距
    if (joined.trim()) out.push({ kind: "markdown", text: joined })
    buffer = []
  }

  while (i < lines.length) {
    const line = lines[i]

    const language=fenceLanguage(line),start=i
    if (!language) {
      // Card examples inside ordinary or longer fences remain literal code.
      const literal=/^\s*(`{3,}|~{3,}).*$/.exec(line)
      if(literal){buffer.push(line);i++;while(i<lines.length){const current=lines[i++];buffer.push(current);const close=/^\s*(`{3,}|~{3,})\s*$/.exec(current);if(close&&close[1][0]===literal[1][0]&&close[1].length>=literal[1].length)break}continue}
      buffer.push(line)
      i++
      continue
    }

    // 命中起始行，向后找闭合行
    const body: string[] = []
    let closed = false
    i++
    while (i < lines.length) {
      if (isCloseFence(lines[i])) {
        closed = true
        i++
        break
      }
      body.push(lines[i])
      i++
    }

    if(language===CARD_FENCE)flushMarkdown()

    /*
     * 未闭合只可能是流式还没写完。此时正文的前半截可能已经是合法 JSON，
     * 但**不要**提前渲染：选项卡渲染一半会被点击，产生错误的提交内容。
     */
    if (!closed) {
      if(language==='json'&&!/"type"\s*:\s*"(?:page|form|table|chart|info_card|service_card|key_values|card_group|button|image|text|steps|checklist|timeline|notice|faq|options)"/.test(body.join('\n')))buffer.push(...lines.slice(start,i))
      else {flushMarkdown();out.push({ kind: "pending",text:body.join('\n') })}
      continue
    }

    const raw = body.join("\n").trim()
    try {
      const parsed:any = cache?cache.parse(raw):parseCardJson(raw)
      if(language==='json'){
        if(!parsed || typeof parsed!=='object' || Array.isArray(parsed) || !isCompatibleCard(parsed)){buffer.push(...lines.slice(start,i));continue}
        flushMarkdown()
      }
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        if(parsed.type==='agents'&&Array.isArray(parsed.skills)){
          const legacy=parsed.skills.filter((s:any)=>/^(ucass-kb-(survival|takeout)|kb-)/.test(s.key||''))
          if(legacy.length){
            parsed.skills=parsed.skills.filter((s:any)=>!legacy.includes(s))
            if(parsed.skills.length||parsed.agents?.length)out.push({kind:'card',card:parsed})
            out.push({kind:'card',card:{type:'guide',title:'知识库资料',intro:'校园生活经验通过知识库查询。',items:legacy.map((s:any)=>({label:s.name||'校园资料',action:'请查询'+(s.name||'校园生活')+'知识库内容'}))}})
            continue
          }
        }
        if(parsed.type==='skills' &&Array.isArray(parsed.items)&&parsed.items.length&&parsed.items.every((s:any)=>/^(ucass-kb-(survival|takeout)|kb-)/.test(s.key||s.skillKey||''))){
          out.push({kind:'card',card:{type:'guide',title:'知识库资料',intro:'这些内容已收录知识库，可直接查询。',items:parsed.items.map((s:any)=>({label:s.name||s.label||'校园生活资料',action:'请查询'+(s.name||s.label||'校园生活资料')+'知识库内容',desc:s.description||''}))}})
        }else out.push({ kind: "card", card: parsed as Record<string, unknown> })
      } else {
        // 合法 JSON 但不是对象（数组/字符串/数字）：当代码块
        out.push({ kind: "broken", text: raw })
      }
    } catch {
      if(language==='json'&&!/"type"\s*:\s*"(?:page|form|table|chart|info_card|service_card|key_values|card_group|button|image|text|steps|checklist|timeline|notice|faq|options)"/.test(raw)){buffer.push(...lines.slice(start,i));continue}
      /*
       * 模型偶尔会在 JSON 里写注释或漏逗号。这里**不尝试修复** ——
       * 自动修复会掩盖问题，还可能把内容改成模型本意之外的东西。
       * 原样降级为代码块，用户至少看得到内容。
       */
      out.push({ kind: "broken", text: raw })
    }
  }

  flushMarkdown()
  return out
}

/** 是否含卡片围栏（完整或未完整都算），供外层决定是否走分段渲染 */
export function mayContainCard(text: string): boolean {
  return text.includes("```" + CARD_FENCE)
}
