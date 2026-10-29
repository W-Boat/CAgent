import {isUiDocument,validateUiDocument,safeUiUrl,uiContentText} from './agent-ui'
import {parseCardJson} from './card-json'
export type AnswerPreference='adaptive'|'text'|'cards'
const natives=new Set(['care','comfort','crisis','map','places','dinner','takeout','effect','poem','agents','skills'])
const fence=(value:unknown)=>'```card\n'+JSON.stringify(value)+'\n```\n'
const cell=(v:unknown)=>String(v??'').replace(/\|/g,'\\|').replace(/\r?\n/g,'<br>')
const table=(columns:unknown[],rows:unknown[][])=>[columns.map(cell).join(' | '),columns.map(()=> '---').join(' | '),...rows.map(row=>row.map(cell).join(' | '))].map(row=>'| '+row+' |').join('\n')
function markdown(node:any):string {
 const heading=node.title?'### '+node.title+'\n\n':'',note=node.note||node.intro||'',children=()=> (node.children||[]).map(markdown).filter(Boolean).join('\n\n')
 switch(node.type){
  case 'page':return children()||node.fallback||''
  case 'text':return (node.role==='heading'?'### ':'')+node.content
  case 'card_group':return children()
  case 'image':return node.alt+(node.caption?' · '+node.caption:'')+(safeUiUrl(node.url,true)?'\n[查看图片]('+node.url+')':'')
  case 'info_card':return heading+[node.badge,node.summary,...(node.metrics||[]).map((m:any)=>'- '+m.label+'：'+m.value),children()].filter(Boolean).join('\n\n')
  case 'service_card':return heading+[node.mode==='online'?'线上办理':'线下窗口',node.summary,node.location?'地点：'+node.location:'',node.contact?'联系：'+node.contact:'',node.action?(node.action.kind==='link'?'['+node.actionLabel+']('+node.action.url+')':node.actionLabel+'：'+node.action.message):''].filter(Boolean).join('\n\n')
  case 'key_values':return heading+(node.items||[]).map((item:any)=>'- '+item.label+'：'+item.value).join('\n')+(node.note?'\n\n'+node.note:'')
  case 'facts':return heading+(node.items||[]).map((i:any)=>'- '+String(i.label||i.title||'')+'：'+String(i.value??i.desc??'')).join('\n')
  case 'table':case 'compare':return heading+table(node.columns,node.rows)
  case 'chart':return heading+table(['项目',...node.series.map((s:any)=>s.name+(node.unit?'（'+node.unit+'）':''))],node.labels.map((label:string,i:number)=>[label,...node.series.map((s:any)=>s.values[i])]))
  case 'steps':return heading+[note,...(node.steps||[]).map((s:any,i:number)=>(i+1)+'. '+s.title+(s.desc?'：'+s.desc:''))].filter(Boolean).join('\n')
  case 'checklist':case 'timeline':return heading+[note,...(node.items||[]).map((s:any)=>'- '+(s.date?s.date+' · ':'')+s.title+(s.required===false?'（可选）':'')+(s.desc?'：'+s.desc:''))].filter(Boolean).join('\n')
  case 'faq':return heading+(node.items||[]).map((s:any)=>'**'+s.question+'**\n\n'+s.answer).join('\n\n')
  case 'notice':return heading+node.body
  case 'button':return node.action?.kind==='link'?'['+node.label+']('+node.action.url+')':node.label+'：'+node.action.message
  case 'options':return heading+[note,...node.options.map((o:any)=>'- '+o.label+(o.desc?'：'+o.desc:'')+(o.value&&o.value!==o.label?'\n  '+o.value:''))].filter(Boolean).join('\n')
  case 'form':return heading+node.fields.map((f:any)=>'- '+f.label+(f.required?'（必填）':'')+(f.options?'：'+f.options.join(' / '):'')).join('\n')+'\n\n'+node.action.message
  default:return ''
 }
}
function fixed(node:any):string {
 switch(node.type){
  case 'page':case 'card_group':return node.children.map(fixed).join('\n')
  case 'text':case 'image':return markdown(node)+'\n'
  case 'info_card':return fence({type:'facts',title:node.title,intro:[node.badge,node.summary].filter(Boolean).join(' · '),items:(node.metrics||[]).map((m:any)=>({label:m.label,value:m.value}))})+(node.children||[]).map(fixed).join('\n')
  case 'service_card':return fence({type:'facts',title:node.title,intro:[node.mode==='online'?'线上办理':'线下窗口',node.summary].filter(Boolean).join(' · '),items:[...(node.location?[{label:'地点',value:node.location}]:[]),...(node.contact?[{label:'联系',value:node.contact}]:[])]})+(node.action?fixed({type:'button',label:node.actionLabel,action:node.action}):'')
  case 'key_values':return fence({type:'facts',title:node.title,intro:node.note,items:node.items})
  case 'table':return fence({type:'compare',title:node.title,columns:node.columns,rows:node.rows})
  case 'chart':return fence({type:'compare',title:node.title,columns:['项目',...node.series.map((s:any)=>s.name+(node.unit?'（'+node.unit+'）':''))],rows:node.labels.map((l:string,i:number)=>[l,...node.series.map((s:any)=>s.values[i])])})
  case 'steps':return fence({type:'steps',title:node.title,note:node.note,steps:node.steps})
  case 'checklist':case 'timeline':case 'faq':return fence({type:node.type,title:node.title,note:node.note,items:node.items})
  case 'notice':return fence({type:'notice',title:node.title,body:node.body})
  case 'button':return fence({type:'guide',items:[{label:node.label,...(node.action.kind==='link'?{url:node.action.url}:{action:node.action.message})}]})
  case 'options':return fence({type:'options',title:node.title,intro:node.intro,multiple:node.multiple,submitText:node.submitLabel,options:node.options.map((o:any)=>({label:o.label,desc:o.desc,action:o.value}))})
  // Forms have no legacy equivalent; retain the validated interactive component.
  default:return fence(node)
 }
}
/** Finite structured data -> presentation; never fetch, execute or ask another model. */
export function formatCardBlock(raw:string,language:string,preference:AnswerPreference,sourceIds:ReadonlySet<string>,original:string):string {
 let value:any;try{value=parseCardJson(raw)}catch{
  if(language!=='card'&&!/"type"\s*:\s*"(?:page|info_card|service_card|key_values|steps|form|table)/.test(raw))return original
  // Recover only complete JSON string fields; never execute or invent missing structure.
  const recovered:string[]=[];for(const match of raw.slice(0,128*1024).matchAll(/"(fallback|title|content|summary|body|desc|answer|label|value)"\s*:\s*("(?:\\.|[^"\\])*")/g))try{const text=JSON.parse(match[2]);if(typeof text==='string'&&text.trim()&&!recovered.includes(text))recovered.push(text)}catch{}
  return recovered.length?recovered.join('\n\n')+'\n':'这部分回答未完整生成，请重新生成以补全内容。\n'
 }
 if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.type!=='string')return original
 if(natives.has(value.type))return original
 if(isUiDocument(value)){
  // Discard invalid provenance metadata; never invent, alias or authorize a source ID.
  // Original validation errors remain in server diagnostics. Content can still render.
  let nodes=0
  const references=(node:any,depth:number):any=>{
   if(!node||typeof node!=='object'||Array.isArray(node)||depth>4||++nodes>49)return node
   const copy={...node},refs=node.sourceRefs
   if(refs!==undefined){const unique=Array.isArray(refs)&&refs.length<=256?[...new Set(refs.filter((id:any)=>typeof id==='string'&&id.length<=160&&sourceIds.has(id)))]:[];if(unique.length)copy.sourceRefs=unique.slice(0,8);else delete copy.sourceRefs}
   if(Array.isArray(node.children))copy.children=node.children.slice(0,17).map((child:any)=>references(child,depth+1))
   return copy
  }
  const validated=validateUiDocument(references(value,0),{sourceIds});if(!validated.page)return (typeof value.fallback==='string'&&value.fallback.trim()&&value.fallback.length<=4000?value.fallback:uiContentText(value)||'这部分回答未完整生成，请重新生成以补全内容。')+'\n'
  if(preference==='text')return markdown({...validated.page,fallback:typeof value.fallback==='string'?value.fallback:''})+'\n'
  if(preference==='cards')return fixed(validated.page)
  return '\n'+fence(validated.page)
 }
 // Legacy data remains data; only known, well-shaped templates are flattened.
 if(preference==='text'&&['facts','compare','steps','checklist','timeline','notice','faq','options'].includes(value.type)){
  try{return markdown(value)+'\n'}catch{return original}
 }
 return language==='card'?fence(value):original
}
/** Buffer only a structured fence. Plain prose continues streaming immediately. */
export class AnswerPresentationStream {
 private pending='';private start=true;private literal='';private block:{mark:string;language:string;opening:string;body:string}|null=null
 constructor(private preference:AnswerPreference,private sources:()=>ReadonlySet<string>=()=>new Set()){}
 push(part:string):string {
  this.pending+=part;let visible='',end:number
  while((end=this.pending.indexOf('\n'))>=0){const line=this.pending.slice(0,end+1);this.pending=this.pending.slice(end+1);visible+=this.line(line)}
  if(!this.block&&this.pending&&(!this.start||!/^\s*[`~]/.test(this.pending))){const candidate=/(?:`{1,3}|~{1,3})(?:card|json)?$/i.exec(this.pending)||/(?:```|~~~)(?:c(?:a(?:r)?)?|j(?:s(?:o)?)?)$/i.exec(this.pending);const at=candidate?candidate.index:this.pending.length;visible+=this.pending.slice(0,at);this.pending=this.pending.slice(at);if(at)this.start=false}
  return visible
 }
 private line(line:string):string {
  if(!this.literal&&!this.block){const inline=/(?:^|[^`])(```(?:card|json)\s*\n)$/i.exec(line);if(inline&&inline.index>=0&&line.indexOf(inline[1])>0){const at=line.indexOf(inline[1]);const prefix=line.slice(0,at);this.start=true;return prefix+'\n\n'+this.line(line.slice(at))}}

  if(this.block){if(new RegExp('^\\s*'+this.block.mark[0]+'{'+this.block.mark.length+',}\\s*$').test(line.trim())){const b=this.block;this.block=null;this.start=true;return formatCardBlock(b.body,b.language,this.preference,this.sources(),b.opening+b.body+line)}this.block.body+=line;return ''}
  const wasStart=this.start;this.start=true
  const match=/^\s*(`{3,}|~{3,})([^\r\n]*)[\r\n]*$/.exec(line)
  if(this.literal){if(match&&match[1][0]===this.literal[0]&&match[1].length>=this.literal.length&&!match[2].trim())this.literal='';return line}
  if(match){const language=match[2].trim().toLowerCase();if(language==='card'||language==='json'){this.block={mark:match[1],language,opening:line,body:''};return wasStart?'':'\n\n'}this.literal=match[1]}
  return line
 }
 finish():string {
  let result='';if(this.pending){result=this.line(this.pending);this.pending=''}
  if(this.block){const b=this.block;this.block=null;result+=formatCardBlock(b.body,b.language,this.preference,this.sources(),b.opening+b.body)}
  return result
 }
}
export function formatAnswerPresentation(answer:string,preference:AnswerPreference,sourceIds:ReadonlySet<string>=new Set()):string {
 const stream=new AnswerPresentationStream(preference,()=>sourceIds);return stream.push(answer)+stream.finish()
}
