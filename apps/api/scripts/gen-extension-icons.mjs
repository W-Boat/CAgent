// 把 CAgent 图标渲染成扩展所需的 PNG（16/48/128）
import { chromium } from "playwright"
import { writeFileSync } from "node:fs"
import { join } from "node:path"

const OUT_DIR = process.env.OUT_DIR || "."
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="15" fill="#2563eb"/>
  <path d="M32 12c-11.6 0-21 8-21 17.9 0 5.8 3.2 10.9 8.1 14.1-.3 2.6-1.4 5-3.2 7a1 1 0 0 0 .9 1.7c3.9-.3 7.4-1.8 10.1-3.9 1.7.3 3.4.5 5.1.5 11.6 0 21-8 21-17.9S43.6 12 32 12Z" fill="#ffffff" fill-opacity="0.18"/>
  <circle cx="32" cy="30" r="7.2" fill="none" stroke="#ffffff" stroke-width="3.8"/>
  <circle cx="32" cy="30" r="2.6" fill="#ffffff"/>
  <circle cx="19.8" cy="30" r="2.2" fill="#ffffff" opacity="0.6"/>
  <circle cx="44.2" cy="30" r="2.2" fill="#ffffff" opacity="0.6"/>
</svg>`

const browser = await chromium.launch()
for (const size of [16, 48, 128]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  const scaled = svg.replace(
    'viewBox="0 0 64 64"',
    `viewBox="0 0 64 64" width="${size}" height="${size}"`
  )
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${scaled}</body></html>`
  )
  const buf = await page.screenshot({ omitBackground: true })
  writeFileSync(join(OUT_DIR, `icon${size}.png`), buf)
  await page.close()
  console.log(`icon${size}.png (${buf.length} bytes)`)
}
await browser.close()
