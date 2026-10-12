import 'reflect-metadata'
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {resolve} from 'node:path'
import {formatAnswerPresentation,AnswerPresentationStream} from '../src/presentation/answer-presentation'
import {inspectPresentation} from '../src/presentation/presentation-engine'
const root=resolve(__dirname,'../../..'),recent=JSON.parse(readFileSync(resolve(root,'.tmp/output-audit/recent-latest.json'),'utf8')).items
const messages=recent.slice(0,8).filter((m:any)=>m.role==='assistant'),rows:any[]=[],corpus:any[]=[]
assert.equal(messages.length,4)
for(const m of messages){
 const sources=[...m.attachments.knowledgeSources],ids=new Set<string>(sources.flatMap((s:any)=>[s.id,s.citationId].filter(Boolean)))
 // Replay the retained, trusted server tool results, not arbitrary citations from the model answer.
 const retained=new Map<string,string>()
 for(const tool of m.attachments.modelMessages.filter((mm:any)=>mm.role==='tool'))for(const hit of tool.content.matchAll(/(?:^|\n)\[(-?\d+)\] ([^\n]+)/g))retained.set(hit[1],hit[2])
 const missing=[...retained.keys()].filter(id=>!ids.has(id))
 for(const id of missing){ids.add(id);sources.push({id:'retained:'+id,citationId:id,title:retained.get(id),summary:'',source:'已保存的本轮导览工具结果',collection:'regression',used:true})}
 const raw=[...m.attachments.modelMessages].reverse().find((mm:any)=>mm.role==='assistant'&&mm.content)?.content;assert(raw)
 const content=formatAnswerPresentation(raw,'adaptive',ids),check=inspectPresentation(content,ids,"准备材料")
 assert.equal(check.rendered,'page',m.id+JSON.stringify(check));assert(check.valid);assert(check.documents.length>=1)
 for(const width of [1,7,43]){const stream=new AnswerPresentationStream('adaptive',()=>ids);let actual='';for(let i=0;i<raw.length;i+=width)actual+=stream.push(raw.slice(i,i+width));actual+=stream.finish();assert.equal(actual,content)}
 rows.push({id:m.id,previous:m.attachments.presentation.rendered,previousErrors:m.attachments.presentation.originalErrors||[],retainedSourcesMissing:missing,replayed:check.rendered,nodes:check.documents.reduce((sum,d)=>sum+d.nodes,0),tokens:m.totalTokens,modelTurns:m.attachments.agentRun?.modelTurns,toolCalls:m.attachments.agentRun?.toolCalls})
 corpus.push({input:content,sources})
}
const sample={type:'page',id:'guard',version:'0.1',layout:'stack',fallback:'只展示这份摘要。',children:[{type:'notice',id:'n',title:'不可冒认来源',body:'不应渲染该卡片',sourceRefs:['1','2','3','4','5','6','7','8','untrusted']}]}
const raw='```card\n'+JSON.stringify(sample)+'\n```',known=new Set(['1','2','3','4','5','6','7','8'])
const denied=formatAnswerPresentation(raw,'adaptive',known);assert.equal(denied.trim(),sample.fallback);assert(!denied.includes('不应渲染'))
sample.children[0].sourceRefs=['1','2','3','4','5','6','7','8','1'];const duplicate=formatAnswerPresentation('```card\n'+JSON.stringify(sample)+'\n```','adaptive',known);assert.equal(inspectPresentation(duplicate,known,"准备材料").rendered,'page')
mkdirSync(resolve(root,'storage/shots/presentation'),{recursive:true});writeFileSync(resolve(root,'storage/shots/presentation/recent-card-regression.json'),JSON.stringify({checkedAt:new Date().toISOString(),passed:true,rows,guards:['unknown ninth citation stays rejected','fallback uses one concise summary','duplicates bounded'],scope:'Latest four actual outputs, trusted retained tool evidence replay, three stream chunk widths; no model calls or history mutation'},null,2));writeFileSync(resolve(root,'.tmp/output-audit/recent-card-corpus.json'),JSON.stringify(corpus));console.log(JSON.stringify({passed:true,rows},null,2))
