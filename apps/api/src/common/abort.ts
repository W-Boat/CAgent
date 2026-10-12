/** One cancellation scope per request/tool; listeners and deadlines are always released. */
export function abortScope(parent?: AbortSignal, timeoutMs?: number) {
  const controller = new AbortController()
  const cancel = () => controller.abort(parent?.reason)
  if (parent?.aborted) cancel()
  else parent?.addEventListener('abort', cancel, {once:true})
  const timer = timeoutMs ? setTimeout(() => controller.abort(new DOMException('请求处理超时，请稍后重试', 'TimeoutError')), timeoutMs) : undefined
  timer?.unref?.()
  return {controller, signal:controller.signal, dispose:() => {if(timer)clearTimeout(timer);parent?.removeEventListener('abort',cancel)}}
}
export function checkAbort(signal?:AbortSignal):void {if(signal?.aborted)throw signal.reason || new DOMException('已停止生成','AbortError')}
export async function abortable<T>(work:Promise<T>,signal?:AbortSignal):Promise<T> {
  if(!signal)return work
  // Register a rejection handler even when cancellation preceded this operation.
  if(signal.aborted){void work.catch(()=>undefined);checkAbort(signal)}
  let cancel:()=>void=()=>undefined
  const stopped=new Promise<never>((_,reject)=>{cancel=()=>reject(signal.reason||new DOMException('已停止生成','AbortError'));signal.addEventListener('abort',cancel,{once:true})})
  try{return await Promise.race([work,stopped])}finally{signal.removeEventListener('abort',cancel)}
}
