/**
 * 内置工具冒烟测试：每个工具都真的调一次，断言返回结构合理。
 *
 * 用法：cd apps/api && node scripts/tools-smoke.mjs
 * 需要先构建：pnpm --filter api build
 */
import { ToolRegistry } from "../dist/src/tools/tool-registry.js"

let pass = 0
let fail = 0
const ok = (label, cond, extra = "") => {
  if (cond) pass++
  else fail++
  console.log(`${cond ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`)
}

const ctx = (input) => ({ userId: "smoke", conversationId: null, input })

async function run(key, input) {
  return ToolRegistry.run(key, ctx(input))
}

console.log("=== 目录 ===")
const catalog = ToolRegistry.catalog()
ok("内置工具已注册", catalog.length >= 10, `${catalog.length} 个`)
const keys = catalog.map((t) => t.key)
ok("工具 key 不重复", new Set(keys).size === keys.length)
ok("每个工具都有描述", catalog.every((t) => (t.description || "").length > 8),
  catalog.filter((t) => (t.description || "").length <= 8).map((t) => t.key).join(", ") || "全部合格")
const defs = ToolRegistry.toToolDefs()
ok("能生成模型可用的工具定义", defs.every((d) => d.name && d.description && d.parameters),
  `${defs.length} 个定义`)
ok("工具定义里不含 handler", defs.every((d) => !("handler" in d)))

console.log("\n=== calculator（自写解析器，重点验证） ===")
const calcCases = [
  ["1+2", 3],
  ["(85+92)/2*0.4", 35.4],
  ["2^10", 1024],
  ["10%3", 1],
  ["-5+3", -2],
  ["2*(3+4)-10/2", 9],
  ["1.5*4", 6],
  ["100/8", 12.5]
]
for (const [expr, expected] of calcCases) {
  try {
    const r = await run("calculator", { expression: expr })
    ok(`计算 ${expr}`, Math.abs(r.result - expected) < 1e-9, `= ${r.result}（期望 ${expected}）`)
  } catch (err) {
    ok(`计算 ${expr}`, false, err.message)
  }
}
// 必须拒绝注入
for (const bad of ["process.exit(1)", "1;alert(1)", "require('fs')", "1/0", "((1+2)"]) {
  try {
    const r = await run("calculator", { expression: bad })
    ok(`拒绝危险/非法表达式 ${bad}`, bad === "1/0" ? false : false, `竟然返回 ${JSON.stringify(r)}`)
  } catch {
    ok(`拒绝危险/非法表达式 ${bad}`, true)
  }
}

console.log("\n=== datetime ===")
const dt = await run("datetime", { timezone: "Asia/Shanghai" })
ok("返回本地时间", !!dt.local && !!dt.weekday, `${dt.local} ${dt.weekday}`)
ok("时区正确记录", dt.timezone === "Asia/Shanghai")
const dtShift = await run("datetime", { timezone: "Asia/Shanghai", offsetDays: 7 })
ok("支持日期偏移", !!dtShift.shiftedDate, `+7 天 = ${dtShift.shiftedDate}`)
try {
  await run("datetime", { timezone: "Not/AZone" })
  ok("非法时区被拒绝", false)
} catch {
  ok("非法时区被拒绝", true)
}

console.log("\n=== unit_convert ===")
const u1 = await run("unit_convert", { value: 1, from: "km", to: "m" })
ok("1 km = 1000 m", u1.result === 1000, JSON.stringify(u1.to))
const u2 = await run("unit_convert", { value: 1, from: "kg", to: "斤" })
ok("1 kg = 2 斤", u2.result === 2, JSON.stringify(u2.to))
const u3 = await run("unit_convert", { value: 1, from: "GB", to: "MB" })
ok("1 GB = 1024 MB", u3.result === 1024, JSON.stringify(u3.to))
try {
  await run("unit_convert", { value: 1, from: "km", to: "kg" })
  ok("跨类别换算被拒绝", false)
} catch {
  ok("跨类别换算被拒绝", true)
}

console.log("\n=== text_stats ===")
const ts = await run("text_stats", {
  text: "本文研究校园智能体。校园智能体需要技能系统。校园智能体也要安全。\n第二段。",
  topN: 3
})
ok("统计中文字数", ts.chineseChars > 20, `${ts.chineseChars} 字`)
ok("统计行数", ts.lines === 2, `${ts.lines} 行`)
ok("给出高频词", ts.topWords.length > 0,
  ts.topWords.map((w) => `${w.word}×${w.count}`).join(", "))

console.log("\n=== regex_extract ===")
const rx = await run("regex_extract", {
  text: "联系 13812345678 或 010-52576021，邮箱 a@b.edu.cn",
  pattern: "1[3-9]\\d{9}"
})
ok("提取手机号", rx.count === 1 && rx.matches[0] === "13812345678", JSON.stringify(rx.matches))
try {
  await run("regex_extract", { text: "x", pattern: "([a-z" })
  ok("非法正则被拒绝", false)
} catch {
  ok("非法正则被拒绝", true)
}

console.log("\n=== json_tool ===")
const js = await run("json_tool", { action: "format", json: '{"a":1,"b":[2,3]}' })
ok("格式化 JSON", js.result.includes("\n"), js.result.replace(/\n/g, "\\n"))
const jq = await run("json_tool", { action: "query", json: '{"data":{"items":[{"name":"甲"}]}}', path: "data.items.0.name" })
ok("按路径取值", jq.value === "甲", JSON.stringify(jq.value))
try {
  await run("json_tool", { action: "format", json: "{bad" })
  ok("非法 JSON 被拒绝", false)
} catch {
  ok("非法 JSON 被拒绝", true)
}

console.log("\n=== encode_tool ===")
const e1 = await run("encode_tool", { action: "base64_encode", text: "社科大" })
const e2 = await run("encode_tool", { action: "base64_decode", text: e1.result })
ok("Base64 往返一致", e2.result === "社科大", e1.result)
const e3 = await run("encode_tool", { action: "md5", text: "abc" })
ok("MD5 正确", e3.result === "900150983cd24fb0d6963f7d28e17f72", e3.result)
const e4 = await run("encode_tool", { action: "sha256", text: "abc" })
ok("SHA256 正确", e4.result.startsWith("ba7816bf"), e4.result.slice(0, 16) + "…")

console.log("\n=== random_tool ===")
const r1 = await run("random_tool", { action: "uuid", count: 3 })
ok("生成 UUID", r1.uuids.length === 3 && /^[0-9a-f-]{36}$/.test(r1.uuids[0]))
ok("UUID 互不相同", new Set(r1.uuids).size === 3)
const r2 = await run("random_tool", { action: "integer", count: 20, min: 1, max: 6 })
ok("随机整数落在区间内", r2.values.every((v) => v >= 1 && v <= 6),
  `范围 ${Math.min(...r2.values)}~${Math.max(...r2.values)}`)
const r3 = await run("random_tool", { action: "pick", count: 2, items: ["a", "b", "c", "d"] })
ok("抽样不重复", new Set(r3.picked).size === 2, JSON.stringify(r3.picked))
const r4 = await run("random_tool", { action: "shuffle", items: [1, 2, 3, 4, 5] })
ok("洗牌不丢元素", r4.shuffled.length === 5 && new Set(r4.shuffled).size === 5)

console.log("\n=== 网络类工具（真实请求） ===")
try {
  const w = await run("weather", { city: "北京", days: 3 })
  ok("天气查询", !!w.current?.temperature, `${w.city} ${w.current.weather} ${w.current.temperature}℃`)
  ok("天气含预报", w.forecast.length === 3, `${w.forecast.length} 天`)
} catch (err) {
  ok("天气查询", false, err.message)
}

try {
  const x = await run("exchange_rate", { from: "USD", to: "CNY", amount: 100 })
  ok("汇率换算", x.converted > 0, `100 USD = ${x.converted} CNY（汇率 ${x.rate}）`)
} catch (err) {
  ok("汇率换算", false, err.message)
}

try {
  const g = await run("github_repo", { repo: "vuejs/core" })
  ok("GitHub 仓库查询", g.stars > 1000, `${g.fullName} ★${g.stars} ${g.language}`)
} catch (err) {
  ok("GitHub 仓库查询", false, err.message)
}

try {
  const ip = await run("ip_lookup", { ip: "8.8.8.8" })
  ok("IP 归属查询", !!ip.country, `8.8.8.8 → ${ip.country} ${ip.city} ${ip.isp}`)
} catch (err) {
  ok("IP 归属查询", false, err.message)
}

try {
  const f = await run("web_fetch", { url: "https://www.baidu.com", maxChars: 400 })
  ok("网页抓取", f.length > 0, `标题「${f.title}」抓取 ${f.length} 字`)
} catch (err) {
  ok("网页抓取", false, err.message)
}

console.log("\n=== 错误处理 ===")
try {
  await run("calculator", {})
  ok("缺必填参数时报错", false)
} catch (err) {
  ok("缺必填参数时报错", /缺少必填/.test(err.message), err.message)
}
try {
  await run("nonexistent_tool", {})
  ok("未知工具名报错", false)
} catch (err) {
  ok("未知工具名报错", /没有名为/.test(err.message), err.message)
}

console.log(`\n内置工具冒烟：${pass} 项通过，${fail} 项失败`)
if (fail > 0) process.exit(1)
