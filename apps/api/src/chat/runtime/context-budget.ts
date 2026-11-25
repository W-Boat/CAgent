import {estimateTokens,type ChatMessage,type LlmToolDef} from '../llm/types'

const compactHeading = '【早期对话摘录，仅用于延续上下文】'
const excerpt = (value: string, limit: number) => {
  const text = value.replace(/\s+/g, ' ').trim()
  if (text.length <= limit) return text
  return text.slice(0, Math.floor(limit * 0.72)) + ' … ' + text.slice(-Math.floor(limit * 0.25))
}

export function compactHistory(turns: ChatMessage[][], tokenLimit: number): ChatMessage | undefined {
  if (!turns.length || tokenLimit < 90) return
  const lines: string[] = []
  let used = messageTokens({role:'user',content:compactHeading})
  for (const turn of turns.slice(-20).reverse()) {
    const available = tokenLimit - used - 4
    if (available < 42) break
    const each = Math.max(17, Math.min(150, Math.floor(available * 0.56)))
    const user = turn[0]?.content || ''
    const answer = [...turn].reverse().find(msg => msg.role === 'assistant' && !msg.toolCalls?.length)?.content || ''
    const line = user.startsWith(compactHeading)
      ? excerpt(user.slice(compactHeading.length), each)
      : [user && '用户：' + excerpt(user, each), answer && '助手曾答：' + excerpt(answer, each)].filter(Boolean).join('｜')
    const tokens = estimateTokens(line) + 2
    if (line && used + tokens <= tokenLimit) { lines.unshift(line); used += tokens }
  }
  if (lines.length) return {role:'user',content:compactHeading+'\n'+lines.join('\n')}
}

export function messageTokens(message:ChatMessage):number {
  return estimateTokens(message.content)+estimateTokens(message.reasoning||'')+estimateTokens(JSON.stringify(message.toolCalls||[]))+12+(message.images?.length||0)*1536
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
export interface ContextBudget {inputTokens:number;inputLimit:number;removedTurns:number;truncatedResults:number;compactedTurns?:number}
export function fitContext(input:ChatMessage[],tools:LlmToolDef[],contextWindow:number,maxOutputTokens:number, headroom=0.85):{messages:ChatMessage[];budget:ContextBudget} {
  const messages=input.map(m=>({...m,toolCalls:m.toolCalls?.map(c=>({...c})),images:m.images?.slice()}))
  const system=messages.filter(m=>m.role==='system'),turns=contextTurns(messages)
  const schemaCost=tools.length?estimateTokens(JSON.stringify(tools))+32:0
  const inputLimit=Math.floor((contextWindow-maxOutputTokens)*headroom)-schemaCost-128
  let removedTurns=0,truncatedResults=0
  const dropped: ChatMessage[][] = []
  const cost=()=>[...system,...turns.flat()].reduce((n,m)=>n+messageTokens(m),0)
  let costNow = cost()
  const reserve = costNow > inputLimit && turns.length > 1 ? Math.min(900, Math.floor(inputLimit * 0.12)) : 0
  while(costNow>inputLimit-reserve&&turns.length>1){
    const removed = turns.shift()!
    costNow -= removed.reduce((sum, msg) => sum + messageTokens(msg), 0)
    dropped.push(removed)
    removedTurns++
  }
  while(cost()>inputLimit){
    const tool=turns.flat().filter(m=>m.role==='tool'&&m.content.length>400).sort((a,b)=>b.content.length-a.content.length)[0]
    if(!tool)throw new Error('当前问题、提示词和工具定义超出模型容量，请缩短输入或选择更大上下文的模型。')
    const keep=Math.max(160,Math.floor(tool.content.length*0.55))
    tool.content=tool.content.slice(0,keep)+'\n[工具结果已按上下文预算裁剪，缺失信息请缩小查询范围后补查]'
    truncatedResults++
  }
  const compact = compactHistory(dropped, Math.min(reserve, inputLimit - cost()))
  // Keep one valid user turn at the start. No synthetic call or replay of a tool ledger.
  if (compact && turns[0]?.[0]) turns[0][0].content = compact.content + '\n\n【随后用户提问】\n' + turns[0][0].content
  return {messages:[...system,...turns.flat()],budget:{inputTokens:cost()+schemaCost,inputLimit:inputLimit+schemaCost,removedTurns,truncatedResults,...(compact ? {compactedTurns:dropped.length} : {})}}
}
