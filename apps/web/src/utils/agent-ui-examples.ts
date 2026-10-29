import type {UiPage,UiNode} from './agent-ui'
const origin=typeof window==='undefined'?'https://campus.example.org':window.location.origin
const page=(id:string,children:UiNode[],fallback:string):UiPage=>({type:'page',version:'0.1',id,layout:'stack',fallback,children})
export const UI_EXAMPLES:{label:string;document:UiPage}[]=[
 {label:'业务组合',document:page('service_demo',[
  {type:'text',id:'heading',role:'heading',content:'校园卡服务 · 示例'},
  {type:'text',id:'intro',content:'先选择适合的办理方式，具体开放时间和办理要求请向服务窗口核实。'},
  {type:'card_group',id:'channels',layout:'grid',children:[
   {type:'service_card',id:'offline',mode:'offline',title:'校园卡服务窗口',summary:'补卡等需要现场办理的事项。以下位置仅用于排版示例。',location:'良乡校区 · 教学综合楼 3 层 309',actionLabel:'询问怎么走',action:{kind:'ask',message:'良乡校园卡服务窗口怎么走？'}},
   {type:'service_card',id:'online',mode:'online',title:'一站式服务大厅',summary:'在线事务请查询已收录的真实入口；此处为排版示例。',actionLabel:'查询办理入口',action:{kind:'ask',message:'请查询一站式服务大厅校园卡办理入口'}},
  ]},
  {type:'card_group',id:'preparation',layout:'stack',children:[
   {type:'checklist',id:'service_materials',title:'出发前准备 · 示例',note:'以下仅示范清单交互，不代表真实办理要求。',items:[{title:'核对最新指南',desc:'确认材料清单和窗口时间。'},{title:'按指南准备证件',desc:'保留原件、复印件及代办要求。'}]},
   {type:'steps',id:'service_steps',title:'办理流程 · 示例',steps:[{title:'查看最新指南',desc:'先确认事项与适用对象。'},{title:'按指南办理',desc:'线上或现场操作，以主管部门发布为准。'},{title:'核对结果',desc:'查看本人的申请结果或领取凭证。'}]},
  ]},
  {type:'notice',id:'service_notice',title:'先核实，再前往',tone:'info',body:'示例中的勾选只记录个人准备进度；不会提交申请或改变学校系统中的办理状态。'},
 ],'排版示例：校园卡服务可按线上、线下渠道组织。良乡窗口位置示例为教学综合楼3层309。具体要求需核实；可继续询问路线或在线入口。')},
 {label:'文字',document:page('text_demo',[{type:'text',id:'title',role:'heading',content:'先给出结论'},{type:'text',id:'body',content:'简单问题用一句清楚的回答就够了。长篇解释、诗歌和代码仍可使用普通 Markdown，不需要强制变成卡片。'},{type:'text',id:'caption',role:'caption',content:'这里只演示文字的语义角色。'}],'简单问题直接回答；长篇内容不必强制卡片化。')},
 {label:'图片',document:page('image_demo',[{type:'image',id:'cover',url:origin.replace(/^http:/,'https:')+'/og-cover.png',alt:'行知校园平台封面',caption:'来自平台已有公开图片，用于演示图片组件。'}],'平台封面图片组件示例。')},
 {label:'信息卡',document:page('info_demo',[{type:'info_card',id:'plan',title:'每周学习安排',badge:'示例方案',summary:'把每天的投入拆成可持续的小目标。',metrics:[{label:'每日投入',value:'1 小时（示例）'},{label:'每周复盘',value:'1 次（示例）'}]}],'示例学习安排：每日投入1小时，每周复盘1次。')},
 {label:'卡片组',document:page('group_demo',[{type:'card_group',id:'group',layout:'grid',children:[{type:'info_card',id:'a',title:'方案 A',summary:'每次完成一个小任务。'},{type:'info_card',id:'b',title:'方案 B',summary:'集中时间处理同一主题。'}]}],'示例：方案A分散完成小任务；方案B集中处理同一主题。')},
 {label:'表格',document:page('table_demo',[{type:'table',id:'comparison',title:'示例学习方案对比',columns:['方案','每天投入','适合情况'],rows:[['A','1 小时','时间较分散'],['B','2 小时','有完整时间块'],['C','30 分钟','先建立习惯']]}],'示例：A每天1小时，适合分散时间；B每天2小时，适合完整时间块；C每天30分钟，适合建立习惯。')},
 {label:'图表',document:page('chart_demo',[{type:'chart',id:'progress',title:'学习时长 · 示例数据',chartType:'bar',labels:['周一','周二','周三','周四','周五'],series:[{name:'自习',values:[1,2,1.5,2.5,1]},{name:'阅读',values:[.5,1,.5,1,.5]}],unit:'小时'}],'示例数据：周一到周五自习1、2、1.5、2.5、1小时；阅读0.5、1、0.5、1、0.5小时。')},
 {label:'按钮',document:page('button_demo',[{type:'button',id:'ask',label:'继续聊学习计划',action:{kind:'ask',message:'请帮我制定一份适合分散时间的学习计划'}},{type:'button',id:'link',label:'打开校园地图',action:{kind:'link',url:origin+'/map'}}],'可继续询问学习计划，或打开平台校园地图。')},
 {label:'表单',document:page('form_demo',[{type:'form',id:'preferences',title:'完善学习计划条件',fields:[{key:'goal',label:'学习目标',type:'text',required:true},{key:'hours',label:'每天可用小时',type:'number',required:true},{key:'style',label:'时间安排',type:'select',options:['时间分散','有完整时间块']}],action:{kind:'ask',message:'请根据我确认的条件制定学习计划'},submitLabel:'确认条件'}],'请补充学习目标、每天可用小时和时间安排，再制定学习计划。')},
 {label:'流程步骤',document:page('steps_demo',[{type:'steps',id:'steps',title:'校内事项办理流程 · 示例',note:'这里只演示有顺序的操作；点击勾选可以记录个人进度。',steps:[{title:'确认事项与条件',desc:'阅读最新办事指南，确认身份、校区、适用对象和办理方式。'},{title:'准备所需材料',desc:'按原文要求检查证件、复印件与其他附件；未收录的要求先核实。'},{title:'按实际入口办理',desc:'使用已核实入口或前往指南中的服务窗口；提交由本人完成。'},{title:'核对本人办理结果',desc:'根据实际反馈查询进度、领取或核对结果。'}]}],'示例流程：确认事项、准备材料、按实际入口办理、核对结果。勾选不代表已提交申请。')},
 {label:'准备清单',document:page('checklist_demo',[{type:'checklist',id:'checklist',title:'出发前的准备清单 · 示例',note:'仅示范排版与勾选，不是某项校内事务的材料要求。',items:[{title:'确认办理对象',desc:'身份与校区要符合指南。'},{title:'核对材料原件与复印件',desc:'按原文清单准备，不自行补充要求。'},{title:'补充个人备注',desc:'记录想咨询的问题。',required:false}]}],'示例准备：确认办理对象，核对指南中的材料，可选记录个人备注。')},
 {label:'时间安排',document:page('timeline_demo',[{type:'timeline',id:'timeline',title:'办理阶段 · 示例',note:'未给出具体日期时，使用已知相对阶段；不填写虚构时限。',items:[{date:'申请前',title:'核对最新指南',desc:'确认条件、材料和入口。'},{date:'提交后',title:'查看本人申请进度',desc:'根据实际反馈处理补充材料或其他通知。'},{date:'收到结果后',title:'核对办理结果',desc:'以本人实际收到的反馈为准。'}]}],'示例阶段：申请前核对指南，提交后查看进度，收到结果后核对。')},
 {label:'注意提醒',document:page('notice_demo',[{type:'notice',id:'notice',title:'不要把入口主页当作事项直达页',tone:'warning',body:'平台首页需要进入后查找具体事项。没有收录直达地址时，保留搜索步骤，并向主管部门核实最新办理要求。'}],'平台首页并不等于具体办理页，需继续搜索事项并核实要求。')},
 {label:'折叠问答',document:page('faq_demo',[{type:'faq',id:'faq',title:'组件交互常见问题',items:[{question:'勾选清单会提交申请吗？',answer:'不会。勾选只记录本浏览器中的个人准备状态，不调用模型、不写入学校系统。'},{question:'刷新后进度还在吗？',answer:'正式聊天按消息保存本浏览器的标记；实验室只作临时预览。清空浏览器数据会丢失本地标记。'},{question:'如果没有完整的办理信息呢？',answer:'保留未知信息并继续询问，不用卡片样式掩盖缺少证据。'}]}],'勾选不提交申请；正式聊天保留本浏览器标记，实验室为临时预览；缺少证据应询问。')},
 {label:'澄清选项',document:page('options_demo',[{type:'options',id:'options',title:'你想先了解哪一项？',intro:'选择一个方向后，Agent 会根据问题继续查询；候选必须来自实际已知信息。',submitLabel:'查看所选事项',options:[{label:'校园卡补办',value:'请告诉我校园卡补办的流程和准备材料',desc:'查看具体办理要求与窗口。'},{label:'校园卡挂失与解挂',value:'请告诉我校园卡挂失与解挂的办理流程',desc:'查看已收录的线上办理入口。'}]}],'请选择校园卡补办或校园卡挂失与解挂，再查看对应指引。')},
 {label:'服务入口',document:page('service_entry_demo',[
  {type:'card_group',id:'service_channels',layout:'grid',children:[
   {type:'service_card',id:'online_entry',mode:'online',title:'在线服务 · 示例',summary:'已核实的线上事务可以直接打开入口，无需寻找线下位置。',actionLabel:'打开示例入口',action:{kind:'link',url:'https://example.invalid/services'}},
   {type:'service_card',id:'offline_entry',mode:'offline',title:'服务窗口 · 示例',summary:'现场办理前，先确认最新时间和材料要求。',location:'地点以实际指南为准',contact:'联系方式以实际指南为准',actionLabel:'询问准备材料',action:{kind:'ask',message:'去这个服务窗口需要准备什么材料？'}},
  ]},
 ],'线上服务打开已核实入口；线下窗口保留地点与联系方式，出发前确认时间和材料。本页均为排版示例。')},
 {label:'关键信息',document:page('key_values_demo',[
  {type:'key_values',id:'service_facts',title:'办理前先看这些 · 示例',items:[{label:'办理对象',value:'以实际办事指南中的适用身份为准'},{label:'所在校区',value:'先确认良乡或望京校区'},{label:'开放时间',value:'未收录，请向服务部门核实'},{label:'材料要求',value:'核对原件、复印件与代办要求，不补造缺失信息'}],note:'字段式呈现适合查时间、地点、联系方式等问题；具体事实必须来自已核实知识库。'},
 ],'办理前确认适用身份、校区、开放时间与材料要求。缺失内容应核实，不填造。本页为排版示例。')},
]
