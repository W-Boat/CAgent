/** XHR exposes real upload bytes while preserving the shared SSE reader for responses. */
export function uploadStream(url:string,body:string,headers:Record<string,string>,signal:AbortSignal,progress:(percent:number)=>void):Promise<Response>{
 return new Promise((resolve,reject)=>{
  const xhr=new XMLHttpRequest(),encoder=new TextEncoder();let cursor=0,opened=false,ended=false,streamController:ReadableStreamDefaultController<Uint8Array>
  const stream=new ReadableStream<Uint8Array>({start:c=>{streamController=c},cancel:()=>{ended=true;cleanup();xhr.abort()}})
  const abort=()=>xhr.abort(),cleanup=()=>signal.removeEventListener('abort',abort)
  const fail=(error:Error)=>{cleanup();if(ended)return;ended=true;if(opened)streamController.error(error);else reject(error)}
  const publish=()=>{if(opened||!xhr.status||ended)return;opened=true;const responseHeaders=new Headers();for(const line of xhr.getAllResponseHeaders().trim().split(/\r?\n/)){const at=line.indexOf(':');if(at>0)responseHeaders.append(line.slice(0,at),line.slice(at+1).trim())}resolve(new Response(stream,{status:xhr.status,statusText:xhr.statusText,headers:responseHeaders}))}
  const push=(final=false)=>{publish();if(ended||!opened)return;const text=xhr.responseText;let end=text.length;if(!final&&end>cursor&&/[\uD800-\uDBFF]/.test(text[end-1]))end--;if(end>cursor){streamController.enqueue(encoder.encode(text.slice(cursor,end)));cursor=end}}
  xhr.open('POST',url);for(const [key,value] of Object.entries(headers))xhr.setRequestHeader(key,value)
  xhr.upload.onprogress=e=>{if(!ended&&e.lengthComputable)progress(Math.round(e.loaded/e.total*100))}
  xhr.upload.onload=()=>{if(!ended)progress(100)}
  xhr.onreadystatechange=()=>{if(xhr.readyState>=2)publish()};xhr.onprogress=()=>push()
  xhr.onload=()=>{push(true);cleanup();if(!ended){ended=true;streamController.close()}}
  xhr.onerror=()=>fail(new Error('图片上传连接失败，请重新发送'))
  xhr.onabort=()=>fail(new DOMException('已停止生成','AbortError'))
  xhr.ontimeout=()=>fail(new Error('图片上传超时，请重新发送'));xhr.timeout=300_000
  if(signal.aborted){fail(new DOMException('已停止生成','AbortError'));return}signal.addEventListener('abort',abort,{once:true});xhr.send(body)
 })
}
