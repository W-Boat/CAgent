import type {LlmUsage} from './types'

/** Missing telemetry is unknown, never proof that a service has no cache. */
export interface ProviderCacheSummary {
 reportedCalls:number
 unreportedCalls:number
 hitTokens:number
 missTokens:number
}
const count=(value:unknown):number|undefined=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:undefined

/** DeepSeek's explicit fields and the standard Chat Completions cached-token field. */
export function providerCacheUsage(raw:any):Pick<LlmUsage,'promptCacheHitTokens'|'promptCacheMissTokens'> {
 const prompt=count(raw?.prompt_tokens)
 const hit=count(raw?.prompt_cache_hit_tokens)??count(raw?.prompt_tokens_details?.cached_tokens)
 const miss=count(raw?.prompt_cache_miss_tokens)
 if(prompt===undefined||hit===undefined&&miss===undefined)return {}
 if(hit!==undefined&&hit>prompt||miss!==undefined&&miss>prompt)return {}
 const read=hit??prompt-miss!,write=miss??prompt-hit!
 if(read+write!==prompt)return {}
 return {promptCacheHitTokens:read,promptCacheMissTokens:write}
}

export function addProviderCache(previous:ProviderCacheSummary|undefined,usage?:LlmUsage):ProviderCacheSummary {
 const result={reportedCalls:0,unreportedCalls:0,hitTokens:0,missTokens:0,...previous}
 const hit=count(usage?.promptCacheHitTokens),miss=count(usage?.promptCacheMissTokens)
 if(hit===undefined||miss===undefined){result.unreportedCalls++;return result}
 result.reportedCalls++;result.hitTokens+=hit;result.missTokens+=miss
 return result
}

export function mergeProviderCache(a:ProviderCacheSummary|undefined,b:ProviderCacheSummary|undefined):ProviderCacheSummary|undefined {
 if(!a&&!b)return undefined
 return {reportedCalls:(a?.reportedCalls||0)+(b?.reportedCalls||0),unreportedCalls:(a?.unreportedCalls||0)+(b?.unreportedCalls||0),hitTokens:(a?.hitTokens||0)+(b?.hitTokens||0),missTokens:(a?.missTokens||0)+(b?.missTokens||0)}
}
