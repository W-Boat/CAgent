import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
const root=new URL('../../../',import.meta.url),api=process.env.UI_API||'https://campus.example.org/api',baseline=process.env.UI_PHASE==='before'
for(const line of readFileSync(new URL('.env',root),'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2]}
const auth=await fetch(api+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:process.env.INTEGRATE_EMAIL||process.env.SEED_ADMIN_EMAIL,password:process.env.INTEGRATE_PASSWORD||process.env.SEED_ADMIN_PASSWORD})}).then(r=>r.json());assert.equal(auth.code,0,'Auth failed')
const headers={Authorization:'Bearer '+auth.data.accessToken,'Content-Type':'application/json'},owned=[],samples=[]
const call=async(path,method='GET',data)=>{const r=await fetch(api+path,{headers,method,body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(30000)}),value=await r.json();assert.equal(value.code,0,'API operation failed');return value.data}
try{
 const available=await call('/models/available'),models=Array.isArray(available)?available:available.items,model=models.find(m=>m.key==='deepseek-chat');assert(model)
 const availableAgents=await call('/agents'),agents=Array.isArray(availableAgents)?availableAgents:availableAgents.items,agent=agents.find(a=>a.key==='ucass-guide');assert(agent,'Campus agent missing')
 const legacyPrompt="你有一个「卡片」能力：在合适的时候，用 ```card 围栏输出一段 JSON，前端会把它渲染成可交互的卡片。\n- 围栏语言标记必须是 card，内容是合法 JSON 对象；一次回复最多 4 张卡片。\n- 纯闲聊、简单问答用普通 Markdown。\n- 普通清单和长文保留 Markdown，不套笼统整理卡；原有求助、关怀、选项和诗文卡按场景保留。\n- 标题简洁，说明保留日期与条件，不要为排版省略关键事实。不要编造事实、链接、电话、数据。\n【steps 步骤卡】{\"type\":\"steps\",\"title\":\"补办校园卡\",\"steps\":[{\"title\":\"挂失\",\"desc\":\"校园 App 内操作\"}]}\n【facts 信息卡】{\"type\":\"facts\",\"title\":\"办理信息\",\"items\":[{\"label\":\"部门\",\"value\":\"检索得到的部门\"}]}\n【compare 对比卡】{\"type\":\"compare\",\"title\":\"方案对比\",\"columns\":[\"事项\",\"区别\"],\"rows\":[[\"事项名称\",\"核实的区别\"]]}\n【timeline 时间线】{\"type\":\"timeline\",\"title\":\"办理安排\",\"items\":[{\"date\":\"通知中给出的时间\",\"title\":\"办理\",\"desc\":\"核实的安排\"}]}\n【checklist 材料清单】{\"type\":\"checklist\",\"title\":\"准备材料\",\"items\":[{\"title\":\"检索得到的材料\",\"desc\":\"材料要求\"}]}\n资料依据由页面的「知识库来源」展示，不要输出来源卡片、索引编号字段或重复来源列表。\n【guide 入口卡】检索结果给了「网页入口：https://…」时必须把链接放进 url 字段：{\"type\":\"guide\",\"title\":\"接下来你可以\",\"items\":[{\"label\":\"图书馆\",\"desc\":\"一层总服务台\",\"meta\":\"010-81360100\",\"url\":\"https://…\"}]}\n【care 关怀卡】普通压力或难过先陪伴：{\"type\":\"care\",\"title\":\"我在这里，慢慢说\",\"body\":\"回应具体处境\",\"actions\":[{\"label\":\"继续聊聊\",\"action\":\"我想继续说说\"}]}\n【crisis 求助卡】出现自伤、绝望信号时必须输出：{\"type\":\"crisis\",\"title\":\"我很在意你现在的状态\",\"body\":\"先接住情绪\",\"hotline\":{\"label\":\"心理援助热线\",\"number\":\"12356\",\"note\":\"全国统一，24 小时\"}}"
 const cases=[
  {name:'校园办理',content:'校园卡丢了，挂失和补办分别怎么办？线上和线下有哪些入口？',expected:['info_card','button']},
  {name:'收集计划条件',content:'帮我安排期末复习计划，我还没决定每天能学多久，也没告诉你考试日期和科目。',expected:['form']},
  ...(!baseline?[
   {name:'自然比较',content:'我提供两种复习方案：A每天1小时，每周5天；B每天2小时，每周3天。哪个每天更轻松，哪个每周投入更多？',expected:['table']},
   {name:'用户要求纯文本',content:'校园卡丢了，怎么挂失和补办？只用普通文字和列表回答，不要卡片。',expected:[]},
   {name:'简单事实',content:'只用一句话告诉我：1小时等于多少分钟？',expected:[]},
   {name:'旧体验会话协议',content:'校园卡丢了，挂失和补办分别怎么办？线上和线下有哪些入口？',expected:['info_card','button'],systemPrompt:legacyPrompt},
  ]:[])
 ]
 for(const item of cases){
  const seeded=item.systemPrompt?await call('/conversations','POST',{title:'旧体验协议兼容验证',modelId:model.id,agentId:agent.id,systemPrompt:item.systemPrompt}):undefined;if(seeded)owned.push(seeded.id)
  const r=await fetch(api+'/chat/completions',{headers,method:'POST',body:JSON.stringify({content:item.content,conversationId:seeded?.id,modelId:model.id,agentId:agent.id,enableTools:false,memoryEnabled:false,origin:'admin-chat'}),signal:AbortSignal.timeout(180000)});assert(r.ok,'Chat request failed')
  const frames=(await r.text()).split(/\r?\n\r?\n/).map(b=>{const event=/^event: (.+)$/m.exec(b)?.[1],raw=/^data: (.+)$/m.exec(b)?.[1];return {event,data:raw?JSON.parse(raw):{}}}),meta=frames.find(f=>f.event==='meta')?.data
  if(meta?.conversationId&&!owned.includes(meta.conversationId))owned.push(meta.conversationId)
  assert.equal(frames.find(f=>f.event==='done')?.data.status,'SUCCESS','Model failed')
  const text=frames.filter(f=>f.event==='text').map(f=>f.data.text).join(''),history=await call('/conversations/'+meta.conversationId+'/messages'),saved=history.items.find(m=>m.id===meta.assistantMessageId);assert(saved)
  const presentation=saved.attachments.presentation,components=presentation.components,rawCards=[...text.matchAll(/```(?:card|json)\s*\n([\s\S]*?)\n```/gi)].flatMap(m=>{try{return [JSON.parse(m[1]).type]}catch{return ['invalid-json']}})
  samples.push({name:item.name,query:item.content,content:text,components,rawCards,presentation,sources:(saved.attachments.knowledgeSources||[]).map(s=>({id:s.id,citationId:s.citationId,title:s.title,used:s.used})),modelTurns:saved.attachments.agentRun.modelTurns,totalTokens:saved.totalTokens})
  console.log(JSON.stringify({name:item.name,components,rawCards,valid:presentation.valid,modelTurns:saved.attachments.agentRun.modelTurns}))
  if(!baseline){assert(presentation.valid,item.name+' invalid UI');for(const type of item.expected)assert(components.includes(type),item.name+' missing '+type);if(!item.expected.length)assert.equal(rawCards.length,0,item.name+' should stay plain text');assert.equal(saved.attachments.agentRun.modelTurns,1);assert.equal(saved.content,text);if(item.name==='校园办理'||item.systemPrompt)assert(samples.at(-1).sources.some(s=>s.used),'Business answer must bind a real source')}
 }
}catch(error){console.error(String(error.message).split('\n')[0].replace(/eyJ[A-Za-z0-9_.-]+/g,'[redacted]'));process.exitCode=1}
finally{
 const out=new URL('storage/shots/presentation/',root);mkdirSync(out,{recursive:true});writeFileSync(new URL('production-adoption-'+(baseline?'before':'after')+'.json',out),JSON.stringify({passed:!process.exitCode,checkedAt:new Date().toISOString(),samples,scope:'Natural questions without UI keywords, campus agent, actual paid model; only own validation conversations soft-deleted, no settings/knowledge/trial quota changes'},null,2))
 for(const id of owned)await call('/conversations/'+id,'DELETE')
}
