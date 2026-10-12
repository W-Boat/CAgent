/** Local marks are preparation aids, never official workflow status or Agent messages. */
const BUCKET='cagent.ui.progress.v1',LIMIT=80
type Store=Pick<Storage,'getItem'|'setItem'>
export function workflowProgressKey(messageKey:string|undefined,nodeId:string,items:unknown):string|undefined {
 if(!messageKey||messageKey.length>200)return
 let hash=2166136261
 for(const char of JSON.stringify(items)){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619)}
 return 'p_'+encodeURIComponent(messageKey)+'_'+nodeId+'_'+(hash>>>0).toString(36)
}
function read(storage:Store):Record<string,number[]> {
 const raw=storage.getItem(BUCKET);if(!raw||raw.length>65536)return {}
 const value=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value))return {}
 return Object.fromEntries(Object.entries(value).slice(-LIMIT).filter(([key,v])=>key.startsWith('p_')&&key.length<=500&&Array.isArray(v)&&v.length<=24&&v.every(i=>Number.isInteger(i)&&i>=0&&i<24))) as Record<string,number[]>
}
export function loadWorkflowProgress(storage:Store|undefined,key:string|undefined,count:number):number[] {
 if(!storage||!key)return []
 try{return [...new Set((read(storage)[key]||[]).filter(i=>i<count))]}catch{return []}
}
export function saveWorkflowProgress(storage:Store|undefined,key:string|undefined,indices:number[]):void {
 if(!storage||!key)return
 try{const entries=read(storage);delete entries[key];if(indices.length)entries[key]=[...new Set(indices.filter(i=>Number.isInteger(i)&&i>=0&&i<24))].slice(0,24);storage.setItem(BUCKET,JSON.stringify(Object.fromEntries(Object.entries(entries).slice(-LIMIT))))}catch{/* Storage may be unavailable; in-memory marking still works. */}
}
