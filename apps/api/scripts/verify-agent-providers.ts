/** Real SDK requests against an isolated local HTTP server; no external model billing. */
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {once} from 'node:events'
import {AgentRuntime,type RuntimeTool} from '../src/chat/runtime/agent-runtime'
import {AnthropicProvider} from '../src/chat/llm/anthropic.provider'
import {GoogleProvider} from '../src/chat/llm/google.provider'
import {OpenAiCompatibleProvider} from '../src/chat/llm/openai-compatible.provider'

const errors:Error[]=[],calls:Record<string,number>={openai:0,anthropic:0,google:0}
const server=createServer(async(req,res)=>{
 try{
  let raw='';for await(const chunk of req)raw+=chunk
  const body=JSON.parse(raw),protocol=req.url?.includes('messages')?'anthropic':req.url?.includes('streamGenerateContent')?'google':'openai',round=++calls[protocol]
  res.writeHead(200,{'content-type':'text/event-stream'})
  const data=(value:any)=>res.write('data: '+JSON.stringify(value)+'\n\n'),event=(name:string,value:any)=>res.write('event: '+name+'\ndata: '+JSON.stringify(value)+'\n\n')
  if(protocol==='anthropic'){
   if(round===2)assert(body.messages.some((m:any)=>m.content.some((p:any)=>p.type==='tool_result'&&p.tool_use_id==='sdk-call')))
   event('message_start',{type:'message_start',message:{id:'msg-test',type:'message',role:'assistant',model:'test',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:100,output_tokens:0}}})
   if(round===1){event('content_block_start',{type:'content_block_start',index:0,content_block:{type:'tool_use',id:'sdk-call',name:'lookup',input:{}}});event('content_block_delta',{type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:'{"q":"校园卡"}'}})}
   else{event('content_block_start',{type:'content_block_start',index:0,content_block:{type:'text',text:''}});event('content_block_delta',{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'根据资料回答'}})}
   event('content_block_stop',{type:'content_block_stop',index:0});event('message_delta',{type:'message_delta',delta:{stop_reason:round===1?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:20}});event('message_stop',{type:'message_stop'})
  }else if(protocol==='google'){
   if(round===1)assert.equal(body.tools[0].functionDeclarations[0].name,'lookup')
   else assert(body.contents.some((m:any)=>m.parts.some((p:any)=>p.functionResponse?.name==='lookup'&&p.functionResponse.response.text==='资料内容')))
   data({candidates:[{index:0,content:{role:'model',parts:round===1?[{functionCall:{name:'lookup',args:{q:'校园卡'}}}]:[{text:'根据资料回答'}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:20,totalTokenCount:120}})
  }else{
   if(round===2)assert(body.messages.some((m:any)=>m.role==='tool'&&m.tool_call_id==='sdk-call'))
   data({id:'test',object:'chat.completion.chunk',created:1,model:'test',choices:[{index:0,delta:round===1?{tool_calls:[{index:0,id:'sdk-call',type:'function',function:{name:'lookup',arguments:'{"q":"校园卡"}'}}]}:{content:'根据资料回答'},finish_reason:round===1?'tool_calls':'stop'}],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}})
   res.write('data: [DONE]\n\n')
  }
  res.end()
 }catch(error){errors.push(error as Error);res.destroy()}
})
async function main(){
 server.listen(0,'127.0.0.1');await once(server,'listening');const port=(server.address() as any).port,url='http://127.0.0.1:'+port
 const tool:RuntimeTool={name:'lookup',description:'查询',parameters:{type:'object',properties:{q:{type:'string'}},required:['q']},readOnly:true,execute:async()=>'资料内容'}
 for(const provider of [new OpenAiCompatibleProvider(),new AnthropicProvider(),new GoogleProvider()]){
  const result=await new AgentRuntime().run({provider,request:{model:'test',apiKey:'local-sdk-fixture',baseUrl:url,maxTokens:256},messages:[{role:'system',content:'依据工具资料回答'},{role:'user',content:'查询校园卡'}],tools:[tool],contextWindow:4096,maxToolRounds:2,signal:new AbortController().signal,emit:()=>{}})
  assert.equal(result.failure,undefined);assert.equal(result.text,'根据资料回答');assert.equal(result.metrics.modelTurns,2);assert.equal(result.promptTokens,200)
  console.log('PASS '+provider.type+' 实际 SDK 发出工具请求、读取回传结果并完成第二轮回答')
 }
 assert.deepEqual(errors,[])
}
main().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>server.close())
