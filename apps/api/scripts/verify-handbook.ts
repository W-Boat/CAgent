import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {KnowledgeRetriever,excerptForQuery} from '../src/campus/knowledge-retriever'
const asRow=(r:any)=>({...r,id:String(r.id),externalId:r.id,searchText:r.search_text,summaryShort:r.summary_short,detailStatus:r.detail_status})
import {CampusGuideService} from '../src/campus/campus-guide.service'

async function main(){
  const data=JSON.parse(readFileSync(resolve(__dirname,'../../../knowledge/dist/campus-kb.json'),'utf8'))
  const index=new KnowledgeRetriever(data.items.map(asRow))
  const markets=index.search('学校里面有几个超市',{limit:3}).hits
  assert(markets[0].row.extra.kb.overview)
  assert(markets[0].row.title.endsWith('超市'))
  const marketText=markets[0].row.detail!
  for(const name of ['美联福','安信捷','校外研缘超市'])assert(marketText.includes(name))
  assert(markets[0].related.some(r=>r.title.includes('美联福')))
  assert(markets[0].related.some(r=>r.title.includes('安信捷')))
  const clubs=index.search('学校里面社团的具体概况',{limit:3}).hits
  assert(clubs[0].row.extra.kb.overview)
  assert(clubs[0].row.title.endsWith('学生社团'))
  const clubText=excerptForQuery(clubs[0].row.detail!,'学校里面社团的具体概况',900)
  for(const name of ['国防协会','滑板社','足球协会','光幕音乐剧社'])assert(clubText.includes(name),name)
  const specific=index.search('国防协会主要做什么',{limit:3}).hits
  assert(specific[0].row.title.endsWith('国防协会'))
  assert(specific[0].row.detail!.includes('国防科普'))
  assert(index.search('美联福在哪里',{collection:'handbook',topic:'超市'}).hits[0].row.title.includes('美联福'))
  assert.equal(index.search('国防协会',{collection:'handbook',topic:'超市'}).hits.length,0)
  const service=new CampusGuideService({} as any,{} as any)
  ;(service as any).index=async()=>index
  const catalog=await service.catalogBlock()
  assert(catalog.includes('学生社团'))
  assert(catalog.includes('handbook'))
  console.log('PASS 手册章节概况、完整社团目录、校内校外商店、实体名称和分类隔离')
  console.log(JSON.stringify({markets:markets.map(h=>h.row.title),clubs:clubs.map(h=>h.row.title),marketText,clubText,catalog},null,2))
}
main().catch(e=>{console.error(e);process.exitCode=1})
