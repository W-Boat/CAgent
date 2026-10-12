// Avoid importing all ~190 languages; this entire module is lazy loaded.
// 实测让 markdown 分包膨胀到 1.08 MB（gzip 361 kB）。
// 按需注册后同样的功能只剩几十 KB。
import hljs from "highlight.js/lib/core"
import bash from "highlight.js/lib/languages/bash"
import css from "highlight.js/lib/languages/css"
import diff from "highlight.js/lib/languages/diff"
import go from "highlight.js/lib/languages/go"
import http from "highlight.js/lib/languages/http"
import ini from "highlight.js/lib/languages/ini"
import java from "highlight.js/lib/languages/java"
import javascript from "highlight.js/lib/languages/javascript"
import json from "highlight.js/lib/languages/json"
import markdown from "highlight.js/lib/languages/markdown"
import php from "highlight.js/lib/languages/php"
import plaintext from "highlight.js/lib/languages/plaintext"
import python from "highlight.js/lib/languages/python"
import rust from "highlight.js/lib/languages/rust"
import shell from "highlight.js/lib/languages/shell"
import sql from "highlight.js/lib/languages/sql"
import typescript from "highlight.js/lib/languages/typescript"
import xml from "highlight.js/lib/languages/xml"
import yaml from "highlight.js/lib/languages/yaml"

const LANGUAGES: Record<string, Parameters<typeof hljs.registerLanguage>[1]> = {
  bash,
  css,
  diff,
  go,
  http,
  ini,
  java,
  javascript,
  json,
  markdown,
  php,
  plaintext,
  python,
  rust,
  shell,
  sql,
  typescript,
  xml,
  yaml
}

for (const [name, def] of Object.entries(LANGUAGES)) {
  hljs.registerLanguage(name, def)
}

// 常见别名，避免 fence 标了 js/ts/html 就退回纯文本
const ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  html: "xml",
  vue: "xml",
  svg: "xml",
  sh: "bash",
  zsh: "bash",
  console: "bash",
  yml: "yaml",
  py: "python",
  rs: "rust",
  md: "markdown",
  text: "plaintext",
  txt: "plaintext",
  toml: "ini",
  conf: "ini"
}

function resolveLang(raw?: string): string | undefined {
  if (!raw) return undefined
  const key = raw.toLowerCase()
  if (hljs.getLanguage(key)) return key
  const alias = ALIASES[key]
  return alias && hljs.getLanguage(alias) ? alias : undefined
}


export function highlightCode(content:string,declared:string):string|undefined {
  const lang=resolveLang(declared);if(!lang)return undefined
  try{return hljs.highlight(content,{language:lang,ignoreIllegals:true}).value}catch{return undefined}
}
