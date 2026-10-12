import {estimateTokens,type ChatMessage,type LlmToolDef} from '../llm/types'

export function messageTokens(message:ChatMessage):number {
  return estimateTokens(message.content)+estimateTokens(JSON.stringify(message.toolCalls||[]))+12+(message.images?.length||0)*1536
}
/** User turns are atomic: an assistant call and its results are never pruned separately. */
export function contextTurns(messages:ChatMessage[]):ChatMessage[][] {
  const turns:ChatMessage[][]=[]
  for(const message of messages){
    if(message.role==='system')continue
    if(message.role==='user')turns.push([message])
    else if(turns.length)turns[turns.length-1].push(message)
  }
  return turns
}
export interface ContextBudget {inputTokens:number;inputLimit:number;removedTurns:number;truncatedResults:number}
export function fitContext(input:ChatMessage[],tools:LlmToolDef[],contextWindow:number,maxOutputTokens:number):{messages:ChatMessage[];budget:ContextBudget} {
  const messages=input.map(m=>({...m,toolCalls:m.toolCalls?.map(c=>({...c})),images:m.images?.slice()}))
  const system=messages.filter(m=>m.role==='system'),turns=contextTurns(messages)
  const schemaCost=tools.length?estimateTokens(JSON.stringify(tools))+32:0
  const inputLimit=Math.floor((contextWindow-maxOutputTokens)*0.85)-schemaCost-128
  let removedTurns=0,truncatedResults=0
  const cost=()=>[...system,...turns.flat()].reduce((n,m)=>n+messageTokens(m),0)
  while(cost()>inputLimit&&turns.length>1){turns.shift();removedTurns++}
  while(cost()>inputLimit){
    const tool=turns.flat().filter(m=>m.role==='tool'&&m.content.length>400).sort((a,b)=>b.content.length-a.content.length)[0]
    if(!tool)throw new Error('当前问题、提示词和工具定义超出模型容量，请缩短输入或选择更大上下文的模型。')
    const keep=Math.max(160,Math.floor(tool.content.length*0.55))
    tool.content=tool.content.slice(0,keep)+'\n[工具结果已按上下文预算裁剪，缺失信息请缩小查询范围后补查]'
    truncatedResults++
  }
  return {messages:[...system,...turns.flat()],budget:{inputTokens:cost()+schemaCost,inputLimit:inputLimit+schemaCost,removedTurns,truncatedResults}}
}
