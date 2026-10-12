import {UI_COMPONENTS,isUiDocument,validateUiDocument} from './agent-ui'
import {parseCardJson} from './card-json'

export interface PresentationPlan {
 mode:'plain'|'native'|'page'|'adaptive'
 intent:'crisis'|'care'|'map'|'text'|'compare'|'chart'|'collect'|'business'|'overview'|'adaptive'|'procedure'|'checklist'|'timeline'|'clarify'|'faq'
 components:string[]
 reason:string
 contextQuery?:string
}
export interface PresentationContext {previousQuery?:string;clarifyChoices?:{label:string;query:string}[];outputPreference?:'cards'|'adaptive'|'text'}
export function isPresentationFollowup(query:string):boolean {
 return query.trim().length<=80&&!/换(?:个|一)|另外|改(?:成|问)|不是.*而是|聊.*别的|校园卡|一卡通|奖学金|助学|社团|图书馆|食堂|超市|成绩|宿舍|户口|复习计划|学习计划|心理咨询|退学/.test(query)&&/^(?:那|然后|接着|接下来|下一步|继续|再|详细|具体|材料|流程|时间|入口|需要|要带|能|可以|周末|电话|地址|在哪|怎么办|多少钱|多久|如何准备|怎么准备|我选|我是|我在|本科生|研究生|良乡|望京|每天|第[一二三四五六\d]+步|这一步|就这个|还有)/.test(query.trim())
}
export function presentationContextFromHistory(query:string,history:{role:string;content:string}[]):PresentationContext {
 const previous=history.slice();if(previous.at(-1)?.role==='user'&&previous.at(-1)?.content===query)previous.pop()
 const users=previous.filter(m=>m.role==='user').slice(-6)
 const subject=[...users].reverse().find(m=>!isPresentationFollowup(m.content)||m.content.length>=10)||users.at(-1)
 return subject?{previousQuery:subject.content.slice(0,300)}:{}
}
/** Intent narrows choices; the model still maps actual facts and missing conditions to components. */
export function presentationPlan(query:string,context:PresentationContext={}):PresentationPlan {
 const contextQuery=isPresentationFollowup(query)?context.previousQuery:undefined
 const plan=(mode:PresentationPlan['mode'],intent:PresentationPlan['intent'],components:string[],reason:string)=>({mode,intent,components,reason,...(contextQuery?{contextQuery}: {})})
 if(/自杀|自伤|不想活|伤害自己/.test(query))return plan('native','crisis',[],'crisis：优先原生求助卡')
 if(/(?:不要|不用|不需要|不使用)卡片|纯(?:文字|文本)|只(?:用|要)(?:普通)?(?:文字|文本)|一句话|只用[一两三123]句/.test(query))return plan('plain','text',[],'text：用户指定纯文字，尊重本轮呈现要求')
 if(/难过|孤独|焦虑|压力大|陪我/.test(query))return plan('native','care',[],'care：优先原生关怀卡')
 if(context.outputPreference==='text')return plan('plain','text',[],'text：用户选择文字为主，优先清晰段落与列表，专用校园/关怀卡按场景保留')
 if(/在哪|怎么走|位置|地图/.test(query)&&!/办理|补办|挂失|手续|材料|预约/.test(query))return plan('native','map',[],'map/places：优先原生校园导览')
 if(context.clarifyChoices&&context.clarifyChoices.length>1)return plan('page','clarify',['options'],'options：知识向导已有多个真实候选，用可点击选项询问；用户选定后给流程/材料，不重复澄清')
 if(/对比|比较|区别|哪个好|哪个.*(?:更|多|少|适合)|分别.*优缺点/.test(query))return plan('page','compare',['table'],'table：自然比较也使用表格，已知对象按相同维度比较，缺项写未知')
 if(/趋势|图表|柱状|折线|统计/.test(query))return plan('page','chart',['chart'],'chart：仅在真实数值齐全时使用；缺少数据先收集，不能编造')
 if(/步骤|流程|下一步|接下来|一步步|如何.*(?:办|申请)|怎么.*(?:办|申请)|(?:丢|损坏).*(?:办|处理)/.test(query))return plan('page','procedure',['steps','checklist','notice'],'steps：有顺序的流程用步骤组件，材料用 checklist，限制用 notice；不把流程塞进 summary/text')
 if(/材料|准备.*(?:什么|哪些)|(?:要带|带什么)|待办|清单/.test(query))return plan('page','checklist',['checklist'],'checklist：材料/待办用可勾选清单；附原文要求，不虚构必需/可选')
 if(/时间安排|时间线|截止|期限|什么时候|多久|哪天|日程/.test(query))return plan('page','timeline',['timeline','notice'],'timeline：多个真实日期/阶段用时间线，单个时间事实可以直接文字，未知时间不能填造')
 if(/常见问题|问答|FAQ/i.test(query))return plan('page','faq',['faq'],'faq：多个相关问题用折叠问答，保留完整说明')
 if(/帮我安排|定制|制定计划|复习计划|学习计划/.test(query))return plan('page','collect',['form','table'],'form：任务缺少必要条件时交付表单；已提供条件就用表格/信息卡给计划，不重复收集')
 if(/办理|办卡|补办|挂失|解挂|报到|申请|手续|窗口|预约|办事|入口|网站|官网|链接|校园卡.*(?:丢|损坏)/.test(query))return plan('page','business',['info_card','steps','checklist','button'],'info_card：字段用信息卡，顺序流程用 steps，材料用 checklist，入口用 button；可以组合')
 if(/有哪些|概况|介绍|推荐|名单|清单|一览|汇总/.test(query))return plan('adaptive','overview',['info_card','card_group'],'info_card：有多个独立实体/多个字段时用信息卡组；单条事实或概念解释保持文字')
 if(contextQuery){const inherited=presentationPlan(contextQuery);return {...inherited,contextQuery,reason:'延续上一轮事项。'+inherited.reason}}
 return plan('adaptive','adaptive',[],'text：从答案结构选择；单条事实/闲聊/散文用文字，业务字段/多个实体/动作入口用 page')
}
export function presentationHint(query:string,context:PresentationContext={}):string{return presentationPlan(query,context).reason}
const shapes=Object.entries(UI_COMPONENTS).map(([type,v])=>type+'('+v.purpose+')：{type:"'+type+'",id:string,'+v.shape+'}').join('\n')
const examples={
 business:{type:'page',version:'0.1',id:'answer',layout:'stack',fallback:'事项甲需要证件原件。',children:[{type:'info_card',id:'matter',title:'事项甲',badge:'线下窗口',metrics:[{label:'材料',value:'证件原件'}],summary:'证据中的办理步骤与限制。',children:[{type:'button',id:'more',label:'查看准备清单',action:{kind:'ask',message:'事项甲的准备清单是什么？'}}]}]},
 collect:{type:'page',version:'0.1',id:'answer',layout:'stack',fallback:'请提供目标与每天可投入的时间，再制定计划。',children:[{type:'form',id:'conditions',title:'补充计划条件',fields:[{key:'goal',label:'目标',type:'text',required:true},{key:'hours',label:'每天可投入小时',type:'number',required:true}],submitLabel:'按条件制定计划',action:{kind:'ask',message:'按我确认的条件制定计划'}}]},
 compare:{type:'page',version:'0.1',id:'answer',layout:'stack',fallback:'示例中甲为1、乙为2。',children:[{type:'table',id:'comparison',title:'同一维度比较',columns:['方案','给定值'],rows:[['甲',1],['乙',2]]}]},
 procedure:{type:'page',version:'0.1',id:'answer',layout:'stack',fallback:'示例：先核对事项，再按指南提交证件。',children:[{type:'steps',id:'flow',title:'事项办理流程',steps:[{title:'核对事项',desc:'按证据确认办理对象。'},{title:'提交材料',desc:'按原文要求办理。'}]},{type:'checklist',id:'materials',title:'准备材料',items:[{title:'证据中的证件',desc:'保留原件/复印件要求。'}]}]},
 checklist:{type:'page',version:'0.1',id:'answer',layout:'stack',fallback:'示例材料：证件，具体要求以证据为准。',children:[{type:'checklist',id:'materials',title:'准备材料',items:[{title:'证据中的证件',desc:'原件/复印件要求。'}]}]},
 clarify:{type:'page',version:'0.1',id:'answer',layout:'stack',fallback:'请选择具体事项：甲或乙。',children:[{type:'options',id:'choices',title:'你想办理哪项？',options:[{label:'事项甲',value:'请给我事项甲的办理流程'},{label:'事项乙',value:'请给我事项乙的准备材料'}]}]},
} as const
export function presentationPrompt(query:string,sourceIds:ReadonlySet<string>=new Set(),context:PresentationContext={}):string {
 const plan=presentationPlan(query,context),example=plan.intent==='collect'?examples.collect:plan.intent==='procedure'?examples.procedure:plan.intent==='checklist'?examples.checklist:plan.intent==='clarify'?examples.clarify:plan.intent==='compare'||plan.intent==='chart'?examples.compare:examples.business
 if(plan.mode==='plain')return `【本轮输出偏好：文字为主】只用可读 Markdown 段落、列表或表格回答，不输出通用 card/JSON。保留真实事实、完整条件和入口，证据不足说明缺项。专用危机/关怀/地图由场景决定。不要 DSML、工具协议或正文来源编号。${plan.contextQuery?'沿用事项：'+JSON.stringify(plan.contextQuery):''}`
 if(context.outputPreference==='cards'&&plan.mode!=='native')return `【本轮输出偏好：固定卡片】遵循固定模板，优先 familiar 卡片；不要 page/info_card，来源由知识库来源区显示。简单事实/闲聊保持文字。每张用完整的 card JSON 围栏。不能创造事实、入口、日期或工具动作。可用模板：
facts:{type:"facts",title:string,items:[{label:string,value:string}]}
steps:{type:"steps",title:string,steps:[{title:string,desc:string}]}
checklist:{type:"checklist",title:string,items:[{title:string,desc:string}]}
timeline:{type:"timeline",title:string,items:[{date:string,title:string,desc:string}]}
compare:{type:"compare",title:string,columns:[string],rows:[[string]]}
options:{type:"options",title:string,options:[{label:string,desc:string,action:"完整下一轮问题"}],submitText:"确认并继续"}
guide:{type:"guide",title:string,items:[{label:string,desc:string,url:"完整真实HTTPS入口"}]}
notice:{type:"notice",title:string,body:string}
原生 care/crisis/map/places/dinner 仍使用专用卡。流程用 steps，材料用 checklist，澄清用实际 options，不重复追问已提供的条件。读过清单不代表完成办理。不要输出工具调用文本或正文来源编号。当前事项：${JSON.stringify(plan.contextQuery||query)}。${context.clarifyChoices?.length?'真实候选：'+JSON.stringify(context.clarifyChoices):''}`
 return `【统一呈现协议 Agent UI v0.1】本段是最终呈现规则，取代旧会话/旧智能体中的通用 facts/compare/guide/sections 等排版示例。页面实验室的组件就是正式聊天可用组件，不需要用户说“卡片”才能用。
请用用户提问的语言直接交付结果。中文问题用中文回答；工具调用前不要输出 I will / I\'ll 或“我将去查询”之类预告。
本轮策略：${plan.reason}。${plan.mode==='native'?'保留原生专用卡，不能用通用页面替代。':'办理事项、多实体推荐、同维度比较、收集任务条件应主动生成 page 界面；不是把生成后的长文重新包起来。'}
先理解意图与证据，再组织内容：字段→info_card；多事项→card_group；流程→steps；材料→checklist；日期/阶段→timeline；限制→notice；问答→faq；比较→table；真实数值→chart；缺条件→form；已知候选澄清→options；入口→button link。不要把步骤/材料写成 summary 或连续 text。可组合信息、清单、流程和入口，各块内容勿重复。缺条件要主动用选项或表单询问，不只在末尾说“你告诉我”。候选来自上下文，不编造可办事项；用户选定或提供条件后完成任务，不反复询问。读过清单不代表备齐材料或完成办理，未确认进度时给条件步骤或用选项询问。简单事实/闲聊/文章仍用 Markdown。
${plan.contextQuery?'本轮连续追问，上一轮事项：'+JSON.stringify(plan.contextQuery)+'。沿用事项，不因短问句改回闲聊/通用文字。':''}${context.clarifyChoices?.length?'真实澄清候选：'+JSON.stringify(context.clarifyChoices.slice(0,4)):''}
必须用完整的 \`\`\`card JSON 围栏。所有新组件放入一个 page.children，不能把 form/table/info_card 当顶层页面，也不要把字段写成伪代码。根格式：{type:"page",version:"0.1",id:"answer",layout:"stack"或"grid",fallback:"完整简明文字答案，包括事实与操作条件",children:[组件]}。示例仅示范结构，不能照抄示例事实：
${JSON.stringify(example)}
注册表（? 表示可省略字段；实际输出只用合法 JSON）：
${shapes}
每个 page/组件的 sourceRefs 最多8个，不需要罗列所有命中来源，只选直接支撑该组件的依据。每页最多48组件/4层，每组最多16项；流程/清单/时间线/问答24条、选项2–12个、表格8列40行、图表24标签3系列、表单8字段。id 唯一且只用英文字母数字下划线。完成标记由用户操作，不输出 done/checked。不要 HTML/CSS/JS 或额外字段。图表不得编造；图片用证据里的 HTTPS 图像。表单不收密码/令牌，不能直接登录、申请或写库；ask 是点击后下一轮问题，link 逐字复制真实完整 http(s) 地址。
care/crisis/map/places/dinner/effect/poem/agents 等专用原生卡仍按场景使用。来源只在知识库来源区域；不要 sources 卡或可见索引编号。引用事实的 page/组件用 sourceRefs:["本轮来源ID"]，无证据则省略；可选授权ID：${JSON.stringify([...sourceIds].slice(0,16))}（也可使用当前工具检索结果中的ID）。未知/冲突按来源说明。
输出前检查：本轮是否需要业务/比较/条件收集界面？若需要且已有足够信息，不以纯 Markdown 或旧通用卡代替。所有新组件是否包在 page.children？字段/数值/来源/链接是否来自真实上下文？
${plan.mode==='page'?`【本轮交付格式】必须输出一个有效 page，优先组件：${plan.components.join('、')}。${plan.contextQuery?'这是已有事项的连续追问；短句不等于简单事实，保留结构化界面，仅更新用户本轮关注的部分。':''}材料清单不能只给 Markdown 列表，流程不能只给文字编号，澄清不能只在末尾问一句。证据不足时如实显示缺项或用 options/form 收集必要条件，不补造事实。`:'【本轮交付格式】按本轮语义选择，专用原生卡与简单文字要求优先。'}`
}
/** Presentation boundary: does not execute tools or touch Agent Core/session state. */
export function inspectPresentation(answer:string,sourceIds:ReadonlySet<string>,query?:string,context:PresentationContext={}){
 const documents:{id?:string;ok:boolean;nodes:number;errors:string[];normalized?:boolean}[]=[],components=new Set<string>(),refs=new Set<string>(),nativeTypes=new Set<string>()
 for(const match of answer.matchAll(/```(?:card|json)\s*\n([\s\S]*?)\n```/gi)){
  try{const value:any=parseCardJson(match[1]);if(!isUiDocument(value)){if(typeof value?.type==='string')nativeTypes.add(value.type);continue}
   const result=validateUiDocument(value,{sourceIds});documents.push({id:typeof value.id==='string'?value.id:undefined,ok:result.ok,nodes:result.nodes,errors:result.errors,...(value.type!=='page'?{normalized:true}:{})})
   if(result.page){const visit=(node:any)=>{if(node.type!=='page')components.add(node.type);for(const ref of node.sourceRefs||[])refs.add(ref);for(const child of node.children||[])visit(child)};visit(result.page)}
  }catch{if(/"type"\s*:\s*"(?:page|form|table|chart|info_card|card_group|button|image|text|steps|checklist|timeline|notice|faq|options)"/.test(match[1]))documents.push({ok:false,nodes:0,errors:['JSON 未通过语法校验']})}
 }
 const plan=query===undefined?undefined:presentationPlan(query,context)
 return {version:'0.1',outputPreference:context.outputPreference||'adaptive',documents,components:[...components],sourceRefs:[...refs],valid:documents.every(d=>d.ok),...(plan?{plan,rendered:documents.some(d=>d.ok)?'page':nativeTypes.size?'native':'text',selectionWarning:plan.mode==='page'&&context.outputPreference!=='cards'&&!documents.some(d=>d.ok)?'本轮建议结构化呈现，模型未输出有效页面；请结合证据是否充足检查。':undefined}:{})}
}
