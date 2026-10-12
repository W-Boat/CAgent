#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import './build-campus-maps.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const arg = (name, fallback) => process.argv.includes(name) ? resolve(process.argv[process.argv.indexOf(name) + 1]) : fallback
const src = arg('--src', join(here, 'src'))
const out = arg('--out', join(here, 'dist'))
mkdirSync(out, { recursive: true })
const load = name => JSON.parse(readFileSync(join(src, name), 'utf8'))
const hash = text => createHash('sha256').update(text).digest('hex')
const clean = text => String(text ?? '').replace(/portal\.ucass\.edu\.cn/g, 'info.ucass.edu.cn').replace(/\r/g, '').trim()
const url = text => { try { const u = new URL(clean(text)); return ['http:', 'https:'].includes(u.protocol) ? u.href : '' } catch { return '' } }
const splitIds = text => clean(text).split(/[；;,，、\s]+/).filter(Boolean)
const items = [], ids = new Set(), keys = new Set(), documents = new Set(), excluded = []
const sources = readdirSync(src,{withFileTypes:true}).filter(entry=>entry.isFile()).map(entry=>entry.name).sort().map(name => {
  const bytes = readFileSync(join(src, name))
  return { file: name, bytes: bytes.length, sha256: hash(bytes), records: 0 }
})
const add = (file, key, title, body, props = {}) => {
  if (!clean(title)) return
  if (keys.has(file + ':' + key)) { excluded.push({file, reason:'重复源记录', locator:key}); return }
  keys.add(file + ':' + key)
  const id = 500_000_000 + parseInt(hash(file + ':' + key).slice(0, 12), 16) % 400_000_000
  if (ids.has(id)) throw new Error(`稳定 ID 冲突：${file}:${key}，请调整命名空间`)
  ids.add(id)
  const extra = props.extra || {}
  const { parent, locator, trust, aliases, relations, audience, kb, ...legacyExtra } = extra
  const text = clean(body)
  const item = {
    id, title: clean(title), url: url(props.url), cat: props.cat || '知识库', type: props.type || '知识',
    source: file, detail_status: text ? 'basic' : 'link_only', summary_short: text.slice(0, 220), detail: text,
    steps: [], key_facts: [], views: 0, ...props,
    extra: { ...legacyExtra, kb: { schema: 'kb/v2', key: file + ':' + key, parent: extra.parent || file + ':' + key,
      file, locator: extra.locator || key, trust: extra.trust || 'community', aliases: extra.aliases || [],
      relations: extra.relations || [], audience: extra.audience || '', ...extra.kb } }
  }
  item.url = url(item.url)
  item.search_text = clean([item.title, item.name, item.dept, item.cat, item.detail, ...item.steps,
    ...item.key_facts.map(f => f.value), ...item.extra.kb.aliases].filter(Boolean).join(' ')).toLowerCase()
  items.push(item)
  documents.add(item.extra.kb.parent)
  sources.find(s => s.file === file).records++
}
// Sentence/paragraph boundaries, no destructive truncation or duplicated overlap.
const pieces = text => {
  const result = []; let part = ''
  for (const line of clean(text).split(/(?<=[。！？；\n])/u)) {
    for (let i = 0; i < line.length; i += 900) {
      const segment = line.slice(i, i + 900)
      if (part.length + segment.length > 900 && part) { result.push(part.trim()); part = '' }
      part += segment
    }
  }
  if (part.trim()) result.push(part.trim())
  return result
}
const chunk = (file, key, title, text, props = {}) => pieces(text).forEach((part, i) => add(file, `${key}/part-${i}`, title, part,
  { ...props, extra: { ...props.extra, parent: file + ':' + key, kb: { ...props.extra?.kb, part: i } } }))

// Portal full/slim are two projections of the same collection, never two corpora.
const portal = load('ucass_guide.json'), slim = load('ucass_guide_slim.json')
if (portal.items.length !== slim.items.length || portal.items.some((r, i) => r.title !== slim.items[i].title || r.url !== slim.items[i].url)) {
  throw new Error('门户 full/slim 内容不一致，需要人工确认来源')
}
excluded.push({ file: 'ucass_guide_slim.json', reason: '与 full 逐条校验一致，作为投影视图，不重复索引', count: slim.items.length })
for (const [i, row] of portal.items.entries()) add('ucass_guide.json', `${row.category}/${row.item_id || ''}/${hash(row.title + row.url).slice(0,16)}`, row.title, row.desc || '', {
  url: row.url, cat: row.category, type: row.content_type, extra: { trust: 'official_index', locator: `items[${i}]`,
    kb: { collection: 'portal', entryKind: 'direct' } }
})
for (const [i, row] of load('easy_platform.json').items.entries()) add('easy_platform.json', row.app_id || i, row.title, row.title, {
  url: row.url, cat: row.category, type: row.content_type, extra: { trust: 'official_index', locator: `items[${i}]`,
    kb: { collection: 'services', entryKind: 'direct' } }
})

const workbookFile = sources.find(s => s.file.endsWith('.xlsx'))?.file
if (!workbookFile) throw new Error('缺少赛题工作簿')
const extraction = spawnSync(process.env.PYTHON || 'python', [join(here, 'extract-workbook.py'), join(src, workbookFile), join(out, 'workbook-source.json')], { encoding: 'utf8' })
if (extraction.status !== 0) throw new Error(extraction.stderr || 'Excel 提取失败')
const workbook = JSON.parse(readFileSync(join(out, 'workbook-source.json'), 'utf8'))
const sheet = prefix => {
  const s = workbook.sheets.find(s => s.name.startsWith(prefix))
  if (!s) throw new Error(`缺少工作表 ${prefix}`)
  const headings = s.rows[0].cells
  return s.rows.slice(1).map(r => ({ ...Object.fromEntries(Object.entries(r.cells).map(([c, v]) => [headings[c] || c, clean(v)])), _locator: `${s.name}!${r.row}` }))
}
const matters = sheet('01_'), steps = sheet('02_'), alias = sheet('06_')
const demo = row => /示例|半真实|可扩展|模拟/.test([row['数据状态'], row['数据来源等级']].join(' '))
const validMatters = new Set(matters.filter(r => !demo(r)).map(r => r['事项ID']))
const relation = row => splitIds(row['关联事项ID'] || row['事项ID']).filter(id => validMatters.has(id)).map(id => `matter:${id}`)
const quarantined = []
for (const m of matters) {
  if (demo(m)) { quarantined.push(m); continue }
  const mid = m['事项ID']
  add(workbookFile, mid, m['正式名称'], [m['办理入口(PC端)'], m['办理入口(移动端)'], m['常见问题提示']].filter(Boolean).join('\n'), {
    url: url(m['办理入口(PC端)']) || url(m['来源链接']), cat: m['一级分类'], type: '事项', dept: m['主管部门'],
    place: m['办公地点'], tel: m['咨询电话'], campus: m['校区'], form: m['办理模式'], office_time: m['办理时限/时间窗口'],
    verified_at: m['更新时间'], steps: steps.filter(s => s['事项ID'] === mid).sort((a,b) => Number(a['步骤序号']) - Number(b['步骤序号'])).map(s => `${s['步骤标题']}：${s['步骤说明']}${s['注意事项'] ? '；' + s['注意事项'] : ''}`),
    key_facts: ['所需材料', '审批链路', '是否收费', '适用对象'].filter(k => m[k]).map(k => ({ kind: k, value: m[k] })),
    extra: { matter_id: mid, trust: 'curated', locator: m._locator, relations: [`matter:${mid}`], audience: m['适用对象'],
      aliases: [...new Set(alias.filter(a => a['事项ID'] === mid).map(a => a['口语表达/别名']).filter(Boolean))],
      kb: { collection: 'matters', entryKind: 'source_home', sourceClaim: m['数据来源等级'] } }
  })
}
const configurations = [
  ['03_', '文档ID', '文档名称', '获取入口', '来源链接', '表单'],
  ['04_', '来源编号', '来源名称', '来源类型', '公开链接', '信息源'],
  ['05_', '通知ID', '标题', '内容摘要', '原文链接', '通知公告'],
  ['07_', '问答ID', '问题', '标准答案', '', '问答'],
  ['09_', '实体ID', '实体名称', '职能说明', '地点/网址', '机构']
]
for (const [prefix, idField, titleField, bodyField, urlField, type] of configurations) for (const r of sheet(prefix)) {
  if (demo(r) || (r['事项ID'] && !validMatters.has(r['事项ID']))) { quarantined.push(r); continue }
  const rels = relation(r)
  if (r['关联事项ID'] && !rels.length) { quarantined.push(r); continue }
  chunk(workbookFile, r[idField], r[titleField], r[bodyField] || r[titleField], {
    type, url: r[urlField], dept: r['主管部门'] || r['发布部门'] || r['发布单位'], tel: r['联系电话'],
    place: url(r['地点/网址']) ? '' : r['地点/网址'], verified_at: r['更新时间'] || r['发布时间'],
    extra: { locator: r._locator, trust: type === '机构' ? 'unverified' : 'curated', relations: rels,
      matter_id: r['事项ID'], audience: r['适用对象'], aliases: type === '机构' ? splitIds(r['别名']) : [],
      kb: { collection: type, sourceClaim: r['数据来源等级'], validity: r['有效期状态'] || r['有效期'],
        entryKind: type === '问答' ? 'none' : 'source_home' } }
  })
}
// Gold answers and instructional sheets are stored separately and NEVER enter retrieval.
writeFileSync(join(out, 'retrieval-cases.json'), JSON.stringify(sheet('08_'), null, 2))
writeFileSync(join(out, 'quarantine.json'), JSON.stringify(quarantined, null, 2))
excluded.push({ file: workbookFile, reason: '示例/模拟记录隔离；测试答案、使用说明、意图标签与数据字典仅供治理和评测', count: quarantined.length })

for (const file of ['社科院课程测评_RAG.json', '社科大外卖红黑榜_RAG.json']) {
  const data = load(file)
  if (file.includes('外卖')) for (const s of data.sheets.filter(s => /红榜|黑榜/.test(s.sheet_name))) {
    const red = s.sheet_name === '红榜'
    add(file,`overview/${s.sheet_name}`,red ? '外卖推荐 · 同学红榜' : '外卖避雷 · 同学黑榜',
      ['以下为同学主观评价，收录时间未标注，不能代表商家当前情况。',...s.rows.slice(0,8).map(r => Object.entries(r.data || {}).map(([k,v]) => `${k}：${clean(v)}`).join('；'))].join('\n'),
      {type:'餐饮经验',cat:s.sheet_name,extra:{trust:'community',locator:`${s.sheet_name}!1-8`,aliases:red?['外卖推荐','吃什么','外卖红榜']:['外卖避雷','外卖黑榜'],kb:{collection:'takeout',entryKind:'none'}}})
  }
  for (const s of data.sheets) for (const r of s.rows) {
    const d = r.data || {}, values = Object.values(d).map(clean).filter(Boolean)
    const isCourse = /课程/.test(s.sheet_name)
    if (file.includes('外卖') && s.sheet_name === '首页') {excluded.push({file,reason:'表格使用说明',locator:`${s.sheet_name}!${r.row_id}`});continue}
    const teacher = s.sheet_name === '白名单' ? values[1] : ''
    const title = isCourse ? [d['列2'], d['列3']].filter(Boolean).join(' · ') : teacher || d['店家名称'] || d['列1'] || (values[0]?.length<=40 ? values[0] : `${s.sheet_name} 第${r.row_id}条`)
    if (!title || title === '课程名 · 授课教师' || (isCourse && !d['列2'])) { excluded.push({file, reason:'说明/空标题行', locator:`${s.sheet_name}!${r.row_id}`}); continue }
    chunk(file, `${s.sheet_name}/${r.row_id}`, title, Object.entries(d).map(([k,v])=>`${k}：${clean(v)}`).join('\n'), {
      type: isCourse ? '课程' : file.includes('外卖') ? '餐饮经验' : '同学经验', cat: s.sheet_name,
      extra: { locator: `${s.sheet_name}!${r.row_id}`, trust: 'community', aliases: isCourse ? [d['列2'], d['列3']].filter(Boolean) : [],
        ...(r.food?{food:r.food}:{}), kb: { collection: file.includes('外卖') ? 'takeout' : 'courses', audience: s.sheet_name, review: true } }
    })
  }
}
for (const file of ['UCASSbook_RAG.json', '烧烤店辛瓜生存指北_RAG.json']) {
  const data = load(file)
  const sections = file.startsWith('UCASSbook') ? data.sections.map(s => {
    const number=s.heading.match(/^(\d+(?:\.\d+)*)\./)?.[1]
    const lines=clean(s.text).split('\n').map(clean).filter(Boolean)
    const name=clean(s.heading.replace(/^\d+(?:\.\d+)*\.?\s*/,'')) || lines[1] || s.heading
    return {id:s.section_id,number,name,title:name,text:s.text,locator:`section:${s.section_id};pages:${s.start_page}-${s.end_page}`}
  })
    : data.rag.chunks.map(c => ({ id: c.chunk_id, title: clean(c.text).split('\n').filter(Boolean).slice(0, 3).join(' / '), text: c.text, locator: `paragraphs:${c.source_paragraphs?.join('-')}` }))
  const numbered=new Map()
  // The extracted PDF also calls numbered policy bullets "headings"; they must not overwrite chapters.
  for(const s of sections) if(s.number) {
    if(numbered.has(s.number))s.number=undefined
    else numbered.set(s.number,s)
  }
  for(const s of sections) if(s.number) {
    const ancestors=s.number.split('.').slice(0,-1).map((_,i)=>numbered.get(s.number.split('.').slice(0,i+1).join('.'))).filter(Boolean)
    s.path=[...ancestors.map(a=>a.name),s.name].filter(n=>!/^\d/.test(n))
    s.title=s.path.slice(-3).join(' / ')
    s.children=sections.filter(c=>c.number && c.number.startsWith(s.number+'.') && c.number.split('.').length===s.number.split('.').length+1)
    // Keep empty chapter headings useful: derive an inventory from actual child sections, never model guesses.
    if(s.children.length && clean(s.text).replace(/^\d+(?:\.\d+)*\.?\s*/, '')===s.name) {
      s.overview=true
      s.text=[s.text,`以下是本手册本节收录的 ${s.children.length} 个子条目，不代表学校当前完整名单或现行数量。`,
        ...s.children.map(c=>s.children.length>12 ? `- ${c.name}` : `- ${c.name}：${clean(c.text).split('\n').slice(c.text.split('\n')[0].replace(/^\d+(?:\.\d+)*\.?\s*/,'').trim()?1:2).join(' ').slice(0,180)}`)].join('\n')
    }
  }
  for (const s of sections) chunk(file, s.id, s.title || data.document.title, s.text, {
    type: '生活指南', cat:s.path?.slice(0,2).join(' / ') || '生活指南', extra: { locator: s.locator, trust: 'community', aliases:s.name?[...new Set([s.name,s.name.replace(/^(学生|校园|学校)/,'')])].filter(n=>n.length>=2):[],
      kb: {collection: file.startsWith('UCASSbook') ? 'handbook' : 'survival',sectionPath:s.path || [],sectionKey:s.number?`${file}:${s.number}`:undefined,
        children:s.children?.map(c=>`${file}:${c.number}`),overview:!!s.overview} }
  })
}
// New-student handbook: carry heading context across page boundaries; retain original page locators.
for(const campus of load('campus-maps.json').campuses)for(const p of campus.places)add('campus-maps.json',`${campus.id}/${p.id}`,`${campus.name} · ${p.name}`,
  `${campus.name}，${p.name}。${p.description}\n地图采用手绘原图及建筑标记，原图日期 ${campus.edition}，不表示精确经纬度或现行设施变化。`,{
    url:`https://campus.example.org/map?campus=${campus.id}&place=${p.id}`,cat:`校园地图 / ${campus.name}`,type:'校园位置',campus:campus.name,place:p.name,
    extra:{trust:'community',locator:`${campus.sourceFile};place:${p.id}`,aliases:[...p.aliases,`${p.name}在哪`,`${campus.name}${p.name}位置`],
      kb:{collection:'maps',entryKind:'campus_map',sectionPath:['校园地图',campus.name],map:{campus:campus.id,placeId:p.id},edition:campus.edition}}})
let chapter = '', heading = ''
for (const file of sources.filter(s => /^pages_.*\.md$/.test(s.file)).map(s => s.file)) {
  let page = '', text = '', count = 0
  const flush = () => {
    if (clean(text)) chunk(file, `page-${page}/section-${count++}`, [chapter, heading].filter(Boolean).join(' / ') || `新生入学指南 第${page}页`, text, {
      type: '新生指南', extra: { locator: `page:${page}`, trust: 'handbook', kb: {collection: 'freshman', edition:'2026', transcription: true} }
    })
    text = ''
  }
  for (const line of readFileSync(join(src, file), 'utf8').split('\n')) {
    const p = line.match(/^## 第(\d+)页/)
    if (p) { flush(); page = p[1]; continue }
    if (/^#{3,}\s/.test(line)) { flush(); heading = line.replace(/^#+\s*/, ''); if (/第.+章/.test(heading)) chapter = heading }
    text += line + '\n'
  }
  flush()
}
items.sort((a,b) => a.id - b.id)
const meta = { schema:'kb/v2', built_at: new Date().toISOString(), total: items.length, documents: documents.size,
  sources, excluded, quarantine: quarantined.length, workbookSheets: workbook.sheets.map(s => ({name:s.name, rows:s.rows.length - 1})),
  policy: '只读导览；社区经验与整理资料保留来源；测试答案和示例不参与检索' }
// One object per line keeps generated-data diffs reviewable without changing the JSON schema.
writeFileSync(join(out, 'campus-kb.json'), `{"meta":${JSON.stringify(meta)},"items":[\n${items.map(item=>JSON.stringify(item)).join(',\n')}\n]}\n`)
writeFileSync(join(out, 'manifest.json'), JSON.stringify(meta, null, 2))
console.log(JSON.stringify({ total:items.length, documents:documents.size, quarantine:quarantined.length, sources:sources.map(s => ({file:s.file, records:s.records})) }, null, 2))
