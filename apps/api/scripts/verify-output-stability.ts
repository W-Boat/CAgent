import 'reflect-metadata'
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {resolve} from 'node:path'
import ts from 'typescript'
import {AnswerPresentationStream,formatAnswerPresentation} from '../src/presentation/answer-presentation'
import {validateUiDocument} from '../src/presentation/agent-ui'
import {parseCardJson} from '../src/presentation/card-json'
const root=resolve(__dirname,'../../..')
function load(path:string,deps:Record<string,unknown>={}){const module={exports:{} as any};new Function('module','exports','require',ts.transpileModule(readFileSync(resolve(root,path),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(module,module.exports,(key:string)=>deps[key]);return module.exports}
const ui=load('apps/web/src/utils/agent-ui.ts'),json=load('apps/web/src/utils/card-json.ts'),boundary=load('apps/web/src/utils/output-boundary.ts'),segments=load('apps/web/src/utils/card-segments.ts',{'./agent-ui':ui,'./card-json':json}),{answerSegments}=load('apps/web/src/utils/answer-layout.ts',{'./card-segments':segments,'./card-json':json,'./output-boundary':boundary}),{UI_EXAMPLES}=load('apps/web/src/utils/agent-ui-examples.ts')
const samples:any[]=[],tally={valid:{total:0,success:0},recoverable:{total:0,success:0},incomplete:{total:0,explicit:0}},failures:string[]=[]
for(let i=0;i<10000;i++){
 const example=UI_EXAMPLES[i%UI_EXAMPLES.length].document,doc=JSON.parse(JSON.stringify(example)),kind=i%10;doc.id='soak_'+i
 let raw=JSON.stringify(doc),group:'valid'|'recoverable'|'incomplete'=kind<6?'valid':kind<9?'recoverable':'incomplete'
 if(kind===3)raw=raw.replace(/\}$/,',}')
 if(kind===4)raw='/*格式注释*/'+raw
 if(kind===6){doc.version='99';raw=JSON.stringify(doc)}
 if(kind===7){doc.sourceRefs=['unauthorized'];raw=JSON.stringify(doc);group='valid'}
 if(kind===8)raw=raw.slice(0,raw.lastIndexOf('}'))
 if(kind===9)raw='{"type":"page","children":['
 const input=(i%2?'前文紧邻':'前文\n\n')+'```'+(i%3?'card':'json')+'\n'+raw+(kind===8||kind===9?'':'\n```'),sourceIds=new Set<string>()
 const normalized=formatAnswerPresentation(input,'adaptive',sourceIds),stream=new AnswerPresentationStream('adaptive',()=>sourceIds),width=1+i%43;let streamed=''
 for(let n=0;n<input.length;n+=width)streamed+=stream.push(input.slice(n,n+width));streamed+=stream.finish()
 try{
  assert.equal(streamed,normalized,'arbitrary stream chunks must match stored answer')
  const parsed=answerSegments(normalized,{streaming:false,sourceIds})
  assert(!parsed.some((s:any)=>s.kind==='pending'||s.kind==='broken'))
  if(kind===7)assert(!normalized.includes('unauthorized'),'Invalid provenance never becomes a verified reference')
  if(group==='valid'){tally.valid.total++;assert(parsed.some((s:any)=>s.kind==='card'));for(const block of normalized.matchAll(/```card\n([\s\S]*?)\n```/g))assert(validateUiDocument(parseCardJson(block[1]),{sourceIds}).ok);tally.valid.success++}
  else if(group==='recoverable'){tally.recoverable.total++;assert(!normalized.includes('"type":'));assert(normalized.includes(doc.fallback)||normalized.includes(doc.children[0].title||doc.children[0].content||doc.children[0].alt));assert(!normalized.includes('未完整生成'));tally.recoverable.success++}
  else{tally.incomplete.total++;assert(normalized.includes('未完整生成'));tally.incomplete.explicit++}
 }catch(error){failures.push(i+': '+(error as Error).message.slice(0,130))}
 if(i<160)samples.push({group,input,normalized})
}
const recent=JSON.parse(readFileSync(resolve(root,'.tmp/output-audit/recent.json'),'utf8')).items.filter((m:any)=>m.role==='assistant'),history=recent.map((m:any)=>{const sources=new Set<string>((m.attachments?.knowledgeSources||m.attachments?.kbHits||m.attachments?.sources||[]).flatMap((s:any)=>[String(s.id),...(s.citationId?[String(s.citationId)]:[])]));const diagnoses=[...m.content.matchAll(/```(?:card|json)\s*\n([\s\S]*?)(?:\n```|$)/g)].map((match:any)=>{try{return validateUiDocument(parseCardJson(match[1]),{sourceIds:sources}).errors}catch{return ['JSON syntax']}});const content=formatAnswerPresentation(m.content,'adaptive',sources),before=answerSegments(m.content,{streaming:false,sourceIds:sources}),after=answerSegments(content,{streaming:false,sourceIds:sources});return {id:m.id,diagnoses,beforeCards:before.filter((s:any)=>s.kind==='card').length,afterCards:after.filter((s:any)=>s.kind==='card').length,partial:m.status!=='SUCCESS',remainingRaw:/"type"\s*:\s*"page"/.test(content)&&!after.some((s:any)=>s.kind==='card')};})
const report={checkedAt:new Date().toISOString(),fixtureCount:10000,tally,failures:failures.slice(0,20),rates:{validRendering:tally.valid.success/tally.valid.total,readableFallback:tally.recoverable.success/tally.recoverable.total},history,scope:'Deterministic schema + actual frontend segment parser, registered template examples, 43 stream widths. Not a production LLM reliability guarantee. Empty partial answers reported separately.'}
mkdirSync(resolve(root,'storage/shots/presentation'),{recursive:true});writeFileSync(resolve(root,'storage/shots/presentation/output-stability.json'),JSON.stringify(report,null,2));writeFileSync(resolve(root,'.tmp/output-audit/soak-samples.json'),JSON.stringify(samples));console.log(JSON.stringify({fixtureCount:report.fixtureCount,tally,rates:report.rates,failures:report.failures},null,2));assert.equal(failures.length,0);assert(report.rates.validRendering>=.999&&report.rates.readableFallback>=.999)
