/** Local HTTP fixtures and runtime only; no external provider calls. */
import 'reflect-metadata'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdirSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {providerCacheUsage,addProviderCache,mergeProviderCache} from '../src/chat/llm/provider-cache'
import {OpenAiCompatibleProvider} from '../src/chat/llm/openai-compatible.provider'
import {AgentRuntime} from '../src/chat/runtime/agent-runtime'
import type {LlmProvider,LlmUsage} from '../src/chat/llm/types'
const root=resolve(__dirname,'../../..'),checks:string[]=[]
const pass=(name:string)=>{checks.push(name);console.log('PASS '+name)}
async function main(){
 assert.deepEqual(providerCacheUsage({prompt_tokens:1000,prompt_cache_hit_tokens:640,prompt_cache_miss_tokens:360}),{promptCacheHitTokens:640,promptCacheMissTokens:360})
 assert.deepEqual(providerCacheUsage({prompt_tokens:1000,prompt_tokens_details:{cached_tokens:900}}),{promptCacheHitTokens:900,promptCacheMissTokens:100})
 assert.deepEqual(providerCacheUsage({prompt_tokens:1000,prompt_cache_hit_tokens:0,prompt_cache_miss_tokens:1000}),{promptCacheHitTokens:0,promptCacheMissTokens:1000})
 for(const invalid of [{prompt_tokens:1000},{prompt_tokens:1000,prompt_cache_hit_tokens:1001},{prompt_tokens:1000,prompt_cache_hit_tokens:'900'},{prompt_tokens:1000,prompt_cache_hit_tokens:600,prompt_cache_miss_tokens:500}])assert.deepEqual(providerCacheUsage(invalid),{})
 pass('识别DeepSeek/标准缓存字段，区分未报告与明确零命中，拒绝无效计数')
 let raw:any={prompt_tokens:1000,completion_tokens:1,prompt_cache_hit_tokens:640,prompt_cache_miss_tokens:360}
 const server=createServer((request,response)=>{let body='';request.on('data',data=>body+=data);request.on('end',()=>{const payload=JSON.parse(body);assert.equal(payload.stream_options.include_usage,true);assert.equal(payload.prompt_cache_key,undefined);response.writeHead(200,{'Content-Type':'text/event-stream'});response.end('data: '+JSON.stringify({choices:[{delta:{content:'OK'},finish_reason:'stop'}]})+'\n\ndata: '+JSON.stringify({choices:[],usage:raw})+'\n\ndata: [DONE]\n\n')})})
 await new Promise<void>(ready=>server.listen(0,'127.0.0.1',ready))
 try{
  const port=(server.address() as any).port,provider=new OpenAiCompatibleProvider()
  for(const reported of [true,false]){
   if(!reported)raw={prompt_tokens:1000,completion_tokens:1}
   const events=[];for await(const event of provider.stream({model:'fixture',apiKey:'fixture-not-real',baseUrl:`http://127.0.0.1:${port}/v1`,messages:[{role:'user',content:'合成测试'}]}))events.push(event)
   const usage=events.find(e=>e.type==='usage') as any
   assert(usage);assert.equal(usage.usage.promptTokens,1000);assert.equal(usage.usage.promptCacheHitTokens,reported?640:undefined)
   assert(events.some(e=>e.type==='done'))
  }
 }finally{await new Promise<void>((ready,reject)=>server.close(error=>error?reject(error):ready()))}
 pass('真实OpenAI SDK消费SSE终帧usage，缓存字段保留，缺字段时保持未知')
 let call=0
 const fake:LlmProvider={type:'OPENAI_COMPATIBLE',async *stream(){call++;if(call===1)yield {type:'tool_call',call:{id:'lookup',name:'knowledge_search',arguments:'{}'}};else yield {type:'text',text:'已回答'}
  const usage:LlmUsage=call===1?{promptTokens:1000,completionTokens:1,totalTokens:1001,promptCacheHitTokens:640,promptCacheMissTokens:360}:{promptTokens:1200,completionTokens:1,totalTokens:1201,promptCacheHitTokens:900,promptCacheMissTokens:300}
  yield {type:'usage',usage};yield {type:'usage',usage};yield {type:'done',finishReason:'stop'}
 }}
 const result=await new AgentRuntime().run({provider:fake,request:{model:'fixture',apiKey:'not-real',maxTokens:100},messages:[{role:'user',content:'测试'}],tools:[{name:'knowledge_search',description:'fixture',parameters:{type:'object'},readOnly:true,execute:async()=> '合成证据'}],contextWindow:8192,maxToolRounds:3,signal:new AbortController().signal,emit:()=>{}})
 assert.equal(result.failure,undefined);assert.equal(result.metrics.modelTurns,2)
 assert.deepEqual(result.metrics.providerCache,{reportedCalls:2,unreportedCalls:0,hitTokens:1540,missTokens:660})
 assert.equal(result.promptTokens,2200)
 const unknown=addProviderCache(undefined,{promptTokens:12,completionTokens:1,totalTokens:13})
 assert.deepEqual(mergeProviderCache(result.metrics.providerCache,unknown),{reportedCalls:2,unreportedCalls:1,hitTokens:1540,missTokens:660})
 pass('多轮/重复usage只按最终快照累计一次，未知调用单独计数且不冒充零命中')
 mkdirSync(resolve(root,'storage/shots/provider-cache'),{recursive:true})
 writeFileSync(resolve(root,'storage/shots/provider-cache/local-verification.json'),JSON.stringify({checks,externalModelCalls:0},null,2))
}
main().catch(error=>{console.error(error);process.exitCode=1})
