import {uploadStream} from './upload-stream'
export interface SseFrame {event:string;data:unknown}
/** Shared framing for logged-in and trial chat: UTF-8, CRLF, multiline data and bounded frames. */
export async function readSse(response:Response,onFrame:(frame:SseFrame)=>boolean|void,signal?:AbortSignal){
 const reader=response.body?.getReader()
 if(!reader)throw new Error('浏览器不支持流式响应')
 const decoder=new TextDecoder('utf-8'),maxFrame=2*1024*1024
 let buffer='',terminal=false
 const dispatch=(block:string)=>{
  let event='message';const data:string[]=[]
  for(const line of block.split(/\r?\n/)){if(line.startsWith('event:'))event=line.slice(6).trim();else if(line.startsWith('data:'))data.push(line.slice(5).replace(/^ /,''))}
  if(!data.length)return
  let payload:unknown;try{payload=JSON.parse(data.join('\n'))}catch{throw new Error('服务器返回了无效的流式数据，请重试')}
  terminal=onFrame({event,data:payload})===true
 }
 try{
  while(!terminal){
   if(signal?.aborted)throw new DOMException('已停止生成','AbortError')
   const {value,done}=await reader.read();buffer+=done?decoder.decode():decoder.decode(value,{stream:true})
   let boundary:RegExpExecArray|null
   while(!terminal&&(boundary=/\r?\n\r?\n/.exec(buffer))){const block=buffer.slice(0,boundary.index);buffer=buffer.slice(boundary.index+boundary[0].length);if(block.length>maxFrame)throw new Error('流式事件过大，请重试');dispatch(block)}
   if(buffer.length>maxFrame)throw new Error('流式事件过大，请重试')
   if(done){if(!terminal&&buffer.trim())dispatch(buffer);break}
  }
  if(!terminal)throw new Error('连接提前中断，回答尚未完成，请重试')
 }finally{void reader.cancel().catch(()=>undefined);reader.releaseLock()}
}

export function requestSse(options:{url:string;body:unknown;headers?:Record<string,string>;onUploadProgress?:(percent:number)=>void;onFrame:(frame:SseFrame)=>void;onDone:(result:any)=>void;onError:(message:string)=>void}){
 const controller=new AbortController();let settled=false,serverError:string|undefined
 const finish=(result:any)=>{if(settled)return;settled=true;options.onDone(result)}
 const error=(message:string)=>{if(!serverError){serverError=message;options.onError(message)}}
 const done=(async()=>{
  try{
   const headers={'Content-Type':'application/json',Accept:'text/event-stream',...options.headers},body=JSON.stringify(options.body)
   const response=options.onUploadProgress?await uploadStream(options.url,body,headers,controller.signal,options.onUploadProgress):await fetch(options.url,{method:'POST',headers,body,signal:controller.signal})
   if(!response.ok){const payload=await response.json().catch(()=>null);throw new Error(payload?.message||`请求失败（HTTP ${response.status}）`)}
   if(!response.headers.get('content-type')?.includes('text/event-stream'))throw new Error('服务器没有返回流式响应，请重试')
   await readSse(response,frame=>{
    if(settled)return true
    if(frame.event==='error')error((frame.data as any)?.message||'生成失败')
    if(frame.event==='done'){
     const result=frame.data as any
     if(!result||!['SUCCESS','FAILED','ABORTED'].includes(result.status))throw new Error('服务器返回了无效的完成状态')
     finish(serverError&&result.status==='SUCCESS'?{...result,status:'FAILED'}:result);return true
    }
    options.onFrame(frame)
   },controller.signal)
  }catch(cause){
   if(controller.signal.aborted)finish({status:'ABORTED'})
   else{error((cause as Error)?.message||'无法连接服务器，请稍后重试');finish({status:'FAILED'})}
  }finally{if(!settled)finish({status:controller.signal.aborted?'ABORTED':'FAILED'})}
 })()
 return {abort:()=>controller.abort(),done}
}
