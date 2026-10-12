/** Agent UI v0.1. Authoritative contract; run presentation/sync.mjs after editing. */
export const UI_VERSION = '0.1' as const
export type UiAction = {kind:'ask';message:string} | {kind:'link';url:string}
export interface UiBase {id:string;sourceRefs?:string[]}
export interface UiText extends UiBase {type:'text';role?:'heading'|'paragraph'|'caption';content:string}
export interface UiImage extends UiBase {type:'image';url:string;alt:string;caption?:string}
export interface UiInfo extends UiBase {type:'info_card';title:string;summary?:string;badge?:string;metrics?:{label:string;value:string}[];children?:UiNode[]}
export interface UiGroup extends UiBase {type:'card_group';layout:'stack'|'grid';children:UiNode[]}
export interface UiTable extends UiBase {type:'table';title:string;columns:string[];rows:(string|number)[][]}
export interface UiChart extends UiBase {type:'chart';title:string;chartType:'bar'|'line';labels:string[];series:{name:string;values:number[]}[];unit?:string}
export interface UiButton extends UiBase {type:'button';label:string;action:UiAction}
export interface UiField {key:string;label:string;type:'text'|'number'|'select';required?:boolean;options?:string[]}
export interface UiForm extends UiBase {type:'form';title:string;fields:UiField[];submitLabel?:string;action:{kind:'ask';message:string}}
export interface UiSteps extends UiBase {type:'steps';title:string;note?:string;steps:{title:string;desc?:string}[]}
export interface UiChecklist extends UiBase {type:'checklist';title:string;note?:string;items:{title:string;desc?:string;required?:boolean}[]}
export interface UiTimeline extends UiBase {type:'timeline';title:string;note?:string;items:{date:string;title:string;desc?:string}[]}
export interface UiNotice extends UiBase {type:'notice';title:string;body:string;tone?:'info'|'warning'|'success'}
export interface UiFaq extends UiBase {type:'faq';title:string;items:{question:string;answer:string}[]}
export interface UiOptions extends UiBase {type:'options';title:string;intro?:string;multiple?:boolean;submitLabel?:string;options:{label:string;value:string;desc?:string}[]}
export type UiNode = UiText|UiImage|UiInfo|UiGroup|UiTable|UiChart|UiButton|UiForm|UiSteps|UiChecklist|UiTimeline|UiNotice|UiFaq|UiOptions
export interface UiPage extends UiBase {type:'page';version:typeof UI_VERSION;layout:'stack'|'grid';children:UiNode[];fallback:string}

/** This registry is shared by prompt generation, validation and the Playground. */
export const UI_COMPONENTS = {
 text:{name:'文字',purpose:'简答、解释和结论',fields:['role','content'],required:['content'],shape:'content:string, role?:heading|paragraph|caption'},
 image:{name:'图片',purpose:'有真实图片地址的资料',fields:['url','alt','caption'],required:['url','alt'],shape:'url:https地址, alt:string, caption?:string'},
 info_card:{name:'信息卡',purpose:'一个实体、方案或业务事项',fields:['title','summary','badge','metrics','children'],required:['title'],shape:'title:string, summary?:string, badge?:string, metrics?:[{label:string,value:string}], children?:组件[]'},
 card_group:{name:'卡片组',purpose:'并列选择或分组说明',fields:['layout','children'],required:['layout','children'],shape:'layout:stack|grid, children:组件[]'},
 table:{name:'表格',purpose:'同一维度的多对象对比',fields:['title','columns','rows'],required:['title','columns','rows'],shape:'title:string, columns:string[], rows:(string|number)[][]，每行等长'},
 chart:{name:'图表',purpose:'证据完整的数值趋势或数量对比',fields:['title','chartType','labels','series','unit'],required:['title','chartType','labels','series'],shape:'title:string, chartType:bar|line, labels:string[], series:[{name:string,values:number[]}], unit?:string；数值与labels等长'},
 button:{name:'操作按钮',purpose:'用户明确点击后追问或打开真实入口',fields:['label','action'],required:['label','action'],shape:'label:string, action:{kind:ask,message:string}|{kind:link,url:http(s)地址}'},
 form:{name:'表单',purpose:'收集完成任务所缺的少量条件',fields:['title','fields','submitLabel','action'],required:['title','fields','action'],shape:'title:string, fields:[{key:string,label:string,type:text|number|select,required?:boolean,options?:string[]}], submitLabel?:string, action:{kind:ask,message:string}'},
 steps:{name:'流程步骤',purpose:'有顺序的操作与办理流程，可逐步标记',fields:['title','note','steps'],required:['title','steps'],shape:'title:string, note?:string, steps:[{title:string,desc?:string}]；只写证据中的步骤，不预设完成状态'},
 checklist:{name:'准备清单',purpose:'材料/待办逐项勾选和准备进度',fields:['title','note','items'],required:['title','items'],shape:'title:string, note?:string, items:[{title:string,desc?:string,required?:boolean}]；required仅在证据明确时设置'},
 timeline:{name:'时间安排',purpose:'真实日期/期限/相对阶段与事件的时间线',fields:['title','note','items'],required:['title','items'],shape:'title:string, note?:string, items:[{date:string,title:string,desc?:string}]；不编造日期或时限'},
 notice:{name:'注意提醒',purpose:'关键条件、例外、风险或特别提醒',fields:['title','body','tone'],required:['title','body'],shape:'title:string, body:string, tone?:info|warning|success'},
 faq:{name:'折叠问答',purpose:'多个相关问题按需展开，保留完整回答',fields:['title','items'],required:['title','items'],shape:'title:string, items:[{question:string,answer:string}]'},
 options:{name:'澄清选项',purpose:'已知候选中选择具体事项/校区/方向，确认后追问',fields:['title','intro','multiple','submitLabel','options'],required:['title','options'],shape:'title:string, intro?:string, multiple?:boolean, submitLabel?:string, options:[{label:string,value:string,desc?:string}]；value是选择后交给Agent的完整问题'},
} as const

export function safeUiUrl(value:unknown,image=false):boolean {
 if(typeof value!=='string'||value.length>2048||/[\s\\\u0000-\u001f]/.test(value))return false
 try{const u=new URL(value);return (image?u.protocol==='https:':['https:','http:'].includes(u.protocol))&&!!u.hostname&&!u.username&&!u.password}catch{return false}
}
type Obj=Record<string,unknown>
const object=(v:unknown):v is Obj=>!!v&&typeof v==='object'&&!Array.isArray(v)
const short=(v:unknown,max=160):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=max
const list=(v:unknown,min:number,max:number):v is unknown[]=>Array.isArray(v)&&v.length>=min&&v.length<=max
export interface UiValidation {ok:boolean;page?:UiPage;errors:string[];nodes:number}
/** No coercion, repair, dynamic code, remote fetching or implicit action execution. */
export function validateUiPage(value:unknown,options:{sourceIds?:ReadonlySet<string>}={}):UiValidation {
 const errors:string[]=[],ids=new Set<string>();let nodes=0,characters=0
 const fail=(path:string,msg:string)=>{if(errors.length<16)errors.push(path+'：'+msg)}
 const fields=(v:Obj,allowed:readonly string[],required:readonly string[],p:string)=>{
  for(const key of Object.keys(v))if(!allowed.includes(key))fail(p,'不支持字段 '+key)
  for(const key of required)if(v[key]===undefined)fail(p,'缺少 '+key)
 }
 const text=(v:unknown,p:string,max=160)=>{if(!short(v,max))fail(p,'需要非空文本（最多 '+max+' 字）');if(typeof v==='string')characters+=v.length}
 const action=(v:unknown,p:string,form=false)=>{
  if(!object(v)){fail(p,'需要操作对象');return}
  if(v.kind==='ask'){fields(v,['kind','message'],['kind','message'],p);text(v.message,p+'.message',1000)}
  else if(v.kind==='link'&&!form){fields(v,['kind','url'],['kind','url'],p);if(!safeUiUrl(v.url))fail(p,'需要完整 http(s) 地址')}
  else fail(p,'操作仅允许 ask'+(form?'':' 或 link'))
 }
 const base=(v:Obj,p:string)=>{
  if(!short(v.id,80)||!/^[a-zA-Z0-9_-]+$/.test(v.id as string))fail(p+'.id','需要稳定的字母、数字或下划线 ID')
  else if(ids.has(v.id))fail(p+'.id','ID 重复');else ids.add(v.id)
  if(v.sourceRefs!==undefined){
   if(!list(v.sourceRefs,1,8)||!v.sourceRefs.every(x=>short(x,160)))fail(p+'.sourceRefs','最多 8 个来源 ID')
   else if(options.sourceIds&&v.sourceRefs.some(x=>!options.sourceIds!.has(x as string)))fail(p+'.sourceRefs','来源不在本轮授权证据中')
  }
 }
 const children=(v:unknown,p:string,depth:number)=>{if(!list(v,1,16)){fail(p,'需要 1–16 个组件');return}for(let i=0;i<v.length;i++)visit(v[i],p+'['+i+']',depth)}
 const visit=(v:unknown,p:string,depth:number):void=>{
  if(++nodes>48||depth>4){fail(p,'超过组件数量或嵌套上限');return}
  if(!object(v)){fail(p,'需要组件对象');return}
  if(typeof v.type!=='string'||!Object.prototype.hasOwnProperty.call(UI_COMPONENTS,v.type)){fail(p,'组件不在注册表中');return}
  const spec=UI_COMPONENTS[v.type as keyof typeof UI_COMPONENTS];fields(v,['type','id','sourceRefs',...spec.fields],['type','id',...spec.required],p);base(v,p)
  switch(v.type){
   case 'text':text(v.content,p+'.content',4000);if(v.role!==undefined&&!['heading','paragraph','caption'].includes(String(v.role)))fail(p,'文字角色无效');break
   case 'image':if(!safeUiUrl(v.url,true))fail(p+'.url','图片需要 HTTPS 地址');text(v.alt,p+'.alt',300);if(v.caption!==undefined)text(v.caption,p+'.caption',500);break
   case 'info_card':
    text(v.title,p+'.title');if(v.summary!==undefined)text(v.summary,p+'.summary',1500);if(v.badge!==undefined)text(v.badge,p+'.badge',40)
    if(v.metrics!==undefined){if(!list(v.metrics,1,8))fail(p+'.metrics','需要 1–8 项');else for(const m of v.metrics){if(!object(m)){fail(p,'指标对象无效');continue}fields(m,['label','value'],['label','value'],p);text(m.label,p,80);text(m.value,p,160)}}
    if(v.children!==undefined)children(v.children,p+'.children',depth+1);break
   case 'card_group':if(!['stack','grid'].includes(String(v.layout)))fail(p,'布局无效');children(v.children,p+'.children',depth+1);break
   case 'table':
    text(v.title,p+'.title');if(!list(v.columns,1,8)||!v.columns.every(x=>short(x,100)))fail(p+'.columns','需要 1–8 个标题')
    if(!list(v.rows,1,40))fail(p+'.rows','需要 1–40 行');else for(const row of v.rows){if(!list(row,1,8)||!Array.isArray(v.columns)||row.length!==v.columns.length){fail(p,'行列不一致');continue}for(const cell of row)if(typeof cell==='number'){if(!Number.isFinite(cell))fail(p,'数值必须有限')}else text(cell,p,600)}break
   case 'chart':
    text(v.title,p+'.title');if(!['bar','line'].includes(String(v.chartType)))fail(p,'图表类型无效');if(v.unit!==undefined)text(v.unit,p+'.unit',40)
    if(!list(v.labels,1,24)||!v.labels.every(x=>short(x,80)))fail(p+'.labels','需要 1–24 个标签')
    if(!list(v.series,1,3))fail(p+'.series','需要 1–3 组数值');else for(const s of v.series){if(!object(s)){fail(p,'数据系列无效');continue}fields(s,['name','values'],['name','values'],p);text(s.name,p,100);if(!list(s.values,1,24)||!Array.isArray(v.labels)||s.values.length!==v.labels.length||!s.values.every(x=>typeof x==='number'&&Number.isFinite(x)))fail(p,'数值必须有限且与标签等长')}break
   case 'button':text(v.label,p+'.label',80);action(v.action,p+'.action');break
   case 'form':
    text(v.title,p+'.title');if(v.submitLabel!==undefined)text(v.submitLabel,p+'.submitLabel',80);action(v.action,p+'.action',true)
    if(!list(v.fields,1,8))fail(p+'.fields','需要 1–8 个字段');else {const keys=new Set<string>();for(const f of v.fields){if(!object(f)){fail(p,'字段无效');continue}fields(f,['key','label','type','required','options'],['key','label','type'],p);if(!short(f.key,40)||!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(f.key as string)||keys.has(f.key as string))fail(p,'字段 key 无效或重复');else keys.add(f.key as string);text(f.label,p,80);if(!['text','number','select'].includes(String(f.type)))fail(p,'字段类型无效');if(f.required!==undefined&&typeof f.required!=='boolean')fail(p,'required 需要布尔值');if(f.type==='select'){if(!list(f.options,1,12)||!f.options.every(x=>short(x,100))||new Set(f.options as string[]).size!==(f.options as unknown[])?.length)fail(p,'选择项无效')}else if(f.options!==undefined)fail(p,'只有 select 支持 options')}}break
   case 'steps':case 'checklist':case 'timeline':case 'faq':{
    text(v.title,p+'.title');if(v.note!==undefined)text(v.note,p+'.note',1000)
    const key=v.type==='steps'?'steps':'items',items=v[key]
    if(!list(items,1,24)){fail(p+'.'+key,'需要 1–24 项');break}
    for(let i=0;i<items.length;i++){
     const item=items[i],path=p+'.'+key+'['+i+']'
     if(!object(item)){fail(path,'需要条目对象');continue}
     if(v.type==='faq'){fields(item,['question','answer'],['question','answer'],path);text(item.question,path+'.question',300);text(item.answer,path+'.answer',4000);continue}
     const allowed=v.type==='timeline'?['title','desc','date']:v.type==='checklist'?['title','desc','required']:['title','desc']
     fields(item,allowed,v.type==='timeline'?['title','date']:['title'],path);text(item.title,path+'.title',300);if(item.desc!==undefined)text(item.desc,path+'.desc',2000)
     if(v.type==='timeline')text(item.date,path+'.date',120)
     if(v.type==='checklist'&&item.required!==undefined&&typeof item.required!=='boolean')fail(path+'.required','需要布尔值')
    }break
   }
   case 'notice':text(v.title,p+'.title');text(v.body,p+'.body',4000);if(v.tone!==undefined&&!['info','warning','success'].includes(String(v.tone)))fail(p+'.tone','提醒类型无效');break
   case 'options':
    text(v.title,p+'.title');if(v.intro!==undefined)text(v.intro,p+'.intro',1000);if(v.submitLabel!==undefined)text(v.submitLabel,p+'.submitLabel',80);if(v.multiple!==undefined&&typeof v.multiple!=='boolean')fail(p+'.multiple','需要布尔值')
    if(!list(v.options,2,12))fail(p+'.options','需要 2–12 个候选');else{const values=new Set<string>();for(const item of v.options){if(!object(item)){fail(p,'候选对象无效');continue}fields(item,['label','value','desc'],['label','value'],p);text(item.label,p,160);text(item.value,p,500);if(values.has(item.value as string))fail(p,'候选 value 重复');values.add(item.value as string);if(item.desc!==undefined)text(item.desc,p,1000)}}break
  }
 }
 if(!object(value))fail('page','需要页面对象')
 else {fields(value,['type','version','id','layout','children','fallback','sourceRefs'],['type','version','id','layout','children','fallback'],'page');base(value,'page');if(value.type!=='page'||value.version!==UI_VERSION)fail('page','协议版本必须为 0.1');if(!['stack','grid'].includes(String(value.layout)))fail('page','布局无效');text(value.fallback,'page.fallback',4000);children(value.children,'page.children',1)}
 if(characters>18000)fail('page','正文超出 18000 字限制')
 return {ok:errors.length===0,...(!errors.length?{page:value as UiPage}:{}),errors,nodes}
}

/** Bounded plaintext fallback. Unknown objects, URLs and executable fields are never rendered. */
export function uiFallback(value:unknown):string {
 if(!object(value))return '这部分内容暂时无法展示，请让 Agent 用文字说明。'
 if(short(value.fallback,4000))return value.fallback
 return short(value.title,160)?value.title+'\n这部分内容暂时无法展示，请让 Agent 用文字说明。':'这部分内容暂时无法展示，请让 Agent 用文字说明。'
}

/** Recognize only registered nodes; wrapping never grants an action or fixes invalid fields. */
export function isUiDocument(value:unknown):boolean {
 if(!object(value)||typeof value.type!=='string')return false
 // Existing standalone workflow cards have no id and keep their original renderer/fields.
 if(['steps','checklist','timeline','notice','faq','options'].includes(value.type)&&typeof value.id!=='string')return false
 return value.type==='page'||Object.prototype.hasOwnProperty.call(UI_COMPONENTS,value.type)
}

/** Plain semantic content for fallback/history. Bounded even before schema validation. */
export function uiContentText(value:unknown,max=4000):string {
 const lines:string[]=[];let size=0,nodes=0
 const add=(v:unknown)=>{if(typeof v!=='string'||!v.trim()||size>=max)return;const line=v.slice(0,max-size);lines.push(line);size+=line.length+1}
 const visit=(v:unknown,depth:number)=>{
  if(!object(v)||depth>4||++nodes>48||size>=max)return
  switch(v.type){
   case 'page':add(v.fallback);break
   case 'text':add(v.content);break
   case 'image':add(v.alt);add(v.caption);add(v.url);break
   case 'info_card':add(v.title);add(v.badge);add(v.summary);if(Array.isArray(v.metrics))for(const m of v.metrics.slice(0,8))if(object(m))add(String(m.label||'')+'：'+String(m.value||''));break
   case 'table':add(v.title);if(Array.isArray(v.columns))add(v.columns.slice(0,8).join(' | '));if(Array.isArray(v.rows))for(const row of v.rows.slice(0,40))if(Array.isArray(row))add(row.slice(0,8).join(' | '));break
   case 'chart':add(v.title);if(Array.isArray(v.labels)&&Array.isArray(v.series))for(const s of v.series.slice(0,3))if(object(s)&&Array.isArray(s.values))add(String(s.name||'')+'：'+v.labels.slice(0,24).map((label,i)=>String(label)+' '+String(s.values instanceof Array?s.values[i]:'' )+String(v.unit||'')).join('；'));break
   case 'button':add(v.label);if(object(v.action))add(v.action.kind==='link'?v.action.url:v.action.message);break
   case 'form':add(v.title);if(Array.isArray(v.fields))for(const f of v.fields.slice(0,8))if(object(f))add(String(f.label||'')+(Array.isArray(f.options)?'（'+f.options.slice(0,12).join(' / ')+'）':''));if(object(v.action))add(v.action.message);break
   case 'steps':case 'checklist':case 'timeline':case 'faq':
    add(v.title);add(v.note);{const items=v.type==='steps'?v.steps:v.items;if(Array.isArray(items))for(const item of items.slice(0,24))if(object(item)){add(v.type==='faq'?item.question:item.title);add(item.date);add(v.type==='faq'?item.answer:item.desc)}}break
   case 'notice':add(v.title);add(v.body);break
   case 'options':add(v.title);add(v.intro);if(Array.isArray(v.options))for(const option of v.options.slice(0,12))if(object(option)){add(option.label);add(option.desc);add(option.value)}break
  }
  if(Array.isArray(v.children))for(const child of v.children.slice(0,16))visit(child,depth+1)
 }
 visit(value,0);return [...new Set(lines)].join('\n').slice(0,max)
}

/** Models sometimes emit one valid component instead of its page envelope. Same strict gate. */
export function normalizeUiDocument(value:unknown):unknown {
 if(!isUiDocument(value)||!object(value))return value
 const stabilize=(root:Record<string,unknown>)=>{
  const ids=new Set<string>();let count=0,serial=0
  const node=(v:unknown,depth:number):unknown=>{if(!object(v)||depth>4||++count>48)return v;const result={...v};let id=typeof v.id==='string'&&/^[A-Za-z0-9_]{1,80}$/.test(v.id)?v.id:'ui_n'+(++serial);while(ids.has(id))id='ui_n'+(++serial);ids.add(id);result.id=id
   if(v.type==='page'){result.version=v.version??UI_VERSION;result.layout=v.layout??'stack';result.fallback=v.fallback??uiContentText(v)}
   if(v.type==='card_group')result.layout=v.layout??'stack'
   if(Array.isArray(v.children))result.children=v.children.map(child=>node(child,depth+1));return result}
  return node(root,0)
 }
 if(value.type==='page')return stabilize(value)
 const ids=new Set<string>();let seen=0
 const visit=(v:unknown,depth:number)=>{if(!object(v)||depth>4||++seen>48)return;if(typeof v.id==='string')ids.add(v.id);if(Array.isArray(v.children))for(const child of v.children.slice(0,16))visit(child,depth+1)}
 visit(value,0);let id='component_page';while(ids.has(id))id+='_' 
 return stabilize({type:'page',version:UI_VERSION,id,layout:'stack',fallback:uiContentText(value)||'请用文字说明这部分内容。',children:[value]})
}
export function validateUiDocument(value:unknown,options:{sourceIds?:ReadonlySet<string>}={}):UiValidation {
 return validateUiPage(normalizeUiDocument(value),options)
}
