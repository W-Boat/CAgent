import {answerSegments} from './answer-layout'
import {CardBlockCache,type Segment} from './card-segments'
import {formatAnswerPresentation} from './answer-presentation'

/** Scoped to one mounted message: never retain private answers in a global cache. */
export function createAnswerProjector(){
 const blocks=new CardBlockCache(),stats={normalizations:0,blocks},previous:Segment[]=[]
 let normalized=new WeakMap<object,Segment[]>(),signature=''
 return {stats,project(content:string,streaming:boolean,sourceIds:ReadonlySet<string>,hasKnowledgeSources?:boolean):Segment[]{
  const nextSignature=JSON.stringify([...sourceIds].sort())
  if(nextSignature!==signature){signature=nextSignature;normalized=new WeakMap()}
  const options={streaming,hasKnowledgeSources,cache:blocks}
  let parsed=answerSegments(content,options)
  // Recover historical inline/unfinished fences only when the answer has ended.
  if(!streaming&&(parsed.some(s=>s.kind==='broken'||s.kind==='pending')||!parsed.some(s=>s.kind==='card')&&/```(?:card|json)/i.test(content)))parsed=answerSegments(formatAnswerPresentation(content,'adaptive',sourceIds),options)
  const projected=parsed.flatMap(segment=>{
   if(segment.kind!=='card')return [segment]
   let ready=normalized.get(segment.card)
   if(!ready){stats.normalizations++;ready=answerSegments(formatAnswerPresentation('```card\n'+JSON.stringify(segment.card)+'\n```','adaptive',sourceIds),{streaming:false,hasKnowledgeSources});normalized.set(segment.card,ready)}
   return hasKnowledgeSources?ready.filter(s=>s.kind!=='card'||s.card.type!=='sources'):ready
  })
  const merged:Segment[]=[]
  for(const segment of projected){const last=merged.at(-1);if(last?.kind==='markdown'&&segment.kind==='markdown')merged[merged.length-1]={kind:'markdown',text:last.text.replace(/\n*$/,'')+'\n\n'+segment.text.replace(/^\n*/,'')};else merged.push(segment)}
  const result=merged.map((segment,i)=>{const old=previous[i];return old?.kind==='markdown'&&segment.kind==='markdown'&&old.text===segment.text?old:segment})
  previous.splice(0,previous.length,...result);return result
 }}
}
