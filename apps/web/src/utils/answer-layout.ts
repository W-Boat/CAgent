import {parseCardSegments,isCompatibleCard,type Segment,type CardBlockCache} from './card-segments'
import {stripToolMarkup} from './output-boundary'
import {parseCardJson} from './card-json'

export function answerSegments(text:string,options:{streaming?:boolean;hasKnowledgeSources?:boolean;cache?:CardBlockCache}={}):Segment[]{
  const parsed=parseCardSegments(stripToolMarkup(text),options.cache)
  return parsed.flatMap(segment=>{
    if(segment.kind==='pending'&&options.streaming===false){try{const card=parseCardJson(segment.text||'') as Record<string,unknown>;if(card&&typeof card==='object'&&!Array.isArray(card)&&isCompatibleCard(card))return [{kind:'card',card} as Segment]}catch{};return [{kind:'broken',text:segment.text||''} as Segment]}
    if(segment.kind==='card'&&segment.card.type==='sources'&&options.hasKnowledgeSources)return []
    // Layout is chosen semantically by the Agent, not inferred from Markdown headings.
    return [segment]
  })
}
