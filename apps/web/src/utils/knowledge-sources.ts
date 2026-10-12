import type {KnowledgeSource} from '@/api/chat-stream'
export function normalizeKnowledgeSources(value:unknown):KnowledgeSource[]{
  if(!Array.isArray(value))return []
  return value.filter(h=>h&&typeof h.title==='string').map(h=>({id:String(h.id||h.externalId||h.title),title:h.title,
    citationId:h.citationId?String(h.citationId):undefined,collection:String(h.collection||h.cat||''),source:String(h.source||h.provenance?.file||''),
    summary:typeof h.summary==='string'?h.summary:undefined,locator:typeof h.locator==='string'?h.locator:undefined,trust:typeof h.trust==='string'?h.trust:undefined,
    kind:typeof h.kind==='string'?h.kind:undefined,url:typeof h.url==='string'&&/^https?:\/\//i.test(h.url)?h.url:undefined,used:h.used===true}))
}
