import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
const preview = (x, depth = 0) => typeof x === 'string' ? x.slice(0, 220) : Array.isArray(x) ? {count: x.length, sample: x.slice(0, 1).map(v => preview(v, depth + 1))} : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).filter(([k]) => !/full_text|fulltext|raw_text/i.test(k)).map(([k,v]) => [k, depth > 3 ? typeof v : preview(v, depth + 1)])) : x
for (const name of readdirSync('knowledge/src').sort()) {
  const path = join('knowledge/src', name)
  const raw = readFileSync(path)
  console.log(JSON.stringify({name, bytes: statSync(path).size, ...(name.endsWith('.json') ? {data: preview(JSON.parse(raw.toString('utf8')))} : name.endsWith('.md') ? {headings: raw.toString('utf8').split('\n').filter(s => /^#/.test(s))} : {})}))
}
