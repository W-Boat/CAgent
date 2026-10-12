/**
 * 把 `import { ElMessage, ElMessageBox, type X } from "element-plus"` 里的
 * 「值导入」去掉，只保留类型导入。
 *
 * 原因：从 "element-plus" 包根导入任何一个值，都会把整个组件库拉进包里
 * （实测 element chunk 964KB），按需引入形同虚设。
 * ElMessage / ElMessageBox 改由 unplugin-auto-import 从
 * "element-plus/es" 的具体路径自动引入，只带上弹窗所需代码。
 *
 * 类型（FormInstance / FormRules）是编译期擦除的，留在包根导入不影响体积。
 */
import { readFileSync, writeFileSync } from "node:fs"
import { globSync } from "node:fs"

const files = [
  "src/api/client.ts",
  "src/App.vue",
  ...globSync("src/**/*.vue"),
  ...globSync("src/**/*.ts")
]

const VALUE_NAMES = ["ElMessage", "ElMessageBox", "ElNotification", "ElLoading"]

let changed = 0
for (const file of new Set(files)) {
  let code
  try {
    code = readFileSync(file, "utf8")
  } catch {
    continue
  }

  const before = code

  // 匹配 from "element-plus" 的 import 语句（可能是多行）
  code = code.replace(
    /import\s*\{([^}]*)\}\s*from\s*"element-plus"/g,
    (whole, names) => {
      const parts = names
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)

      const kept = parts.filter(
        (p) => !VALUE_NAMES.some((v) => p === v || p.startsWith(`${v} `))
      )

      // 一个都不剩就整条删掉
      if (kept.length === 0) return "/* element-plus 值导入已改为按需自动引入 */"

      // 只剩类型就不用 import type，普通 import 也会被编译期擦除
      return `import { ${kept.join(", ")} } from "element-plus"`
    }
  )

  // 清理留下的空注释行
  code = code.replace(/\/\* element-plus 值导入已改为按需自动引入 \*\/\n?/g, "")

  if (code !== before) {
    writeFileSync(file, code, "utf8")
    console.log("updated:", file)
    changed++
  }
}

console.log(`\n共修改 ${changed} 个文件`)
