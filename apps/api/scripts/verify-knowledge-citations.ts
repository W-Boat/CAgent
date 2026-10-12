import assert from 'node:assert/strict'
import {stripKnowledgeCitations,KnowledgeCitationStream} from '../src/chat/knowledge-citations'
import {markCitedSources} from '../src/campus/knowledge-evidence'
const known=new Set(['518305341','4682'])
const raw='校园社团见资料[518305341]，档案咨询[4682]。另有[S1]。列表 [0, 1]，普通 [链接](https://example.invalid)，年份链接 [2026](https://example.invalid)。'
assert.equal(stripKnowledgeCitations(raw,known),'校园社团见资料，档案咨询。另有。列表 [0, 1]，普通 [链接](https://example.invalid)，年份链接 [2026](https://example.invalid)。')
for(const split of Array.from({length:raw.length-1},(_,i)=>i+1)){
 const stream=new KnowledgeCitationStream(()=>known)
 const result=stream.push(raw.slice(0,split))+stream.push(raw.slice(split))+stream.finish()
 assert.equal(result,stripKnowledgeCitations(raw,known),'split '+split)
}
const stream=new KnowledgeCitationStream(()=>known)
assert.equal(stream.push('信息[5183'),'信息')
assert.equal(stream.push('05341]'),'')
assert.equal(stream.push('正文。'),'正文。')
const linked='资料[518305341](https://example.invalid/source)结束。'
for(let i=1;i<linked.length;i++){
 const s=new KnowledgeCitationStream(()=>known)
 assert.equal(s.push(linked.slice(0,i))+s.push(linked.slice(i))+s.finish(),'资料结束。')
}
assert.equal(markCitedSources([{id:'test',citationId:'518305341',title:'社团',summary:'',source:'手册',collection:'handbook',used:false}],raw)[0].used,true)
const negative='外挂资料[-139647176]、联合引用[-139647176,518305341]。数值 [-1, -2]。',negativeKnown=new Set([...known,'-139647176'])
assert.equal(stripKnowledgeCitations(negative,negativeKnown),'外挂资料、联合引用。数值 [-1, -2]。')
for(let split=1;split<negative.length;split++){const stream=new KnowledgeCitationStream(()=>negativeKnown);assert.equal(stream.push(negative.slice(0,split))+stream.push(negative.slice(split))+stream.finish(),stripKnowledgeCitations(negative,negativeKnown))}
console.log('PASS 正文移除引用 ID、全部分块边界与链接引用一致，保留普通链接/列表，来源追踪继续生效')
