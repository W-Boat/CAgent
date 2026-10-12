import assert from 'node:assert/strict'
import {sourcesFromEvidence,markCitedSources} from '../src/campus/knowledge-evidence'
const hits=Array.from({length:9},(_,i)=>({id:'row-'+i,externalId:100+i,title:'资料'+i,summaryShort:'相关摘录',url:i===8?'javascript:alert(1)':'https://example.invalid/'+i,cat:'资料',provenance:{collection:'handbook',file:'UCASSbook_RAG.json',locator:'章节'+i,trust:'handbook'},related:[]})) as any
const text=hits.slice(0,8).map((h:any)=>`[${h.externalId}] ${h.title}\n说明：真实证据`).join('\n')
const sources=sourcesFromEvidence([...hits,hits[0]],text)
assert.equal(sources.length,8)
assert(!sources.some(s=>s.citationId==='108'))
const final=markCitedSources(sources,'依据 [102]、[100, 106] 与 [99999] 作答')
assert.deepEqual(final.filter(s=>s.used).map(s=>s.citationId),['100','102','106'])
assert(!final.some(s=>s.citationId==='99999'))
assert.equal(markCitedSources(sources,'没有引用编号').filter(s=>s.used).length,0)
const tiny=sourcesFromEvidence(hits,'未在本地索引中检索到')
assert.equal(tiny.length,0)
assert.equal(sourcesFromEvidence(hits.slice(8),'[108] 测试')[0].url,undefined)
const managed={...hits[0],id:'managed:entry:0',externalId:-139647176}
assert.equal(sourcesFromEvidence([managed],'[-139647176] 外挂资料')[0].citationId,'-139647176')
assert.equal(sourcesFromEvidence([managed],'[-999999] 未检索到的资料').length,0)
assert.equal(markCitedSources(sourcesFromEvidence([managed],'[-139647176] 外挂资料'),'正文[-139647176]')[0].used,true)
console.log('PASS 来源不限三条，仅收录实际证据块，去重、引用标记、未知引用与不安全链接处理')
