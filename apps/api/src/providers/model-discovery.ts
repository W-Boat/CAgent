import {BadRequestException} from '@nestjs/common'
export interface DiscoveredModel {key:string;name:string;contextWindow?:number;maxOutputTokens?:number;supportsVision?:boolean}
export async function discoverProviderModels(type:string,baseUrl:string|undefined|null,apiKey:string):Promise<{models:DiscoveredModel[];partial:boolean}>{
 const defaults:Record<string,string>={OPENAI_COMPATIBLE:'https://api.openai.com/v1',ANTHROPIC:'https://api.anthropic.com',GOOGLE:'https://generativelanguage.googleapis.com/v1beta',OLLAMA:'http://localhost:11434'}
 if(!defaults[type])throw new BadRequestException('此供应商协议暂无统一模型列表，请手动添加模型')
 let url:URL;try{url=new URL(baseUrl||defaults[type])}catch{throw new BadRequestException('供应商地址无效')}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new BadRequestException('请使用不含凭据、查询参数或片段的供应商基础地址')
 const headers:Record<string,string>={Accept:'application/json'};let path=url.pathname.replace(/\/$/,'')
 if(type==='OLLAMA')path=path.replace(/\/(?:v1|api)$/,'')+'/api/tags'
 else if(type==='ANTHROPIC'){path=path.replace(/\/v1$/,'')+'/v1/models';headers['x-api-key']=apiKey;headers['anthropic-version']='2023-06-01'}
 else if(type==='GOOGLE'){path=path.replace(/\/v1(?:beta)?$/,'')+'/v1beta/models';headers['x-goog-api-key']=apiKey}
 else headers.Authorization='Bearer '+apiKey
 url.pathname=type==='OPENAI_COMPATIBLE'?path+'/models':path
 if(type==='ANTHROPIC')url.searchParams.set('limit','1000')
 if(type==='GOOGLE')url.searchParams.set('pageSize','1000')
 let data:any
 try{const response=await fetch(url,{headers,redirect:'error',signal:AbortSignal.timeout(20000)});if(!response.ok){await response.body?.cancel();throw new BadRequestException(`模型列表接口返回 HTTP ${response.status}，请检查地址、密钥权限或手动添加模型`)}
  const reader=response.body?.getReader();if(!reader)throw Error();const chunks:Uint8Array[]=[];let size=0;try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>2_000_000)throw Error('limit');chunks.push(part.value)}}finally{await reader.cancel().catch(()=>{})}data=JSON.parse(Buffer.concat(chunks).toString('utf8'))
 }catch(e){if(e instanceof BadRequestException)throw e;throw new BadRequestException('模型列表读取失败或超时，请检查供应商网络和接口；未发起模型推理')}
 const list=type==='GOOGLE'||type==='OLLAMA'?data.models:data.data;if(!Array.isArray(list))throw new BadRequestException('供应商未返回可识别的模型列表')
 const models=new Map<string,DiscoveredModel>();const number=(v:any)=>Number.isSafeInteger(v)&&v>0&&v<=16_777_216?v:undefined
 for(const item of list.slice(0,2000)){const key=type==='GOOGLE'?String(item.name||'').replace(/^models\//,''):type==='OLLAMA'?item.model||item.name:item.id;if(typeof key!=='string'||!key.trim()||key.length>200||/[\x00-\x20]/.test(key))continue
  models.set(key,{key,name:String(item.display_name||item.displayName||item.name||key).slice(0,200),contextWindow:number(item.context_window??item.inputTokenLimit),maxOutputTokens:number(item.max_output_tokens??item.outputTokenLimit),supportsVision:Array.isArray(item.input_modalities)?item.input_modalities.includes('image'):undefined})}
 return {models:[...models.values()],partial:!!data.has_more||!!data.nextPageToken||list.length>2000}
}
