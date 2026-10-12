import {tokenStore} from '@/api/client'
import {campusOrigin} from './campus-activity'
export type RenderErrorType='syntax'|'schema'|'component'|'module'
const recent=new Map<string,number>()
/** Send bounded diagnostic codes only, never answer text, tool args, credentials or a raw stack. */
export function reportRender(data:{component:string;errorType:RenderErrorType;retryMode:'initial'|'automatic'|'manual';attempt:number;messageId?:string;recovered?:boolean}){
 const key=[data.messageId,data.component,data.errorType,data.retryMode,data.attempt,data.recovered].join(':'),now=Date.now()
 if(recent.has(key)&&now-recent.get(key)!<60000)return
 for(const [k,at] of recent)if(now-at>60000)recent.delete(k)
 if(recent.size>=60)return;recent.set(key,now)
 const headers:Record<string,string>={'Content-Type':'application/json'};if(tokenStore.access)headers.Authorization='Bearer '+tokenStore.access
 const payload={requestId:crypto.randomUUID(),eventType:data.recovered?'RENDER_RECOVERED':'RENDER_ERROR',origin:location.pathname.startsWith('/admin/presentation')?'presentation-lab':campusOrigin(),component:data.component.slice(0,80),errorType:data.errorType,retryMode:data.retryMode,attempt:Math.min(100,Math.max(0,data.attempt)),messageId:data.messageId?.slice(0,160)}
 void fetch((import.meta.env.VITE_API_BASE||'/api')+'/campus/activity',{method:'POST',headers,keepalive:true,body:JSON.stringify(payload)}).catch(()=>undefined)
}
