import {UI_COMPONENTS,isUiDocument,validateUiDocument} from './agent-ui'
import {parseCardJson} from './card-json'
import { matchingRecipe, type PresentationPolicy } from './presentation-policy'

export interface PresentationPlan {
 mode:'plain'|'native'|'page'|'adaptive'
 intent:'crisis'|'care'|'map'|'text'|'compare'|'chart'|'collect'|'business'|'overview'|'adaptive'|'procedure'|'checklist'|'timeline'|'clarify'|'faq'
 components:string[]
 reason:string
 contextQuery?:string
}
export interface PresentationContext {previousQuery?:string;clarifyChoices?:{label:string;query:string}[];outputPreference?:'cards'|'adaptive'|'text';policy?:PresentationPolicy}
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
 if(/办理|办卡|补办|挂失|解挂|报到|申请|手续|窗口|预约|办事|入口|网站|官网|链接|联系方式|办公时间|开放时间|服务时间|咨询电话|联系电话|校园卡.*(?:丢|损坏)/.test(query))return plan('page','business',['service_card','key_values','steps','checklist','button'],'service_card：线上入口与线下窗口明确区分；同一事项字段用 key_values，流程 steps，材料 checklist；可以组合')
 if(/有哪些|概况|介绍|推荐|名单|清单|一览|汇总/.test(query))return plan('adaptive','overview',['info_card','service_card','key_values','card_group'],'info_card：多个实体用卡片组，服务渠道用 service_card，同一事项字段用 key_values；单条事实保持文字')
 if(contextQuery){const inherited=presentationPlan(contextQuery);return {...inherited,contextQuery,reason:'延续上一轮事项。'+inherited.reason}}
 return plan('adaptive','adaptive',[],'text：从答案结构选择；单条事实/闲聊/散文用文字，业务字段/多个实体/动作入口用 page')
}
export function presentationHint(query:string,context:PresentationContext={}):string{return presentationPlan(query,context).reason}
export function presentationPrompt(query:string,sourceIds:ReadonlySet<string>=new Set(),context:PresentationContext={}):string {
 const plan = presentationPlan(query,context)
 if(plan.mode==='plain') return '用简明 Markdown 回答，保持事实、办理条件和真实入口。不要输出通用卡片、工具协议或来源索引。'
 if(plan.mode==='native') return '本轮使用对应原生专用卡，简单解释仍用文字；不套通用页面。'
 const followup = plan.contextQuery ? '；沿用上一事项 ' + JSON.stringify(plan.contextQuery) : ''
 const choices = context.clarifyChoices?.length ? '；真实候选 ' + JSON.stringify(context.clarifyChoices.slice(0,4)) : ''
 if(context.outputPreference==='cards') return '固定卡片用 card JSON 围栏：facts(title,items:[{label,value}])、steps(title,steps:[{title,desc}])、checklist(title,items:[{title,desc}])、timeline(title,items:[{date,title,desc}])、compare(title,columns,rows)、options(title,options:[{label,action}])、notice(title,body)。含 type。简单问题用文字。入口、日期及流程取自证据' + followup + choices
 const recipe = plan.intent==='clarify' ? undefined : matchingRecipe(query + ' ' + (plan.contextQuery || ''), context.policy?.recipes)
 const types = [...new Set([...(recipe?.components || []), ...plan.components, ...(plan.mode==='adaptive' ? ['info_card','key_values','steps','table','service_card'] : []), 'text','notice','button'])]
 const fields = Object.entries(UI_COMPONENTS).filter(([type])=>types.includes(type)).map(([type, spec])=>type+' '+spec.shape).join('\n')
 return [
   '先直接回答要点。遇到步骤、清单、比较、多个实体或待用户选择的问题，用新式卡片；简单事实直接用文字。',
   plan.reason + followup + choices,
   '一个 card JSON 围栏：{"type":"page","layout":"stack","children":[{"type":"步骤或其他组件",...}]}。每个组件含 type；id、version、fallback 由服务器补齐，可省略。',
   fields,
   '最多 '+(context.policy?.maxCards??5)+' 个内容组件，不重复正文和卡片里的事实。' + (recipe ? '本轮模板优先 '+recipe.components.join('、')+'，layout='+recipe.layout+'。' : ''),
   '只能用已知事实、候选和真实入口；来源编号由来源区显示。sourceRefs 可省略，需要时使用真实 ID：'+JSON.stringify([...sourceIds].slice(0,8))+ '。只给完整 JSON，不输出 HTML、思考预告或工具语法。',
 ].join('\n')
}
/** Presentation boundary: does not execute tools or touch Agent Core/session state. */
export function inspectPresentation(answer:string,sourceIds:ReadonlySet<string>,query?:string,context:PresentationContext={}){
 const documents:{id?:string;ok:boolean;nodes:number;errors:string[];normalized?:boolean}[]=[],components=new Set<string>(),refs=new Set<string>(),nativeTypes=new Set<string>()
 for(const match of answer.matchAll(/```(?:card|json)\s*\n([\s\S]*?)\n```/gi)){
  try{const value:any=parseCardJson(match[1]);if(!isUiDocument(value)){if(typeof value?.type==='string')nativeTypes.add(value.type);continue}
   const result=validateUiDocument(value,{sourceIds});documents.push({id:typeof value.id==='string'?value.id:undefined,ok:result.ok,nodes:result.nodes,errors:result.errors,...(value.type!=='page'?{normalized:true}:{})})
   if(result.page){const visit=(node:any)=>{if(node.type!=='page')components.add(node.type);for(const ref of node.sourceRefs||[])refs.add(ref);for(const child of node.children||[])visit(child)};visit(result.page)}
  }catch{if(/"type"\s*:\s*"(?:page|form|table|chart|info_card|service_card|key_values|card_group|button|image|text|steps|checklist|timeline|notice|faq|options)"/.test(match[1]))documents.push({ok:false,nodes:0,errors:['JSON 未通过语法校验']})}
 }
 const plan=query===undefined?undefined:presentationPlan(query,context)
 return {version:'0.1',outputPreference:context.outputPreference||'adaptive',documents,components:[...components],sourceRefs:[...refs],valid:documents.every(d=>d.ok),...(plan?{plan,rendered:documents.some(d=>d.ok)?'page':nativeTypes.size?'native':'text',selectionWarning:plan.mode==='page'&&context.outputPreference!=='cards'&&!documents.some(d=>d.ok)?'本轮建议结构化呈现，模型未输出有效页面；请结合证据是否充足检查。':undefined}:{})}
}
