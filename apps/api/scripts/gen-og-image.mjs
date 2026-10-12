/**
 * 生成微信分享封面图（478×478 PNG）。
 *
 * 为什么是 478×478：微信分享卡片的缩略图按正方形裁切，
 * 478 是官方建议尺寸；小于 300 会被拉糊，大于 1000 部分机型会压缩变形。
 * 文件必须 < 2MB（微信限制 2MB，超过则完全不出图）。
 *
 * 用 Playwright 渲染 SVG 再截图，而不是引入 sharp/canvas：
 * 项目已依赖 Playwright（apps/api 用于端到端测试），
 * 少一个原生模块就少一份跨平台安装负担。
 *
 * 用法：node apps/api/scripts/gen-og-image.mjs
 * 输出：apps/web/public/og-cover.png
 */
import { chromium } from "playwright"
import { mkdirSync, statSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "../../..")
const outDir = join(repoRoot, "apps/web/public")
const outFile = join(outDir, "og-cover.png")

/** 微信建议尺寸 */
const SIZE = 478
/** 微信上限 2MB，这里留足余量 */
const MAX_BYTES = 2 * 1024 * 1024

/*
 * 封面设计：品牌蓝底 + 白色对话气泡 icon + 平台名 + 一句定位。
 * 用系统字体栈，不引外部字体（避免渲染时字体未就绪导致截图空白）。
 */
const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${SIZE}px;
    height: ${SIZE}px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 22px;
    font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
    /* 品牌蓝渐变，右下稍深，让整块不至于太平 */
    background: linear-gradient(145deg, #2563eb 0%, #1d4ed8 55%, #1e40af 100%);
    color: #fff;
    overflow: hidden;
    position: relative;
  }
  /* 右上角装饰光晕，增加层次 */
  body::after {
    content: "";
    position: absolute;
    top: -120px;
    right: -120px;
    width: 340px;
    height: 340px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.10);
  }
  .mark { width: 128px; height: 128px; position: relative; z-index: 1; }
  .title {
    font-size: 44px;
    font-weight: 700;
    letter-spacing: 2px;
    position: relative;
    z-index: 1;
  }
  .sub {
    font-size: 20px;
    letter-spacing: 1px;
    color: rgba(255, 255, 255, 0.86);
    position: relative;
    z-index: 1;
  }
  .tags {
    display: flex;
    gap: 10px;
    margin-top: 4px;
    position: relative;
    z-index: 1;
  }
  .tag {
    padding: 6px 14px;
    font-size: 15px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.16);
    border: 1px solid rgba(255, 255, 255, 0.28);
  }
</style>
</head>
<body>
  <svg class="mark" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
    <path d="M32 8c-13.8 0-25 9.6-25 21.4 0 6.9 3.8 13 9.7 16.9-.4 3.1-1.7 6-3.9 8.4a1.2 1.2 0 0 0 1 2c4.7-.4 8.9-2.2 12.1-4.7 2 .4 4 .6 6.1.6 13.8 0 25-9.6 25-21.4S45.8 8 32 8Z" fill="#ffffff"/>
    <circle cx="32" cy="29.4" r="8.6" fill="none" stroke="#2563eb" stroke-width="4.2"/>
    <circle cx="32" cy="29.4" r="3" fill="#2563eb"/>
    <circle cx="17.5" cy="29.4" r="2.6" fill="#2563eb" opacity="0.55"/>
    <circle cx="46.5" cy="29.4" r="2.6" fill="#2563eb" opacity="0.55"/>
  </svg>
  <div class="title">CAgent</div>
  <div class="sub">校园智能体平台</div>
  <div class="tags">
    <span class="tag">多模型对话</span>
    <span class="tag">技能编排</span>
    <span class="tag">校园导览</span>
  </div>
</body>
</html>`

mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: SIZE, height: SIZE },
  deviceScaleFactor: 1
})
await page.setContent(html, { waitUntil: "load" })
// 等一帧，确保渐变与 SVG 都绘制完成
await page.waitForTimeout(120)
await page.screenshot({ path: outFile, type: "png" })
await browser.close()

const bytes = statSync(outFile).size
const kb = (bytes / 1024).toFixed(1)
console.log(`已生成 ${outFile}`)
console.log(`  尺寸: ${SIZE}×${SIZE}`)
console.log(`  体积: ${kb} KB${bytes > MAX_BYTES ? "  ← 超过微信 2MB 上限！" : ""}`)

if (bytes > MAX_BYTES) {
  console.error("封面图超过 2MB，微信不会显示图片，请简化设计或降低分辨率。")
  process.exit(1)
}
