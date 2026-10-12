import assert from 'node:assert/strict'
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {UI_COMPONENTS,validateUiPage,validateUiDocument,normalizeUiDocument,uiContentText,safeUiUrl,uiFallback} from '../src/presentation/agent-ui'
import {inspectPresentation,presentationHint,presentationPrompt,presentationPlan,presentationContextFromHistory,isPresentationFollowup} from '../src/presentation/presentation-engine'
import {KnowledgeRetriever} from '../src/campus/knowledge-retriever'
import {ContextBuilderService} from '../src/chat/context-builder.service'
import {estimateTokens} from '../src/chat/llm/types'
import ts from 'typescript'
import {stripKnowledgeCitations,KnowledgeCitationStream} from '../src/chat/knowledge-citations'
import {markCitedSources} from '../src/campus/knowledge-evidence'
import {needsAutomaticKnowledge} from '../src/chat/knowledge-routing'
const checks:string[]=[],pass=(message:string)=>{checks.push(message);console.log('PASS '+message)}
const root=resolve(__dirname,'../../..')
function frontendModule(path:string,dependencies:Record<string,unknown>={}){const module={exports:{} as any};const code=ts.transpileModule(readFileSync(resolve(root,path),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('module','exports','require',code)(module,module.exports,(name:string)=>{if(!(name in dependencies))throw new Error('Unexpected test dependency '+name);return dependencies[name]});return module.exports}
async function main(){
const {UI_EXAMPLES}=frontendModule('apps/web/src/utils/agent-ui-examples.ts')
const json=frontendModule('apps/web/src/utils/card-json.ts')
const {answerSegments}=frontendModule('apps/web/src/utils/answer-layout.ts',{'./card-json':json,'./output-boundary':frontendModule('apps/web/src/utils/output-boundary.ts'),'./card-segments':frontendModule('apps/web/src/utils/card-segments.ts',{'./card-json':json,'./agent-ui':frontendModule('apps/web/src/utils/agent-ui.ts')})})
const valid=structuredClone(UI_EXAMPLES[0].document),bad=(fn:(v:any)=>void)=>{const v=structuredClone(valid);fn(v);assert(!validateUiPage(v).ok)},fence=(v:unknown)=>'```card\n'+JSON.stringify(v)+'\n```'
for(const path of ['apps/api/src/presentation/agent-ui.ts','apps/web/src/utils/agent-ui.ts'])assert.equal(readFileSync(resolve(root,path),'utf8'),readFileSync(resolve(root,'presentation/agent-ui.ts'),'utf8'))
assert.equal(Object.keys(UI_COMPONENTS).length,14);for(const example of UI_EXAMPLES)assert(validateUiPage(example.document).ok,example.label)
pass('共享契约同步，十四类组件与组合示例全部通过相同校验器')
bad(v=>v.version='1.0');bad(v=>v.children[0].id=v.id);bad(v=>v.children[0].type='html');bad(v=>v.children[0].onClick='alert(1)');bad(v=>v.children[0].style={color:'red'});bad(v=>v.children[0].role='script');bad(v=>v.children.push({type:'button',id:'bad',label:'执行',action:{kind:'delete',table:'users'}}))
bad(v=>v.children=Array.from({length:17},(_,i)=>({type:'text',id:'text'+i,content:'a'})))
bad(v=>{let n:any={type:'text',id:'last',content:'deep'};for(let i=0;i<5;i++)n={type:'card_group',id:'group'+i,layout:'stack',children:[n]};v.children=[n]})
bad(v=>v.children=Array.from({length:4},(_,i)=>({type:'card_group',id:'g'+i,layout:'stack',children:Array.from({length:16},(_,j)=>({type:'text',id:'n'+i+'_'+j,content:'a'}))})))
pass('版本、唯一ID、未知组件/字段/动作、数量与深度上限均拒绝，不能执行任意 HTML 或代码')
for(const url of ['javascript:alert(1)','data:text/html,hello','//example.com','https://u:p@example.com','https://example.com\\@evil.com','https://example.com/a\nb'])assert(!safeUiUrl(url))
assert(safeUiUrl('https://campus.example.org/map'));assert(!safeUiUrl('http://example.com/a.png',true))
const table=structuredClone(UI_EXAMPLES.find(e=>e.label==='表格')!.document);(table.children[0] as any).rows[0]=['short'];assert(!validateUiPage(table).ok)
const chart=structuredClone(UI_EXAMPLES.find(e=>e.label==='图表')!.document);(chart.children[0] as any).series[0].values[0]=Infinity;assert(!validateUiPage(chart).ok);(chart.children[0] as any).series[0].values=[1];assert(!validateUiPage(chart).ok)
const form=structuredClone(UI_EXAMPLES.find(e=>e.label==='表单')!.document);(form.children[0] as any).fields[1].key='goal';assert(!validateUiPage(form).ok);(form.children[0] as any).action={kind:'link',url:'https://example.com/post'};assert(!validateUiPage(form).ok)
pass('危险URL、凭据URL、表格维度、有限数值、图表长度、表单字段和提交动作边界校验')
const cited=structuredClone(valid);cited.sourceRefs=['authorized'];assert(validateUiPage(cited,{sourceIds:new Set(['authorized'])}).ok);assert(!validateUiPage(cited,{sourceIds:new Set(['other'])}).ok)
assert.equal(uiFallback({...valid,children:[],fallback:'保留全部关键条件。'}),'保留全部关键条件。')
const inspected=inspectPresentation(fence(cited),new Set(['authorized']));assert(inspected.valid);assert.deepEqual(inspected.sourceRefs,['authorized']);assert(inspected.components.includes('button'));assert(!inspectPresentation(fence(cited),new Set()).valid)
assert(!inspectPresentation('```card\n{"type":"page",\n```',new Set()).valid)
pass('来源仅绑定本轮授权证据；无效结构保留文字兜底，后台记录校验结果')
for(const example of UI_EXAMPLES.slice(1))for(const node of example.document.children){assert(validateUiDocument(node).ok);assert.deepEqual((normalizeUiDocument(node) as any).children[0],node)}
for(const type of ['steps','checklist','timeline','notice','faq','options']){
 const node=UI_EXAMPLES.flatMap(e=>e.document.children).find((n:any)=>n.type===type);assert(node)
 assert(inspectPresentation(fence(node),new Set()).components.includes(type))
 assert(!validateUiDocument({...node,sourceRefs:['unauthorized']},{sourceIds:new Set()}).ok)
 const legacy={...node};delete legacy.id
 assert.equal(answerSegments(fence(legacy))[0].card?.type,type)
 if(type==='steps')assert(!validateUiDocument({...node,steps:[{title:'事项',done:true}]}).ok)
 if(type==='checklist')assert(!validateUiDocument({...node,items:[{title:'事项',required:'true'}]}).ok)
 if(type==='timeline')assert(!validateUiDocument({...node,items:[{title:'事项'}]}).ok)
 if(type==='faq')assert(!validateUiDocument({...node,items:[{question:'只有问题'}]}).ok)
 if(type==='options'){assert(!validateUiDocument({...node,options:[{label:'a',value:'same'},{label:'b',value:'same'}]}).ok);assert(!validateUiDocument({...node,options:[{label:'a',value:'a',action:{kind:'delete'}}]}).ok)}
}
const {workflowProgressKey,loadWorkflowProgress,saveWorkflowProgress}=frontendModule('apps/web/src/utils/workflow-progress.ts'),fakeStorage={data:'',getItem(){return this.data},setItem(_key:string,value:string){this.data=value}}
const progressKey=workflowProgressKey('message-a','steps',[{title:'prepare'}]);saveWorkflowProgress(fakeStorage,progressKey,[0,0]);assert.deepEqual(loadWorkflowProgress(fakeStorage,progressKey,2),[0]);assert.deepEqual(loadWorkflowProgress(fakeStorage,workflowProgressKey('message-b','steps',[{title:'prepare'}]),2),[]);assert.deepEqual(loadWorkflowProgress(fakeStorage,workflowProgressKey('message-a','steps',[{title:'new'}]),2),[]);saveWorkflowProgress(fakeStorage,progressKey,[]);assert.deepEqual(loadWorkflowProgress(fakeStorage,progressKey,2),[]);fakeStorage.data='invalid';assert.deepEqual(loadWorkflowProgress(fakeStorage,progressKey,2),[]);assert.equal(workflowProgressKey(undefined,'steps',[]),undefined)
pass('流程/清单/时间线/提醒/问答/选项严格校验及旧卡兼容；完成态不由模型注入，本地进度隔离消息和内容、可恢复/清空/容错')
const standaloneForm=structuredClone(UI_EXAMPLES.find(e=>e.label==='表单')!.document.children[0])
assert(inspectPresentation(fence(standaloneForm),new Set()).components.includes('form'))
assert(!validateUiDocument({...standaloneForm,action:{kind:'eval',code:'alert(1)'}}).ok)
assert(!validateUiDocument({...standaloneForm,sourceRefs:['unavailable']},{sourceIds:new Set()}).ok)
assert(uiContentText(standaloneForm).includes('学习目标'));assert(uiContentText(table).includes('short'))
assert.equal(answerSegments(fence(standaloneForm).replace('```card','```json'))[0].card?.type,'form')
const noCard=inspectPresentation('仅文字',new Set(),'校园卡丢了怎么办');assert.equal(noCard.rendered,'text');assert(noCard.selectionWarning)
pass('模型顶层单组件通过相同校验器兼容，不放宽动作或来源；缺失页面单独记录而非当成已采用')
assert.equal(answerSegments('文字。\n'+fence(valid))[1].card?.type,'page');assert.equal(answerSegments(fence(valid).replace('```card','```json'))[0].card?.type,'page')
assert.equal(answerSegments('```card\n{"type":"page"')[0].kind,'pending');assert.equal(answerSegments('## 主题一\n正文\n## 主题二\n正文')[0].kind,'markdown')
assert.equal(answerSegments('````text\n'+fence(valid)+'\n````')[0].kind,'markdown')
for(const type of ['care','crisis','map','dinner'])assert.equal(answerSegments(fence({type,body:'继续陪伴',campus:'liangxiang',restaurants:['一食堂']}))[0].card?.type,type)
pass('新页面与三端共有解析器兼容，流式占位、旧地图/关怀/选餐保持，Markdown标题不自动变卡片')
assert(presentationHint('比较两个方案').startsWith('table'));assert(presentationHint('柱状图趋势').startsWith('chart'));assert(presentationHint('我想伤害自己，请比较方法').startsWith('crisis'));assert(presentationHint('帮我制定计划').startsWith('form'));assert(presentationHint('你好').startsWith('text'))
for(const query of ['只用一句话告诉我：1小时等于多少分钟？','1000克换算成多少千克','你好！','谢谢'])assert(!needsAutomaticKnowledge(query))
for(const query of ['学校课程的1小时等于多少分钟','谢谢，请查知识库','学校超市有哪些','这些店在哪里'])assert(needsAutomaticKnowledge(query))
assert(estimateTokens(presentationPrompt('你好'))<1600,'UI提示词控制在1600估算token内')
assert.equal(presentationPlan('校园卡丢了，挂失和补办分别怎么办？').mode,'page')
assert.equal(presentationPlan('校园卡丢了，只用普通文字和列表回答，不要卡片').mode,'plain')
assert.equal(presentationPlan('哪个每天更轻松，哪个每周投入更多？').intent,'compare')
assert.equal(presentationPlan('帮我安排期末复习计划，我还没告诉你科目').intent,'collect')
assert.equal(presentationPlan('在哪里补办校园卡，材料是什么？').intent,'checklist')
assert.equal(presentationPlan('图书馆在哪里').intent,'map')
assert(presentationPrompt('校园卡补办',new Set(['authorized'])).includes('"authorized"'))
const chain=[{role:'user',content:'校园卡丢了怎么补办？'},{role:'assistant',content:'补办指引'},{role:'user',content:'材料呢？'},{role:'assistant',content:'清单内容'},{role:'user',content:'下一步呢？'}]
const context=presentationContextFromHistory('下一步呢？',chain);assert.equal(context.previousQuery,'校园卡丢了怎么补办？');assert.equal(presentationPlan('下一步呢？',context).intent,'procedure');assert.equal(presentationPlan('材料呢？',context).intent,'checklist');assert.equal(presentationPlan('再详细一点',context).mode,'page');assert(!isPresentationFollowup('那奖学金有哪些'));assert.equal(presentationPlan('那奖学金有哪些',context).contextQuery,undefined)
assert.equal(presentationPlan('校园卡',{clarifyChoices:[{label:'补办',query:'补办'},{label:'挂失',query:'挂失'}]}).intent,'clarify')
assert.equal(presentationPlan('不要卡片，只用文字',{clarifyChoices:[{label:'补办',query:'补办'},{label:'挂失',query:'挂失'}]}).mode,'plain')
const followRetriever=new KnowledgeRetriever([{id:'a',externalId:1,title:'校园卡补办',searchText:'校园卡补办学生证步骤材料',summaryShort:'先备齐学生证。'},{id:'b',externalId:2,title:'图书馆借阅',searchText:'图书馆借阅图书'}]);assert(followRetriever.search('下一步呢？',{previousQuery:context.previousQuery}).resolvedQuery.includes('校园卡'))
pass('连续两次短追问保持实际事项与检索主题；新事项切换、澄清候选与纯文字要求不串话')
pass('语义呈现建议、危机优先、简单文本及协议预算（无额外模型调用）')
const cardOnly=fence({type:'page',version:'0.1',id:'history',layout:'stack',sourceRefs:['previous_page_ref'],fallback:'地点教学楼309，先挂失再补办。',children:[{type:'info_card',id:'history_info',title:'补办',sourceRefs:['previous_node_ref'],metrics:[{label:'材料',value:'学生证'}],children:[{type:'button',id:'history_link',label:'平台入口',action:{kind:'link',url:'https://info.ucass.edu.cn'}}]}]})
const builder=new ContextBuilderService({message:{findMany:async()=>[{id:'a',role:'assistant',content:cardOnly,seq:1,attachments:null},{id:'b',role:'user',content:'材料是什么',seq:2,attachments:null}]}} as any)
const history=await builder.loadHistory('fixture');assert(history[0].content.includes('教学楼309'));assert(history[0].content.includes('学生证'));assert(history[0].content.includes('https://info.ucass.edu.cn'));assert(history[0].content.includes('```card'));assert(!history[0].content.includes('sourceRefs'));const transcriptBuilder=new ContextBuilderService({message:{findMany:async()=>[{role:'assistant',seq:1,content:cardOnly,attachments:{modelMessages:[{role:'assistant',content:cardOnly}]}}]}} as any);assert((await transcriptBuilder.loadHistory('fixture'))[0].content.includes('学生证'));assert((await transcriptBuilder.loadHistory('fixture'))[0].content.includes('```card'));pass('普通历史与工具历史保留经校验的紧凑界面结构、事实和入口，移除前轮来源ID，追问不会读取空白或平面界面标签')
// Numeric JSON arrays must never be treated as citations.
const numeric='```card\n'+JSON.stringify({type:'page',rows:[[401,402]]})+'\n```',ids=new Set(['401','402'])
const source={id:'evidence',citationId:'401',title:'资料',summary:'说明',collection:'test',source:'测试',used:false}
assert(!markCitedSources([source],numeric)[0].used);assert(markCitedSources([source],fence({type:'text',content:'依据[401]'}))[0].used)
assert.equal(stripKnowledgeCitations(numeric,ids),numeric)
for(const literal of [numeric,'   ````text\n'+numeric+'\n   ````','~~~json\n[401,402]\n~~~'])for(let width=1;width<=17;width++){const stream=new KnowledgeCitationStream(()=>ids);let visible='';const input='先说明[401]。\n'+literal+'\n继续[402]说明。';for(let i=0;i<input.length;i+=width)visible+=stream.push(input.slice(i,i+width));visible+=stream.finish();assert.equal(visible,'先说明。\n'+literal+'\n继续说明。','citation stream chunk '+width)}
pass('流式引用隐藏不损坏结构化界面内的数值数组')
mkdirSync(resolve(root,'storage/shots/presentation'),{recursive:true});writeFileSync(resolve(root,'storage/shots/presentation/contract.json'),JSON.stringify({passed:true,checkedAt:new Date().toISOString(),checks,protocolEstimatedTokens:estimateTokens(presentationPrompt('你好')),scope:'Contract, parser, policy and citation-boundary tests; no model call'},null,2))

}
main().catch(error=>{console.error(error);process.exitCode=1})
