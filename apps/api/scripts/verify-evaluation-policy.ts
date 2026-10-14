import 'reflect-metadata'
import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {validate} from 'class-validator'
import {CreateEvaluationDto} from '../src/evaluation/evaluation.dto'
import {runEvaluationBatches,reviewStrictReply,strictPlainText,STRICT_FALLBACK,EVALUATION_V2_SOURCES} from '../src/evaluation/evaluation-policy'
import {CampusGuideService} from '../src/campus/campus-guide.service'
import {embeddedSourceWhere,embeddedSourceId} from '../src/knowledge/embedded-knowledge'
const checks:string[]=[],pass=(s:string)=>{checks.push(s);console.log('PASS '+s)},sleep=(n:number)=>new Promise(r=>setTimeout(r,n))
async function main(){
 let active=0,peak=0;const visited:number[]=[]
 await runEvaluationBatches([1,2,3,4],2,new AbortController().signal,async n=>{active++;peak=Math.max(peak,active);await sleep(n%2?10:1);visited.push(n);active--})
 assert.equal(peak,2);assert.deepEqual(visited.sort(),[1,2,3,4]);pass('并发批次有界且全部等待完成')
 const cancel=new AbortController();let calls=0
 await runEvaluationBatches([1,2,3],2,cancel.signal,async()=>{calls++;cancel.abort();await sleep(2)})
 assert.equal(calls,1)
 let finished=false
 await assert.rejects(()=>runEvaluationBatches([1,2,3],2,new AbortController().signal,async n=>{if(n===1){await sleep(1);throw Error('fixture')}await sleep(8);finished=true}))
 assert(finished);pass('取消后不启动新批次，异常等待已在途批次回收')
 for(const value of [0,9,1.5,'2']){const dto=Object.assign(new CreateEvaluationDto(),{title:'测试',format:'json',data:'["问题"]',concurrency:value});assert((await validate(dto)).some(e=>e.property==='concurrency'))}
 assert.equal((await validate(Object.assign(new CreateEvaluationDto(),{title:'测试',format:'json',data:'["问题"]',concurrency:8,strictMode:true,knowledgeScope:'v2-only'}))).length,0);pass('并发整数边界及严格模式、两库范围 DTO 校验')
 const card='```card\n'+JSON.stringify({type:'page',children:[{type:'text',content:'带学生证前往服务窗口。'}]})+'\n```'
 assert.equal(strictPlainText(card),'带学生证前往服务窗口。');assert.equal(strictPlainText('```card\n{"type":"care","body":"卡片"}\n```'),STRICT_FALLBACK)
 assert(!strictPlainText('<b>正文</b>\n```html\n<script>unsafe</script>\n```').includes('script'));pass('严格输出转换为纯文字，原生卡片/代码不透出')
 for(const [reply,finish,allowed] of [['{"campusGuide":true,"neutral":true,"safe":true,"grounded":true}','stop',true],['{"campusGuide":false,"neutral":true,"safe":true,"grounded":true}','stop',false],['{"campusGuide":true,"neutral":true,"safe":true,"grounded":true}','length',false],['true','stop',false],['invalid','stop',false]] as const){
  const provider={type:'OPENAI_COMPATIBLE',async*stream(options:any){assert.equal(options.tools,undefined);assert.equal(options.temperature,0);yield {type:'text',text:reply};yield {type:'usage',usage:{promptTokens:11,completionTokens:3}};yield {type:'done',finishReason:finish}}} as any
  const result=await reviewStrictReply(provider,{model:'fixture',apiKey:'fake'},{question:'去哪办校园卡',previousQuestions:[],reply:'携带学生证',evidence:'带学生证'},new AbortController().signal)
  assert.equal(result.allowed,allowed);assert.equal(result.promptTokens,11)
 }
 const broken={async*stream(){throw Error('network');yield {type:'done'}}} as any
 assert.equal((await reviewStrictReply(broken,{model:'fixture',apiKey:'fake'},{question:'问题',previousQuestions:[],reply:'正文',evidence:'资料'},new AbortController().signal)).allowed,false);pass('独立语义审核仅接受全部明确通过，异常/截断/无效结果拒绝且计入实际用量')
 const rows=[{id:'scoped1',externalId:1,title:'2.0 办事窗口',searchText:'校园卡',extra:{kb:{collection:'campus-v2-contest',file:'database/campus.sqlite',simulation:true}}}],whereSeen:any[]=[];let rowReads=0,globalReads=0,revision='r1',removed=false
 const db={knowledgeBase:{findMany:async()=>removed?[]:EVALUATION_V2_SOURCES.map(key=>({id:embeddedSourceId(key)}))},campusGuideItem:{findMany:async(args:any)=>{whereSeen.push(args.where);rowReads++;await sleep(2);return rows}}}
 const guide=new CampusGuideService(db as any,{revision:async()=>revision} as any);(guide as any).index=async()=>{globalReads++;return {rows:[]}}
 await Promise.all(Array.from({length:5},()=>guide.catalogBlock({sourceKeys:EVALUATION_V2_SOURCES})))
 assert.equal(rowReads,1);assert.equal(globalReads,0);assert.deepEqual(whereSeen[0],{OR:EVALUATION_V2_SOURCES.map(embeddedSourceWhere)})
 await guide.catalogBlock({sourceKeys:EVALUATION_V2_SOURCES});assert.equal(rowReads,1)
 await guide.catalogBlock();assert.equal(globalReads,1);revision='r2';await guide.catalogBlock({sourceKeys:EVALUATION_V2_SOURCES});assert.equal(rowReads,2)
 removed=true;await assert.rejects(()=>guide.catalogBlock({sourceKeys:EVALUATION_V2_SOURCES}));await assert.rejects(()=>guide.catalogBlock({sourceKeys:['other']}));pass('两库索引与全站索引隔离，指定文件过滤、单次并发构建、修订失效、移除后拒绝')
 const directory=resolve(__dirname,'../../../storage/shots/evaluation');mkdirSync(directory,{recursive:true});writeFileSync(resolve(directory,'policy-verification.json'),JSON.stringify({passed:true,checks,externalModelCalls:0},null,2))
}
main().catch(e=>{console.error(e);process.exitCode=1})
