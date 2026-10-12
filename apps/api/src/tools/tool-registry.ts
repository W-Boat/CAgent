import { BadRequestException } from "@nestjs/common"
import {abortScope,checkAbort} from '../common/abort'
import {parseToolArguments} from '../chat/runtime/tool-validation'

/**
 * 内置工具的元数据 + 执行器。
 *
 * 设计原则：
 *   1. **真能用** —— 每个工具都在本机实测通过才登记，不做「看起来很强但报错」的占位。
 *   2. **零配置优先** —— 不依赖外部 key 的工具（本地计算类、免费开放接口）占多数，
 *      装上平台就能用；需要 key 的会显式标注 `requiresKey`。
 *   3. **只读与安全** —— 网络类工具只做 GET 读取；本地计算类不 eval 任意代码。
 */
export interface ToolContext {
  userId: string
  conversationId?: string | null
  input: Record<string, unknown>
  signal?:AbortSignal
}

export interface ToolParam {
  type: string
  description: string
  enum?: string[]
  default?: unknown
}

export interface ToolMeta {
  /** 稳定标识，存在 Skill.config.builtin 里 */
  key: string
  name: string
  description: string
  category: string
  /** 图标名（Element Plus）或 emoji */
  icon: string
  /** 是否需要外部 API key / 网络 */
  requiresKey?: boolean
  /** 是否依赖外网（离线环境会失败） */
  needsNetwork?: boolean
  /** Explicit classification; dynamically registered tools default to sequential execution. */
  readOnly?:boolean
  parameters: Record<string, ToolParam>
  required?: string[]
  handler: (ctx: ToolContext) => Promise<unknown>
}

const TIMEOUT_MS = 15_000

/** 统一的 GET JSON 请求：带超时、UA、以及可读的错误信息 */
async function getJson(url: string, timeout = TIMEOUT_MS,signal?:AbortSignal): Promise<any> {
  const scope=abortScope(signal,timeout)
  try {
    const res = await fetch(url, {
      signal: scope.signal,
      headers: {
        "User-Agent": "CAgent/1.0 (+campus agent platform)",
        Accept: "application/json,text/plain,*/*"
      }
    })
    if (!res.ok) {
      throw new BadRequestException(`上游返回 HTTP ${res.status}：${url.slice(0, 120)}`)
    }
    const type = res.headers.get("content-type") || ""
    return type.includes("json") ? await res.json() : { text: await res.text() }
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new BadRequestException("请求超时（15 秒），请稍后重试或检查网络")
    }
    if (err instanceof BadRequestException) throw err
    throw new BadRequestException(`请求失败：${(err as Error).message}`)
  } finally {
    scope.dispose()
  }
}

/** 取字符串入参，缺失时给出可操作的报错 */
function str(ctx: ToolContext, name: string, required = true): string {
  const raw = ctx.input?.[name]
  const value = typeof raw === "string" ? raw.trim() : raw == null ? "" : String(raw)
  if (!value && required) {
    throw new BadRequestException(`缺少必填入参「${name}」`)
  }
  return value
}

function num(ctx: ToolContext, name: string, fallback?: number): number {
  const raw = ctx.input?.[name]
  if (raw === undefined || raw === null || raw === "") {
    if (fallback !== undefined) return fallback
    throw new BadRequestException(`缺少必填数字入参「${name}」`)
  }
  const value = Number(raw)
  if (Number.isNaN(value)) throw new BadRequestException(`入参「${name}」不是合法数字`)
  return value
}

// ============================================================
//  1. 本地计算类：不依赖网络，永远可用
// ============================================================

/**
 * 安全的四则运算求值。
 *
 * 不 eval：先把表达式收敛到「数字 + 运算符 + 括号 + 允许的函数」白名单，
 * 再用调度场算法自己算。这样模型传入任何字符串都不会执行代码。
 */
function safeCalculate(expression: string): number {
  const expr = expression
    .replace(/[×✕x]/gi, "*")
    .replace(/[÷]/g, "/")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/\s+/g, "")

  if (!/^[0-9+\-*/%().^]+$/.test(expr)) {
    throw new BadRequestException("表达式含不支持的字符，仅支持数字与 + - * / % ^ ( )")
  }

  // 调度场算法 → 逆波兰 → 求值
  const prec: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2, "^": 3 }
  const rightAssoc = new Set(["^"])
  const output: (number | string)[] = []
  const ops: string[] = []

  let i = 0
  // 判断「当前是否应该出现操作数」。一元负号只能出现在该位置。
  // 不能用 output 栈顶推断：处理完 ")" 后栈顶是刚弹出的运算符，
  // 会被误判成「上一项是运算符」，于是在 2*(3+4)-10/2 里凭空插入一个 0。
  let expectOperand = true
  while (i < expr.length) {
    const ch = expr[i]
    if (/[0-9.]/.test(ch)) {
      let j = i
      while (j < expr.length && /[0-9.]/.test(expr[j])) j++
      const value = Number(expr.slice(i, j))
      if (Number.isNaN(value)) throw new BadRequestException(`无法解析数字：${expr.slice(i, j)}`)
      output.push(value)
      expectOperand = false
      i = j
      continue
    }
    if (ch === "(") {
      ops.push(ch)
      expectOperand = true
      i++
      continue
    }
    if (ch === ")") {
      while (ops.length && ops[ops.length - 1] !== "(") output.push(ops.pop()!)
      if (!ops.length) throw new BadRequestException("括号不匹配")
      ops.pop()
      expectOperand = false
      i++
      continue
    }
    if (prec[ch]) {
      // 一元负号：位于表达式开头、运算符之后或左括号之后，等价于 0 - x
      if (ch === "-" && expectOperand) {
        output.push(0)
      } else if (expectOperand) {
        throw new BadRequestException(`运算符 ${ch} 的位置不对`)
      }
      while (
        ops.length &&
        ops[ops.length - 1] !== "(" &&
        (prec[ops[ops.length - 1]] > prec[ch] ||
          (prec[ops[ops.length - 1]] === prec[ch] && !rightAssoc.has(ch)))
      ) {
        output.push(ops.pop()!)
      }
      ops.push(ch)
      expectOperand = true
      i++
      continue
    }
    throw new BadRequestException(`无法识别的字符：${ch}`)
  }
  while (ops.length) {
    const op = ops.pop()!
    if (op === "(") throw new BadRequestException("括号不匹配")
    output.push(op)
  }

  const stack: number[] = []
  for (const token of output) {
    if (typeof token === "number") {
      stack.push(token)
      continue
    }
    const b = stack.pop()
    const a = stack.pop()
    if (a === undefined || b === undefined) throw new BadRequestException("表达式不完整")
    switch (token) {
      case "+":
        stack.push(a + b)
        break
      case "-":
        stack.push(a - b)
        break
      case "*":
        stack.push(a * b)
        break
      case "/":
        if (b === 0) throw new BadRequestException("除数不能为 0")
        stack.push(a / b)
        break
      case "%":
        stack.push(a % b)
        break
      case "^":
        stack.push(Math.pow(a, b))
        break
      default:
        throw new BadRequestException(`未知运算符：${token}`)
    }
  }
  if (stack.length !== 1 || !Number.isFinite(stack[0])) {
    throw new BadRequestException("表达式无法求值")
  }
  return stack[0]
}

const UNIT_TABLE: Record<string, Record<string, number>> = {
  length: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, ft: 0.3048, in: 0.0254, 里: 500, 尺: 1 / 3 },
  mass: { kg: 1, g: 0.001, mg: 0.000001, t: 1000, lb: 0.45359237, oz: 0.028349523125, 斤: 0.5 },
  area: { "m2": 1, "km2": 1e6, "cm2": 1e-4, ha: 10000, mu: 2000 / 3, acre: 4046.8564224 },
  volume: { l: 1, ml: 0.001, "m3": 1000, gal: 3.785411784, cup: 0.2365882365 },
  time: { s: 1, min: 60, h: 3600, d: 86400, week: 604800 },
  data: { B: 1, KB: 1024, MB: 1048576, GB: 1073741824, TB: 1099511627776 },
  speed: { "m/s": 1, "km/h": 1 / 3.6, mph: 0.44704, knot: 0.514444 }
}

function nowInTimezone(timezone: string): Record<string, unknown> {
  const now = new Date()
  const fmt = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, ...opts }).format(now)

  return {
    timezone,
    iso: now.toISOString(),
    local: fmt({
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }),
    date: fmt({ year: "numeric", month: "2-digit", day: "2-digit" }),
    weekday: fmt({ weekday: "long" }),
    unix: Math.floor(now.getTime() / 1000)
  }
}

// ============================================================
//  工具登记表
// ============================================================

const TOOLS: ToolMeta[] = [
  // ---------- 本地计算 ----------
  {
    key: "calculator",
    name: "数学计算",
    description: "计算四则运算表达式，支持括号与乘方。用于算分、算比例、算总价等。",
    category: "计算",
    icon: "Histogram",
    parameters: {
      expression: { type: "string", description: "算式，例如 (85+92)/2*0.4" }
    },
    required: ["expression"],
    handler: async (ctx) => {
      const expression = str(ctx, "expression")
      const value = safeCalculate(expression)
      return { expression, result: value, rounded: Number(value.toFixed(6)) }
    }
  },
  {
    key: "datetime",
    name: "日期时间",
    description: "查询当前日期时间、星期与时间戳，可指定时区（如 Asia/Shanghai）。",
    category: "计算",
    icon: "Clock",
    parameters: {
      timezone: { type: "string", description: "IANA 时区，默认 Asia/Shanghai", default: "Asia/Shanghai" },
      offsetDays: { type: "number", description: "相对今天偏移的天数，例如 7 表示一周后" }
    },
    handler: async (ctx) => {
      const timezone = str(ctx, "timezone", false) || "Asia/Shanghai"
      try {
        const base = nowInTimezone(timezone)
        const offsetRaw = ctx.input?.offsetDays
        if (offsetRaw === undefined || offsetRaw === null || offsetRaw === "") return base

        const days = Number(offsetRaw)
        if (Number.isNaN(days)) throw new BadRequestException("offsetDays 必须是数字")
        const target = new Date(Date.now() + days * 86400_000)
        const fmt = (opts: Intl.DateTimeFormatOptions) =>
          new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, ...opts }).format(target)
        return {
          ...base,
          offsetDays: days,
          shiftedDate: fmt({ year: "numeric", month: "2-digit", day: "2-digit" }),
          shiftedWeekday: fmt({ weekday: "long" })
        }
      } catch (err) {
        if (err instanceof BadRequestException) throw err
        throw new BadRequestException(`无法识别的时区「${timezone}」`)
      }
    }
  },
  {
    key: "unit_convert",
    name: "单位换算",
    description: "长度、质量、面积、体积、时间、数据、速度之间的单位换算。",
    category: "计算",
    icon: "Switch",
    parameters: {
      value: { type: "number", description: "待换算的数值" },
      from: { type: "string", description: "原单位，如 km / 斤 / GB" },
      to: { type: "string", description: "目标单位" },
      kind: {
        type: "string",
        description: "单位类别：length/mass/area/volume/time/data/speed，留空则自动识别",
        enum: ["length", "mass", "area", "volume", "time", "data", "speed"]
      }
    },
    required: ["value", "from", "to"],
    handler: async (ctx) => {
      const value = num(ctx, "value")
      const from = str(ctx, "from")
      const to = str(ctx, "to")
      const kind = str(ctx, "kind", false)

      const groups = kind ? [kind] : Object.keys(UNIT_TABLE)
      for (const g of groups) {
        const table = UNIT_TABLE[g]
        if (table?.[from] !== undefined && table?.[to] !== undefined) {
          const result = (value * table[from]) / table[to]
          return {
            kind: g,
            from: `${value} ${from}`,
            to: `${Number(result.toFixed(8))} ${to}`,
            result: Number(result.toFixed(8))
          }
        }
      }
      const available = Object.entries(UNIT_TABLE)
        .map(([g, t]) => `${g}: ${Object.keys(t).join("/")}`)
        .join("；")
      throw new BadRequestException(`无法换算 ${from} → ${to}。可用单位 —— ${available}`)
    }
  },
  {
    key: "text_stats",
    name: "文本统计",
    description: "统计字数、中文字数、词数、行数，并给出高频词。写论文、查字数要求时用。",
    category: "文本",
    icon: "Document",
    parameters: {
      text: { type: "string", description: "要统计的文本" },
      topN: { type: "number", description: "返回多少个高频词，默认 10", default: 10 }
    },
    required: ["text"],
    handler: async (ctx) => {
      const text = str(ctx, "text")
      const topN = Math.min(Math.max(num(ctx, "topN", 10), 1), 50)

      const chinese = (text.match(/[\u4e00-\u9fa5]/g) || []).length
      const letters = (text.match(/[A-Za-z]+/g) || []).length
      const lines = text.split(/\r?\n/).length

      // 中文按 2 字滑窗切词，英文按单词；够用且不引入分词依赖
      const freq = new Map<string, number>()
      for (const w of text.match(/[A-Za-z]{3,}/g) || []) {
        const k = w.toLowerCase()
        freq.set(k, (freq.get(k) ?? 0) + 1)
      }
      const han = text.match(/[\u4e00-\u9fa5]+/g) || []
      for (const seg of han) {
        for (let i = 0; i + 2 <= seg.length; i++) {
          const k = seg.slice(i, i + 2)
          freq.set(k, (freq.get(k) ?? 0) + 1)
        }
      }
      const top = [...freq.entries()]
        .filter(([, n]) => n > 1)
        .sort((a, b) => b[1] - a[1])
        .slice(0, topN)
        .map(([word, count]) => ({ word, count }))

      return {
        totalChars: text.length,
        chineseChars: chinese,
        englishWords: letters,
        lines,
        // 论文/公文一般按「字符数（不计空格）」计
        charsNoSpace: text.replace(/\s/g, "").length,
        topWords: top
      }
    }
  },
  {
    key: "regex_extract",
    name: "正则提取",
    description: "用正则表达式从文本里提取信息，如手机号、邮箱、日期、学号。",
    category: "文本",
    icon: "Search",
    parameters: {
      text: { type: "string", description: "源文本" },
      pattern: { type: "string", description: "正则表达式，不要带首尾斜杠" },
      flags: { type: "string", description: "修饰符，默认 gi", default: "gi" }
    },
    required: ["text", "pattern"],
    handler: async (ctx) => {
      const text = str(ctx, "text")
      const pattern = str(ctx, "pattern")
      const flags = str(ctx, "flags", false) || "gi"

      let re: RegExp
      try {
        re = new RegExp(pattern, flags.includes("g") ? flags : flags + "g")
      } catch (err) {
        throw new BadRequestException(`正则不合法：${(err as Error).message}`)
      }

      const matches: string[] = []
      const groups: Record<string, string>[] = []
      let m: RegExpExecArray | null
      let guard = 0
      while ((m = re.exec(text)) !== null && guard++ < 500) {
        matches.push(m[0])
        if (m.groups) groups.push(m.groups as Record<string, string>)
        if (m.index === re.lastIndex) re.lastIndex++ // 防零长度匹配死循环
      }

      return { count: matches.length, matches: matches.slice(0, 100), groups: groups.slice(0, 50) }
    }
  },
  {
    key: "json_tool",
    name: "JSON 处理",
    description: "格式化、压缩或按路径取值 JSON。调试接口返回、整理数据时用。",
    category: "文本",
    icon: "Tickets",
    parameters: {
      action: { type: "string", description: "操作", enum: ["format", "minify", "query", "keys"] },
      json: { type: "string", description: "JSON 字符串" },
      path: { type: "string", description: "取值路径（query 用），如 data.items.0.name" }
    },
    required: ["action", "json"],
    handler: async (ctx) => {
      const action = str(ctx, "action")
      const raw = str(ctx, "json")

      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch (err) {
        throw new BadRequestException(`JSON 不合法：${(err as Error).message}`)
      }

      if (action === "format") return { result: JSON.stringify(parsed, null, 2) }
      if (action === "minify") return { result: JSON.stringify(parsed) }
      if (action === "keys") {
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return { keys: Object.keys(parsed) }
        }
        if (Array.isArray(parsed)) {
          return { isArray: true, length: parsed.length, keys: Object.keys(parsed[0] ?? {}) }
        }
        return { keys: [], note: "不是对象或数组" }
      }
      if (action === "query") {
        const path = str(ctx, "path")
        let cur: any = parsed
        for (const seg of path.split(".").filter(Boolean)) {
          if (cur == null) break
          cur = Array.isArray(cur) && /^\d+$/.test(seg) ? cur[Number(seg)] : cur[seg]
        }
        return { path, found: cur !== undefined, value: cur ?? null }
      }
      throw new BadRequestException(`不支持的操作「${action}」`)
    }
  },
  {
    key: "encode_tool",
    name: "编码转换",
    description: "Base64 / URL 编解码，以及 MD5、SHA1、SHA256 摘要。",
    category: "文本",
    icon: "Key",
    parameters: {
      action: {
        type: "string",
        description: "操作",
        enum: ["base64_encode", "base64_decode", "url_encode", "url_decode", "md5", "sha1", "sha256"]
      },
      text: { type: "string", description: "待处理的文本" }
    },
    required: ["action", "text"],
    handler: async (ctx) => {
      const action = str(ctx, "action")
      const text = str(ctx, "text")
      const { createHash } = await import("node:crypto")

      switch (action) {
        case "base64_encode":
          return { result: Buffer.from(text, "utf8").toString("base64") }
        case "base64_decode":
          return { result: Buffer.from(text, "base64").toString("utf8") }
        case "url_encode":
          return { result: encodeURIComponent(text) }
        case "url_decode":
          return { result: decodeURIComponent(text) }
        case "md5":
          return { result: createHash("md5").update(text).digest("hex") }
        case "sha1":
          return { result: createHash("sha1").update(text).digest("hex") }
        case "sha256":
          return { result: createHash("sha256").update(text).digest("hex") }
        default:
          throw new BadRequestException(`不支持的操作「${action}」`)
      }
    }
  },
  {
    key: "random_tool",
    name: "随机与 UUID",
    description: "生成 UUID、随机整数、随机密码、随机抽样。分组、抽签、生成密钥时用。",
    category: "计算",
    icon: "MagicStick",
    parameters: {
      action: {
        type: "string",
        description: "操作",
        enum: ["uuid", "integer", "password", "pick", "shuffle"]
      },
      count: { type: "number", description: "生成/抽取数量，默认 1", default: 1 },
      min: { type: "number", description: "随机整数下界（含），默认 0" },
      max: { type: "number", description: "随机整数上界（含），默认 100" },
      length: { type: "number", description: "密码长度，默认 16" },
      items: { type: "array", description: "抽样/洗牌用的候选项数组" }
    },
    required: ["action"],
    handler: async (ctx) => {
      const action = str(ctx, "action")
      const count = Math.min(Math.max(num(ctx, "count", 1), 1), 100)
      const { randomUUID, randomInt } = await import("node:crypto")

      if (action === "uuid") {
        return { uuids: Array.from({ length: count }, () => randomUUID()) }
      }
      if (action === "integer") {
        const min = num(ctx, "min", 0)
        const max = num(ctx, "max", 100)
        if (max < min) throw new BadRequestException("max 不能小于 min")
        return {
          values: Array.from({ length: count }, () => randomInt(Math.floor(min), Math.floor(max) + 1))
        }
      }
      if (action === "password") {
        const length = Math.min(Math.max(num(ctx, "length", 16), 6), 128)
        const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*"
        return {
          passwords: Array.from({ length: count }, () =>
            Array.from({ length }, () => chars[randomInt(0, chars.length)]).join("")
          )
        }
      }

      const items = Array.isArray(ctx.input?.items) ? (ctx.input.items as unknown[]) : []
      if (items.length === 0) throw new BadRequestException("pick/shuffle 需要提供 items 数组")

      if (action === "pick") {
        const pool = [...items]
        const picked: unknown[] = []
        for (let i = 0; i < Math.min(count, pool.length); i++) {
          picked.push(pool.splice(randomInt(0, pool.length), 1)[0])
        }
        return { picked }
      }
      if (action === "shuffle") {
        const pool = [...items]
        for (let i = pool.length - 1; i > 0; i--) {
          const j = randomInt(0, i + 1)
          ;[pool[i], pool[j]] = [pool[j], pool[i]]
        }
        return { shuffled: pool }
      }
      throw new BadRequestException(`不支持的操作「${action}」`)
    }
  },

  // ---------- 网络查询（免费、无需 key） ----------
  {
    key: "weather",
    name: "天气查询",
    description: "查询城市实时天气与未来几天预报（Open-Meteo 免费数据源，无需密钥）。",
    category: "生活",
    icon: "Sunny",
    needsNetwork: true,
    parameters: {
      city: { type: "string", description: "城市名称，如 北京、上海、深圳" },
      days: { type: "number", description: "预报天数 1-7，默认 3", default: 3 }
    },
    required: ["city"],
    handler: async (ctx) => {
      const city = str(ctx, "city")
      const days = Math.min(Math.max(num(ctx, "days", 3), 1), 7)

      // 先用地理编码把城市名转成经纬度
      const geo = await getJson(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh&format=json`,TIMEOUT_MS,ctx.signal
      )
      const place = geo?.results?.[0]
      if (!place) throw new BadRequestException(`找不到城市「${city}」，可换更常见的写法（如「北京」）`)

      const data = await getJson(
        `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
          `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m` +
          `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
          `&timezone=Asia%2FShanghai&forecast_days=${days}`,TIMEOUT_MS,ctx.signal
      )

      // WMO 天气代码 → 中文
      const WMO: Record<number, string> = {
        0: "晴", 1: "晴间多云", 2: "多云", 3: "阴", 45: "有雾", 48: "冻雾",
        51: "小毛毛雨", 53: "毛毛雨", 55: "大毛毛雨", 56: "冻毛毛雨", 57: "强冻毛毛雨",
        61: "小雨", 63: "中雨", 65: "大雨", 66: "冻雨", 67: "强冻雨",
        71: "小雪", 73: "中雪", 75: "大雪", 77: "雪粒",
        80: "小阵雨", 81: "阵雨", 82: "强阵雨", 85: "小阵雪", 86: "大阵雪",
        95: "雷阵雨", 96: "雷阵雨伴小冰雹", 99: "雷阵雨伴大冰雹"
      }

      const cur = data?.current || {}
      const daily = data?.daily || {}
      const forecast = (daily.time || []).map((date: string, i: number) => ({
        date,
        weather: WMO[daily.weather_code?.[i]] || `代码 ${daily.weather_code?.[i]}`,
        high: daily.temperature_2m_max?.[i],
        low: daily.temperature_2m_min?.[i],
        rainChance: daily.precipitation_probability_max?.[i]
      }))

      return {
        city: `${place.name}${place.admin1 ? " · " + place.admin1 : ""}`,
        current: {
          temperature: cur.temperature_2m,
          feelsLike: cur.apparent_temperature,
          humidity: cur.relative_humidity_2m,
          windSpeed: cur.wind_speed_10m,
          weather: WMO[cur.weather_code] || `代码 ${cur.weather_code}`
        },
        forecast,
        source: "Open-Meteo"
      }
    }
  },
  {
    key: "exchange_rate",
    name: "汇率换算",
    description: "查询实时汇率并换算金额（open.er-api.com 免费数据源）。",
    category: "生活",
    icon: "Coin",
    needsNetwork: true,
    parameters: {
      from: { type: "string", description: "源货币代码，如 CNY", default: "CNY" },
      to: { type: "string", description: "目标货币代码，如 USD", default: "USD" },
      amount: { type: "number", description: "金额，默认 1", default: 1 }
    },
    handler: async (ctx) => {
      const from = (str(ctx, "from", false) || "CNY").toUpperCase()
      const to = (str(ctx, "to", false) || "USD").toUpperCase()
      const amount = num(ctx, "amount", 1)

      const data = await getJson(`https://open.er-api.com/v6/latest/${encodeURIComponent(from)}`,TIMEOUT_MS,ctx.signal)
      if (data?.result !== "success") {
        throw new BadRequestException(`无法获取 ${from} 的汇率：${data?.["error-type"] || "未知错误"}`)
      }
      const rate = data.rates?.[to]
      if (!rate) throw new BadRequestException(`不支持的货币代码「${to}」`)

      return {
        from,
        to,
        amount,
        rate,
        converted: Number((amount * rate).toFixed(4)),
        updatedAt: data.time_last_update_utc,
        source: "open.er-api.com"
      }
    }
  },
  {
    key: "ip_lookup",
    name: "IP 归属查询",
    description: "查询 IP 地址的国家、地区、城市与运营商。",
    category: "网络",
    icon: "Connection",
    needsNetwork: true,
    parameters: {
      ip: { type: "string", description: "IPv4 地址；留空则查询本机出口 IP" }
    },
    handler: async (ctx) => {
      const ip = str(ctx, "ip", false)
      const data = await getJson(`http://ip-api.com/json/${encodeURIComponent(ip)}?lang=zh-CN`,TIMEOUT_MS,ctx.signal)
      if (data?.status === "fail") {
        throw new BadRequestException(`查询失败：${data.message || "无效的 IP"}`)
      }
      return {
        ip: data.query,
        country: data.country,
        region: data.regionName,
        city: data.city,
        isp: data.isp,
        org: data.org,
        timezone: data.timezone,
        source: "ip-api.com"
      }
    }
  },
  {
    key: "github_repo",
    name: "GitHub 仓库信息",
    description: "查询 GitHub 仓库的星标、语言、简介与最近更新。",
    category: "网络",
    icon: "Star",
    needsNetwork: true,
    parameters: {
      repo: { type: "string", description: "仓库全名，如 vuejs/core" }
    },
    required: ["repo"],
    handler: async (ctx) => {
      const repo = str(ctx, "repo").replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "")
      const data = await getJson(`https://api.github.com/repos/${repo}`,TIMEOUT_MS,ctx.signal)
      if (data?.message) throw new BadRequestException(`查询失败：${data.message}`)
      return {
        fullName: data.full_name,
        description: data.description,
        stars: data.stargazers_count,
        forks: data.forks_count,
        openIssues: data.open_issues_count,
        language: data.language,
        license: data.license?.spdx_id ?? null,
        homepage: data.homepage,
        pushedAt: data.pushed_at,
        url: data.html_url
      }
    }
  },
  {
    key: "web_fetch",
    name: "网页抓取",
    description:
      "抓取指定网址并抽取正文文本。纯 HTTP 抓取，不依赖浏览器；若页面内容由 JavaScript 动态渲染，可能抓不全。",
    category: "网络",
    icon: "Link",
    needsNetwork: true,
    parameters: {
      url: { type: "string", description: "要抓取的网址，需以 http(s) 开头" },
      maxChars: { type: "number", description: "最多返回多少字符，默认 4000", default: 4000 }
    },
    required: ["url"],
    handler: async (ctx) => {
      const url = str(ctx, "url")
      if (!/^https?:\/\//i.test(url)) throw new BadRequestException("网址需以 http:// 或 https:// 开头")
      const maxChars = Math.min(Math.max(num(ctx, "maxChars", 4000), 200), 50000)

      const scope=abortScope(ctx.signal,TIMEOUT_MS)
      try {
        const res = await fetch(url, {
          signal: scope.signal,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
            Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8"
          }
        })
        if (!res.ok) throw new BadRequestException(`页面返回 HTTP ${res.status}`)

        const type = res.headers.get("content-type") || ""
        const body = await res.text()

        // JSON 直接返回，不做 HTML 清洗
        if (type.includes("json")) {
          return { url, contentType: type, text: body.slice(0, maxChars) }
        }

        const title = (body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim()
        const text = body
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
          .replace(/<!--[\s\S]*?-->/g, " ")
          .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, "\n")
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/[ \t\u00a0]+/g, " ")
          .replace(/\n{3,}/g, "\n\n")
          .trim()

        return {
          url,
          title,
          contentType: type,
          length: text.length,
          truncated: text.length > maxChars,
          text: text.slice(0, maxChars)
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") throw new BadRequestException("抓取超时（15 秒）")
        if (err instanceof BadRequestException) throw err
        throw new BadRequestException(`抓取失败：${(err as Error).message}`)
      } finally {
        scope.dispose()
      }
    }
  },

  // ---------- 校内场景（本地索引，无需网络） ----------
  {
    key: "campus_guide",
    name: "校园知识库检索",
    description:
      "检索社科大校内统一知识库（办事事项/常见问答/通知/文档/机构/课程测评/学生手册/门户入口等，随导入增长）：办理部门、地点、电话、所需材料、步骤与入口链接。只给路径，不代办。",
    category: "校园服务",
    icon: "Guide",
    parameters: {
      query: { type: "string", description: "要办的事项，如「校园卡丢了怎么补办」" },
      mode: { type: "string", description: "guide 只给指引；full 追加正文", enum: ["guide", "full"] }
    },
    required: ["query"],
    handler: async () => {
      // 真实实现由 SkillsEngineService 注入（需要 CampusGuideService），见 builtin-dispatch
      throw new BadRequestException("campus_guide 需由技能引擎调度")
    }
  }
]

const READ_ONLY_BUILTINS=new Set(['calculator','datetime','unit_convert','text_stats','regex_extract','json_tool','encode_tool','random_tool','weather','exchange_rate','ip_lookup','github_repo','web_fetch','campus_guide'])
for(const tool of TOOLS)tool.readOnly=READ_ONLY_BUILTINS.has(tool.key)&&tool.key!=='random_tool'&&tool.key!=='datetime'
const REGISTRY = new Map(TOOLS.map((t) => [t.key, t]))

export class ToolRegistry {
  /** 全部内置工具（不含需要引擎特殊调度的） */
  static all(): ToolMeta[] {
    return TOOLS
  }

  static get(key: string): ToolMeta | undefined {
    return REGISTRY.get(key)
  }

  static has(key: string): boolean {
    return REGISTRY.has(key)
  }

  /**
   * 动态登记工具。
   *
   * 供「需要 NestJS 注入的 Service 才能工作」的工具在模块初始化时挂载 ——
   * 它们不能写在这个文件的模块级常量里（那时 Prisma 还没连上）。
   * 同名则覆盖，便于热重载时不会累积重复项。
   */
  static registerAll(defs: ToolMeta[]): void {
    for (const def of defs) {
      REGISTRY.set(def.key, def)
      const existing = TOOLS.findIndex((t) => t.key === def.key)
      if (existing >= 0) TOOLS[existing] = def
      else TOOLS.push(def)
    }
  }

  /**
   * 生成给模型的工具定义（OpenAI / Anthropic 通用形状）。
   * 只暴露 JSON Schema 部分，handler 不外传。
   *
   * @param keys 指定要暴露的工具；留空表示全部全局工具
   */
  static toToolDefs(keys?: string[]): {
    name: string
    description: string
    parameters: Record<string, unknown>
  }[] {
    let list: ToolMeta[]
    if (keys?.length) {
      list = keys.map((k) => REGISTRY.get(k)).filter(Boolean) as ToolMeta[]
    } else {
      list = TOOLS
    }

    return list.map((t) => ({
      name: t.key,
      description: t.description,
      parameters: {
        type: "object",
        properties: Object.fromEntries(
          Object.entries(t.parameters).map(([name, p]) => [
            name,
            {
              type: p.type,
              description: p.description,
              ...(p.enum ? { enum: p.enum } : {})
            }
          ])
        ),
        required: t.required ?? []
      }
    }))
  }

  /** 执行工具 */
  static async run(key: string, ctx: ToolContext): Promise<unknown> {
    const tool = REGISTRY.get(key)
    if (!tool) throw new BadRequestException(`没有名为「${key}」的内置工具`)
    checkAbort(ctx.signal)
    const def=this.toToolDefs([key])[0]
    parseToolArguments(def,JSON.stringify(ctx.input))
    return tool.handler(ctx)
  }

  /** 给界面用的目录（不含 handler） */
  static catalog() {
    return TOOLS.map(({ handler: _handler, ...rest }) => rest)
  }
}
