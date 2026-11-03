import 'reflect-metadata'
import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import AdmZip from 'adm-zip'
import {parseValidationWorkbook,writeWorkbook,resultWorkbook,validationTemplate} from '../src/evaluation/evaluation-xlsx'
import {parseTestSet,flattenTestSet} from '../src/evaluation/batch-format'
import {EvaluationService} from '../src/evaluation/evaluation.service'
async function main(){
 const out=resolve(__dirname,'../../../.tmp/evaluation-alignment-20261103');mkdirSync(out,{recursive:true})
 const secret='REFERENCE_ONLY_DO_NOT_SEND',input=writeWorkbook([['问题','预期答案'],['异常题',secret],['空回复题','参考二'],['正常题','参考三']]),batches=parseValidationWorkbook(input.toString('base64'))
 assert.equal(batches.length,3);assert.equal(batches[0].split,'validation');assert.equal(batches[0].expectedAnswers![0],secret)
 assert.equal(flattenTestSet(parseTestSet('问题,预期答案\n问题一,参考一','csv'))[0].expectedAnswer,'参考一')
 assert.throws(()=>parseValidationWorkbook(validationTemplate().toString('base64')))
 for(const rows of [[['错误','预期答案'],['问','答']],[['问题','预期答案'],['','答']],[['问题','预期答案','其他'],['问','答','值']]])assert.throws(()=>parseValidationWorkbook(writeWorkbook(rows).toString('base64')))
 assert.throws(()=>parseValidationWorkbook('UEs='));assert.throws(()=>parseValidationWorkbook('not-base64'))
 const formula=new AdmZip(input);formula.updateFile('xl/worksheets/sheet1.xml',Buffer.from(formula.readAsText('xl/worksheets/sheet1.xml').replace('<c r="A2"','<f>1+1</f><c r="A2"')));assert.throws(()=>parseValidationWorkbook(formula.toBuffer().toString('base64')))
 const shared=new AdmZip(input);shared.addFile('xl/sharedStrings.xml',Buffer.from('<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>共享字符串题</t></si></sst>'));shared.updateFile('xl/worksheets/sheet1.xml',Buffer.from(shared.readAsText('xl/worksheets/sheet1.xml').replace('<c r="A2" t="inlineStr"><is><t xml:space="preserve">异常题</t></is></c>','<c r="A2" t="s"><v>0</v></c>')));assert.equal(parseValidationWorkbook(shared.toBuffer().toString('base64'))[0].questions[0],'共享字符串题')
 let job:any,turns:any[]=[];const calls:any[]=[]
 const db:any={
  $transaction:async(fn:any)=>fn(db),$queryRaw:async()=>[],
  evaluationJob:{count:async()=>0,create:async({data}:any)=>{turns=data.turns.create.map((t:any,i:number)=>({id:String(i),reply:'',latencyMs:0,...t}));return job={...data,id:'fixture',createdAt:new Date()};},findFirst:async({where}:any)=>where.status==='QUEUED'?(job.status==='QUEUED'?job:null):job,findUnique:async()=>job,updateMany:async({data}:any)=>{Object.assign(job,data);return {count:1}},update:async({data}:any)=>{Object.assign(job,data);return job}},
  evaluationTurn:{findMany:async()=>turns,update:async({where,data}:any)=>{Object.assign(turns.find(t=>t.id===where.id),data)},groupBy:async()=>Array.from(new Set(turns.map(t=>t.status))).map(status=>({status,_count:{_all:turns.filter(t=>t.status===status).length}}))},
  conversation:{create:async()=>({id:'conv-'+calls.length})},message:{findUnique:async()=>null}
 }
 const chat={streamChat:async(_user:any,dto:any,res:any,_rev:any,internal:any)=>{calls.push({dto,internal});assert(!JSON.stringify({dto,internal}).includes(secret));if(dto.content==='异常题')throw Error('fixture');res.status='SUCCESS';res.reply=dto.content==='空回复题'?'':'真实回复'}},user:any={id:'user',email:'fixture@example.invalid',permissions:['*'],roles:[]}
 const service:any=new EvaluationService(db,chat as any,{log:async()=>{}} as any);service.busy=true;service.actor=async()=>user
 await service.create(user,{title:'独立流程验证',format:'json',split:'validation',data:JSON.stringify({batches})})
 assert.equal(job.options.expectedAnswers[0],secret);assert.match(job.options.inputSha256,/^[a-f0-9]{64}$/);assert.equal(job.options.outputPreference,'text');assert(!('expectedAnswer' in turns[0]))
 service.busy=false;await service.pump();assert.deepEqual(turns.map(t=>t.status),['FAILED','FAILED','SUCCESS']);assert.equal(job.completed,3);assert.equal(job.failed,2);assert.equal(calls.length,3)
 const detail=await service.detail(user,'fixture');assert.equal(detail.turns[0].expectedAnswer,secret)
 for(const format of ['json','csv','xlsx']){const file=await service.export(user,'fixture',format);writeFileSync(resolve(out,'result.'+format),file.body);if(format==='json'){const result=JSON.parse(file.body);assert.equal(result.batches.length,3);assert.equal(result.batches[0].turns[0].expected_answer,secret)}if(format==='xlsx'){const zip=new AdmZip(file.body),xml=zip.readAsText('xl/worksheets/sheet1.xml');assert(xml.includes('智能体实际回复'));assert(xml.includes(secret));assert(xml.includes('FAILED'))}}
 const long='长回复😀'.repeat(10000),longZip=new AdmZip(resultWorkbook([{question:'问',expected_answer:'答',reply:long,status:'SUCCESS',error:'',latency_ms:1,batch_id:'1',turn:1,split:'validation'}]));assert(longZip.readAsText('xl/worksheets/sheet1.xml').includes('智能体实际回复（续1）'));writeFileSync(resolve(out,'long.xlsx'),longZip.toBuffer())
 writeFileSync(resolve(out,'input.xlsx'),input);writeFileSync(resolve(out,'report.json'),JSON.stringify({passed:true,checks:['Excel 两列/共享字符串解析','无效表头/空问题/多列/公式/非法文件拒绝','JSON/CSV 参考答案兼容','参考答案与模型输入隔离','输入指纹与纯文字默认值','单题异常和空回复隔离','失败题纳入总数','Excel/JSON/CSV 完整导出','长回复续列保留'],externalModelCalls:0},null,2));console.log('PASS evaluation workbook: 9 groups; external model calls 0')
}
main().catch(e=>{console.error(e);process.exitCode=1})
