import {tokenStore} from '@/api/client'
export function campusOrigin(){const p=location.pathname;return p.startsWith('/student')?'student-chat':p.startsWith('/test')?'trial-chat':p.startsWith('/chat')?'admin-chat':p.startsWith('/map')?'campus-map':'campus-guide'}
export function trackCampus(eventType:'CONTENT_VIEW'|'LINK_CLICK'|'MAP_VIEW',data:{entryId?:string;collection?:string;title?:string;url?:string}={}){
 const headers:Record<string,string>={'Content-Type':'application/json'};if(tokenStore.access)headers.Authorization='Bearer '+tokenStore.access
 const payload={requestId:crypto.randomUUID(),eventType,origin:campusOrigin(),entryId:data.entryId?.slice(0,160),collection:data.collection?.slice(0,160),title:data.title?.slice(0,240),url:data.url?.slice(0,2000)}
 void fetch((import.meta.env.VITE_API_BASE||'/api')+'/campus/activity',{method:'POST',headers,keepalive:true,body:JSON.stringify(payload)}).catch(()=>undefined)
}
let installed=false
/** Capture actual link gestures once; it never delays or changes navigation. */
export function installCampusLinkTracking(){
 if(installed)return;installed=true
 const handle=(event:MouseEvent)=>{
  if(event.defaultPrevented||(event.type==='auxclick'&&event.button!==1)||(event.type==='click'&&event.button!==0))return
  const link=(event.target as Element)?.closest?.('a[href]') as HTMLAnchorElement|null
  if(!link||!link.closest('.knowledge-sources,.campus-map-card,.knowledge-card,.mc,.agent-ui,.knowledge-reader,.nx-msg-ai,.trial-answer')||link.closest('.pg-page'))return
  const url=link.href;if(!/^https?:\/\//i.test(url))return
  const metadata=link.closest('[data-campus-entry]') as HTMLElement|null
  trackCampus('LINK_CLICK',{url,title:link.textContent?.trim().slice(0,200)||'资料入口',entryId:metadata?.dataset.campusEntry,collection:metadata?.dataset.campusCollection})
 }
 document.addEventListener('click',handle);document.addEventListener('auxclick',handle)
}
