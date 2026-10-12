// 统计 dist 各 chunk 的原始与 gzip 体积，判断首屏真实传输量
import { readdirSync, readFileSync, statSync } from "node:fs"
import { gzipSync, brotliCompressSync } from "node:zlib"
import { join } from "node:path"

const dir = "dist/assets"
const files = readdirSync(dir).filter((f) => f.endsWith(".js"))

const rows = files.map((f) => {
  const buf = readFileSync(join(dir, f))
  return {
    name: f,
    raw: buf.length,
    gzip: gzipSync(buf, { level: 9 }).length,
    br: brotliCompressSync(buf).length
  }
})

rows.sort((a, b) => b.raw - a.raw)

console.log("=== JS chunk 体积（前 10）===")
console.log("  原始      gzip     brotli   文件")
for (const r of rows.slice(0, 10)) {
  console.log(
    `  ${(r.raw / 1024).toFixed(0).padStart(6)} KB ${(r.gzip / 1024).toFixed(0).padStart(6)} KB ${(r.br / 1024).toFixed(0).padStart(6)} KB   ${r.name}`
  )
}

// 首屏：index.html 里 modulepreload + 入口
const html = readFileSync("dist/index.html", "utf8")
const preloaded = [...html.matchAll(/href="\/assets\/([^"]+\.js)"/g)].map((m) => m[1])
const entry = [...html.matchAll(/src="\/assets\/([^"]+\.js)"/g)].map((m) => m[1])
const critical = new Set([...preloaded, ...entry])

console.log("\n=== 首屏关键 JS（登录页要下载完才能渲染）===")
let sumGzip = 0
for (const name of critical) {
  const r = rows.find((x) => x.name === name)
  if (r) {
    sumGzip += r.gzip
    console.log(`  ${(r.gzip / 1024).toFixed(0).padStart(6)} KB gzip   ${r.name}`)
  }
}
console.log(`  ${"-".repeat(30)}`)
console.log(`  ${(sumGzip / 1024).toFixed(0).padStart(6)} KB gzip   合计`)

// CSS
const cssFiles = readdirSync(dir).filter((f) => f.endsWith(".css"))
let cssRaw = 0
let cssGzip = 0
for (const f of cssFiles) {
  const buf = readFileSync(join(dir, f))
  cssRaw += buf.length
  cssGzip += gzipSync(buf, { level: 9 }).length
}
console.log(`\n=== CSS 合计 ===`)
console.log(`  ${(cssRaw / 1024).toFixed(0)} KB 原始 / ${(cssGzip / 1024).toFixed(0)} KB gzip`)
