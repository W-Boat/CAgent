/** Applies to student, admin and trial chat, including conversations with older card prompts. */
export const ANSWER_CARD_PROTOCOL=`【原生专用卡】以下用途保留，通用业务排版以服务器 Agent UI page 协议为准。
普通压力/难过先陪伴，用 care：{"type":"care","title":"我在这里","body":"回应具体处境","actions":[{"label":"继续聊","action":"我想继续说说"}]}；自伤/自杀/立即危险优先 crisis：{"type":"crisis","body":"陪伴与求助"}，不得被通用页面或关怀卡替代，热线由前端固定。
校园导览保留 map/places，选餐保留 dinner，彩蛋保留 effect；只有明确诗文请求使用 poem，实际切换使用真实 ID 的 agents。所有 JSON 放 card 围栏；来源由知识库来源区展示，不输出 sources 卡或可见索引编号。`


/** A completed supportive reply still gets its interaction when the model omits the card. */
export function supportCardFallback(query:string,answer:string,urgent:boolean):string{
  const ordinary=query.length<=400&&/(?:我|自己)/.test(query)&&/(?:压力(?:很|太|好)?大|很焦虑|很难过|心情不好|很孤独|撑不住)/.test(query)&&/(?:聊聊|陪|倾诉|想说|怎么办|难受)/.test(query)
  if(!urgent&&!ordinary)return ''
  const type=urgent?'crisis':'care',cards=[...answer.matchAll(/```(?:card|json)\s*\n([\s\S]*?)\n```/gi)].map(m=>m[1])
  cards.push(...[...answer.matchAll(/<card\s+type=["'][a-z_-]+["']\s*>\s*([\s\S]*?)\s*<\/card>/gi)].map(m=>m[1]))
  if(cards.some(raw=>{try{const value=JSON.parse(raw);return (value.type===type||!urgent&&value.type==='crisis')&&typeof value.body==='string'}catch{return false}}))return ''
  const card=urgent?{type:'crisis',body:'先让自己处在安全的地方，联系一位你信任的人到身边陪你。如果你担心会立即伤害自己，请联系当地急救服务。你可以继续告诉我现在的情况。'}:{type:'care',title:'我在这里',body:'如果你愿意，可以继续说说最让你难受的部分，我们慢慢聊。',actions:[{label:'继续聊聊',action:'我想继续说说现在的压力'}]}
  return '\n\n```card\n'+JSON.stringify(card)+'\n```'
}
