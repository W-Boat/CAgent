/** Clean visible citation markers without touching JSON numbers, metadata or actions. */
export function cardDisplayData<T>(value:T,known:ReadonlySet<string>):T {
 const clean=(text:string)=>text.replace(/\[\s*((?:S\d+|-?\d+)(?:[\s,，]+(?:S\d+|-?\d+))*)\s*\]/g,(all,body)=>body.split(/[\s,，]+/).filter(Boolean).every((id:string)=>known.has(id)||/^S\d+$/.test(id))?'':all)
 const visit=(v:any,depth:number):any=>{
  if(depth>8)return v
  if(typeof v==='string')return clean(v)
  if(Array.isArray(v))return v.map(x=>visit(x,depth+1))
  if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,['id','type','version','action','actions','sourceRefs','url','key','source','citationId','externalId','restaurants','initial'].includes(k)?x:visit(x,depth+1)]))
  return v
 }
 return visit(value,0)
}
