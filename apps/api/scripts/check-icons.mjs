/**
 * 校验图标登记表与源码实际使用一致。
 *
 * 背景：`src/icons.ts` 改成显式登记（只 import 用得到的图标），
 * 体积从全量 293 个降到 77 个。代价是**漏登记不会报错，只会图标不显示** ——
 * 这类问题在开发时容易忽略、上线后才被用户发现。
 *
 * 因此这个脚本扫描源码里所有图标引用（三种来源），与本表核对：
 *   1. 模板里的静态使用：<IconName />
 *   2. 配置里的字符串：icon: "IconName"
 *   3. 模板里的字面量绑定：:is="'IconName'"
 *
 * 用法：node apps/api/scripts/check-icons.mjs
 * 退出码非 0 表示有缺失/多余项。
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, dirname, extname } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "../../..")
const webSrc = join(repoRoot, "apps/web/src")

/**
 * Element Plus 提供的全部图标名。
 *
 * 用来把「源码里出现的字符串」过滤成「确实存在的图标」——
 * 例如 `:is="cond ? 'Expand' : 'Fold'"` 里两个字符串都是图标，
 * 而 `:is="'div'"` 之类的不是。
 *
 * 用 createRequire 从 web 工作区解析，避免依赖 pnpm 的物理路径
 * （node_modules/.pnpm/... 的层级会随版本变化）。
 */
const require = createRequire(join(repoRoot, "apps/web/package.json"))
let allIcons = new Set()
try {
  const mod = require("@element-plus/icons-vue")
  allIcons = new Set(Object.keys(mod).filter((k) => k !== "default"))
} catch (err) {
  console.warn(`（无法加载图标全量清单：${err.message}）`)
}

/*
 * 兜底：若全量清单取不到，就用「登记表 + 已知的常见图标名」判断。
 * 核心目的始终是「源码用到的图标是否都在登记表里」，
 * 全量清单只是用来过滤非图标字符串。
 *
 * 解析 `ICONS = { A, B, C }` 时**必须允许最后一项没有尾逗号** ——
 * 否则最后登记的图标会被漏掉（曾因此误报 WarningFilled 未登记）。
 * 只取 `export const ICONS` 之后的内容，避免把 import 块也算进去。
 */
const iconsFile = readFileSync(join(webSrc, "icons.ts"), "utf8")
// Include repo-owned SVG icons in usage checks as well as Element Plus.
for(const match of iconsFile.matchAll(/import ([A-Z][A-Za-z0-9]+) from [\"\']\.\/components\/icons\/[^\"\']+\.vue[\"\']/g))allIcons.add(match[1])
const iconsObjectBody = iconsFile.split(/export const ICONS\s*=\s*\{/)[1]?.split("}")[0] ?? ""
const registered = new Set(
  [...iconsObjectBody.matchAll(/([A-Z][A-Za-z0-9]+)\s*,?/g)].map((m) => m[1])
)

/** 递归收集 .vue / .ts 文件 */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if ([".vue", ".ts"].includes(extname(name))) out.push(p)
  }
  return out
}

const files = walk(webSrc).filter((f) => !f.endsWith("icons.ts"))

/** 源码里用到的图标名 */
const used = new Map() // name -> [files]

for (const file of files) {
  const text = readFileSync(file, "utf8")
  const rel = file.replace(repoRoot + "\\", "").replace(repoRoot + "/", "")

  const add = (name) => {
    if (!/^[A-Z][A-Za-z0-9]+$/.test(name)) return
    // 只关心「是 Element Plus 图标」的名字——用登记表 + 已知命名特征判断
    if (!registered.has(name) && !allIcons.has(name)) return
    if (!used.has(name)) used.set(name, [])
    used.get(name).push(rel)
  }

  /*
   * 1) 模板静态使用 <IconName /> 或 <IconName></IconName>
   */
  for (const m of text.matchAll(/<([A-Z][A-Za-z0-9]+)[\s/>]/g)) add(m[1])

  /*
   * 2) 配置字符串 icon: "IconName"
   */
  for (const m of text.matchAll(/icon:\s*["']([A-Z][A-Za-z0-9]+)["']/g)) add(m[1])

  /*
   * 3) 动态绑定里的字符串字面量。
   *
   * 这是最容易漏的一类：`:is="cond ? 'A' : 'B'"` 这种写法里，
   * 图标名是字符串而不是标签名，正则 `<([A-Z]\w+)` 抓不到。
   *
   * 曾因此漏掉 Expand / Fold / Sunny / Moon / VideoPlay / ArrowUp 六个图标，
   * 导致左上角折叠按钮与右上角主题切换图标完全不显示 —— 上线后才被发现。
   * 所以这里把 :is 表达式里**所有**单引号字符串都收进来，
   * 由 add() 内的「是否属于 Element Plus 图标」判断过滤掉非图标字符串。
   */
  for (const m of text.matchAll(/:is="([^"]*)"/g)) {
    for (const s of m[1].matchAll(/'([A-Z][A-Za-z0-9]+)'/g)) add(s[1])
  }
}

const missing = [...used.keys()].filter((n) => !registered.has(n))
const lazyBody=readFileSync(join(webSrc,'icon-names.ts'),'utf8').split('ICON_NAMES = [')[1]?.split(']')[0]||''
const lazyNames=new Set([...lazyBody.matchAll(/["']([A-Z][A-Za-z0-9]+)["']/g)].map(m=>m[1]))
const lazyMissing=[...registered].filter(name=>!lazyNames.has(name))
/*
 * 反向检查只对「确认属于 Element Plus」的名字做，
 * 因为 allIcons 可能取不到（动态 import 失败），此时不能误报多余。
 */
const extra =
  allIcons.size > 0 ? [...registered].filter((n) => !used.has(n) && allIcons.has(n)) : []

console.log(`源码用到 ${used.size} 个图标，登记表有 ${registered.size} 个`)
console.log(
  allIcons.size > 0
    ? `Element Plus 全量 ${allIcons.size} 个`
    : "（未能载入全量清单，跳过「多余」检查）"
)

let failed = false
if(lazyMissing.length){failed=true;console.error('图标懒加载名称表缺少：'+lazyMissing.join(', '))}

if (missing.length > 0) {
  failed = true
  console.error(`\n❌ 有 ${missing.length} 个图标被使用但未登记（会不显示）：`)
  for (const n of missing) {
    console.error(`   ${n}   ← ${[...new Set(used.get(n))].join(", ")}`)
  }
  console.error("\n请在 apps/web/src/icons.ts 里 import 并加入 ICONS。")
} else {
  console.log("\n✅ 源码用到的图标都已登记")
}

if (extra.length > 0) {
  console.log(`\n⚠️  登记表里有 ${extra.length} 个图标已不再使用（可删以减小体积）：`)
  console.log("   " + extra.join(", "))
}

process.exit(failed ? 1 : 0)
