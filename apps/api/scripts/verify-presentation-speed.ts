import assert from 'node:assert/strict'
import {performance} from 'node:perf_hooks'
import {readFileSync,mkdirSync,writeFileSync,existsSync} from 'node:fs'
import {resolve} from 'node:path'
import {createAnswerProjector} from '../../web/src/utils/answer-projector'
import {answerSegments} from '../../web/src/utils/answer-layout'
import {formatAnswerPresentation} from '../../web/src/utils/answer-presentation'
import {CardBlockCache} from '../../web/src/utils/card-segments'
const root=resolve(__dirname,'../../..'),checks:string[]=[],pass=(text:string)=>{checks.push(text);console.log('PASS '+text)},ids=new Set(['S1'])
const page={type:'page',version:'0.1',id:'speed_page',layout:'stack',children:[{type:'text',id:'intro',content:'请携带学生证。'},{type:'steps',id:'steps',title:'办理步骤',steps:Array.from({length:8},(_,i)=>({title:'第'+(i+1)+'步',desc:'按照窗口要求核对材料并办理。'}))}]},body='```card\n'+JSON.stringify(page)+'\n```'
function oldProject(content:string,streaming:boolean){const parsed=answerSegments(streaming?content:formatAnswerPresentation(content,'adaptive',ids),{streaming});return streaming?parsed.flatMap(seg=>seg.kind==='card'?answerSegments(formatAnswerPresentation('```card\n'+JSON.stringify(seg.card)+'\n```','adaptive',ids),{streaming:false}):[seg]):parsed}
function main(){
 const p=createAnswerProjector(),initial=p.project(body,true,ids),card=initial.find(s=>s.kind==='card')!;assert(card)
 for(let i=1;i<=250;i++){const projected=p.project(body+'\n\n'+('补充文字。'.repeat(i)),true,ids);assert.equal(projected.find(s=>s.kind==='card'),card)}
 const final=p.project(body+'\n\n补充完成。',false,ids);assert.equal(final.find(s=>s.kind==='card'),card);assert.equal(p.stats.normalizations,1);assert.equal(p.stats.blocks.parses,1);assert(p.stats.blocks.hits>=250);pass('250 次流式追加复用完整卡片及组件数据，终态不重新挂载或重复校验')
 const fixtures=[body,'正文\n\n'+body+'\n结语','```card\n{"type":"notice","body":"请带学生证"}\n```','```card\n{"type":"steps","steps":[{"title":"准备"}]}','普通文字与 **《学生手册》** 加粗。','```json\n{"example":true}\n```','```card\n{"type":"page","children":[','前文```card\n'+JSON.stringify(page)+'\n```']
 const corpus=resolve(root,'.tmp/output-audit/soak-samples.json');if(existsSync(corpus))fixtures.push(...JSON.parse(readFileSync(corpus,'utf8')).map((x:any)=>x.input).filter((x:any)=>typeof x==='string').slice(0,80))
 const semantic=(segments:any[])=>segments.map(s=>s.kind==='markdown'?{...s,text:s.text.trim()}:s)
 for(const [i,input] of fixtures.entries())assert.deepEqual(semantic(createAnswerProjector().project(input,false,ids)),semantic(oldProject(input,false)),'完成回答兼容夹具 '+i)
 pass(fixtures.length+' 个既有排版/降级夹具与旧版终态语义一致')
 const sourced='```card\n'+JSON.stringify({...page,children:[{type:'text',id:'cited',content:'原件',sourceRefs:['S1']}]})+'\n```',p2=createAnswerProjector(),without=p2.project(sourced,true,new Set()),withIds=p2.project(sourced,true,ids)
 assert.notDeepEqual(without,withIds);assert.deepEqual(withIds,oldProject(sourced,true));pass('新授权来源抵达后重新校验，缓存不会保留旧来源权限')
 const cache=new CardBlockCache();for(let i=0;i<60;i++)cache.parse(JSON.stringify({type:'notice',title:String(i),body:'x'.repeat(16000)}));assert((cache as any).size<=262144);assert((cache as any).blocks.size<=24);pass('每条回答的完整块缓存有数量和字符上限，不使用跨用户全局回答缓存')
 const inputs=Array.from({length:400},(_,i)=>body+'\n\n'+('已查询到校园服务资料。'.repeat(i+1))),before=performance.now();for(const input of inputs)oldProject(input,true);const oldMs=performance.now()-before,newP=createAnswerProjector(),start=performance.now();for(const input of inputs)newP.project(input,true,ids);const newMs=performance.now()-start
 const directory=resolve(root,'storage/shots/presentation-speed');mkdirSync(directory,{recursive:true});const report={passed:true,checks,benchmark:{updates:inputs.length,oldMs:Math.round(oldMs),newMs:Math.round(newMs),normalizations:newP.stats.normalizations,jsonParses:newP.stats.blocks.parses,cacheHits:newP.stats.blocks.hits,note:'Local deterministic projection benchmark; does not measure LLM latency.'},externalModelCalls:0};writeFileSync(resolve(directory,'projection.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report.benchmark))
}
main()
