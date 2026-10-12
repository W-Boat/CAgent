import type {GuideHit} from './campus-guide.service'
import {excerptForQuery} from './knowledge-retriever'
export interface KnowledgeSource {
  id:string;citationId?:string;title:string;summary:string;url?:string;collection:string;
  source:string;locator?:string;trust?:string;used:boolean;kind?:string
}
/** Only blocks actually retained within the model's evidence budget become sources. */
export function sourcesFromEvidence(hits:GuideHit[],text:string,query=''):KnowledgeSource[]{
  const retained=new Set([...text.matchAll(/(?:^|\n)\[(-?\d+)\] /g)].map(m=>m[1]))
  const seen=new Set<string>()
  return hits.flatMap(h=>[h,...(h.related||[])]).filter(h=>{
    const id=String(h.externalId);if(!retained.has(id)||seen.has(id))return false;seen.add(id);return true
  }).map(h=>({id:h.id,citationId:String(h.externalId),title:h.title,summary:excerptForQuery(h.summaryShort||'',query,180),
    url:/^https?:\/\//i.test(h.url)?h.url:undefined,collection:h.provenance?.collection||h.cat,
    source:h.provenance?.file||h.source,locator:h.provenance?.locator,trust:h.provenance?.trust,used:false}))
}
/** Citations are matched against retained IDs; arbitrary model-generated IDs are never added. */
export function markCitedSources(sources:KnowledgeSource[],answer:string){
  // JSON numeric rows are data, not citation markers. Keep explicit references in strings.
  const attribution=answer.replace(/```([^\n]*)\n([\s\S]*?)\n```/g,(_all,language,raw)=>{
    if(!['card','json'].includes(language.trim().toLowerCase()))return ''
    try{const value=JSON.parse(raw);if(!value||typeof value.type!=='string')return '';return [...raw.matchAll(/"(?:\\.|[^"\\])*"/g)].map(m=>JSON.parse(m[0])).join('\n')}catch{return ''}
  })
  const cited=new Set([...attribution.matchAll(/\[(-?\d+(?:[,，\s]+-?\d+)*)\]/g)].flatMap(m=>m[1].split(/[,，\s]+/).filter(Boolean)))
  return sources.map(s=>({...s,used:s.kind==='fixed'||s.kind==='map'||!!s.citationId&&cited.has(s.citationId)}))
    .sort((a,b)=>Number(b.used)-Number(a.used))
}
