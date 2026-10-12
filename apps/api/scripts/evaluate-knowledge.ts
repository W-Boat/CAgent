import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { KnowledgeRetriever, type KnowledgeRow } from '../src/campus/knowledge-retriever'

export const asRow = (r: any): KnowledgeRow => ({ ...r, id:String(r.id), externalId:r.id,
  searchText:r.search_text, summaryShort:r.summary_short, detailStatus:r.detail_status,
  verifiedAt:r.verified_at, officeTime:r.office_time, keyFacts:r.key_facts })
async function main(){
const root = resolve(__dirname, '../../..')
const data = JSON.parse(readFileSync(resolve(root, 'knowledge/dist/campus-kb.json'), 'utf8'))
let rows = data.items.map(asRow)
const live = process.argv.includes('--database')
if(live){
  for(const line of readFileSync(resolve(root,'.env'),'utf8').split(/\r?\n/)) {
    const m=line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2]
  }
  const {PrismaClient}=await import('@prisma/client')
  const prisma=new PrismaClient()
  try {rows=await prisma.campusGuideItem.findMany()} finally {await prisma.$disconnect()}
}
const index = new KnowledgeRetriever(rows)
const cases = JSON.parse(readFileSync(resolve(root, 'knowledge/dist/retrieval-cases.json'), 'utf8'))
const validIds = new Set(index.rows.filter(r => r.type === '事项' && r.extra?.matter_id).map(r => r.extra.matter_id))
const results: any[] = []
let skipped = 0
let previousQuery = ''
const start = Date.now()
for (const c of cases) {
  if (!validIds.has(c['预期事项ID'])) { skipped++; continue }
  const query = c['用户问句'].replace(/^【多轮-第\d轮】/, '')
  if (/【多轮-第1轮】/.test(c['用户问句'])) previousQuery = query
  const result = index.search(query, {limit:5, previousQuery: /【多轮-/.test(c['用户问句']) ? previousQuery : undefined})
  const position = result.hits.findIndex(h => h.row.extra?.matter_id === c['预期事项ID']) + 1
  results.push({id:c['用例ID'], query:c['用户问句'], expected:c['预期事项ID'], split:c['数据集划分'], rank:position,
    actual:result.hits.slice(0,3).map(h => ({title:h.row.title, matter:h.row.extra?.matter_id,score:h.score}))})
}
const summary = {cases:results.length, skipped, top1:results.filter(r => r.rank===1).length / results.length,
  recall5:results.filter(r => r.rank>0).length / results.length,
  mrr:results.reduce((n,r) => n+(r.rank ? 1/r.rank : 0),0)/results.length,
  elapsedMs:Date.now()-start, corpus: index.rows.length,scope:live?'database':'rebuilt_sources'}
writeFileSync(resolve(root, live?'knowledge/dist/live-retrieval-evaluation.json':'knowledge/dist/retrieval-evaluation.json'), JSON.stringify({summary,failures:results.filter(r => r.rank!==1)}, null,2))
console.log(JSON.stringify(summary, null,2))
console.log(JSON.stringify(results.filter(r => r.rank!==1).slice(0,12),null,2))
for (const q of ['请假怎么弄','借书这个周末能办吗','学生证丢了怎么办','舞蹈实践与赏析工作量大吗','外卖红榜推荐','图书馆电子资源怎么访问','写一首诗','你好','可以线上办吗']) {
  console.log(JSON.stringify({query:q,hits:index.search(q,{limit:3}).hits.map(h => ({title:h.row.title,score:h.score,collection:h.row.extra?.kb?.collection || 'legacy'}))}))
}
if (summary.top1 < 0.85 || summary.recall5 < 0.95) process.exitCode = 1

}
main().catch(err=>{console.error(err);process.exitCode=1})
