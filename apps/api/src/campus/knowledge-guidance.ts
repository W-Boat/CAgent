export interface GuidedHit {
  title:string; score:number; type:string; dept?:string|null; tel?:string|null; place?:string|null;
  provenance?:{trust:string}; related?:GuidedHit[]
}
export interface KnowledgeGuidance {
  stage:'clarify'|'ready'|'not_found'; intent:'compare'|'procedure'|'reference';
  prompt:string; choices:{label:string;query:string}[]; missingFields:string[]; conflicts:string[]
}
/** Guide from evidence already retrieved; questions never invent requirements or answers. */
export function buildGuidance(query:string,hits:GuidedHit[]):KnowledgeGuidance {
  const intent = /区别|对比|比较/.test(query) ? 'compare' : /办|申请|材料|步骤|流程/.test(query) ? 'procedure' : 'reference'
  if (!hits.length) return {stage:'not_found',intent,prompt:'还没有匹配到具体事项。请补充事项名称、身份或校区。',choices:[],missingFields:[],conflicts:[]}
  const first = hits[0]
  const alternatives = hits.filter(h=>h.type==='事项' && h.score>=first.score*0.75)
  const ambiguous = intent !== 'compare' && alternatives.length>1 && query.trim().length<=12 && !alternatives.some(h=>query.includes(h.title))
  const missingFields = first.type==='事项' ? [['办理部门',first.dept],['办理地点',first.place],['联系电话',first.tel]].filter(([,v])=>!v).map(([name])=>name as string) : []
  const conflicts:string[]=[]
  for (const [field,label] of [['dept','办理部门'],['tel','联系电话'],['place','办理地点']] as const) {
    const values = [...new Set([first,...(first.related || [])].filter(h=>h.title===first.title).map(h=>h[field]?.trim()).filter(Boolean))]
    if(values.length>1) conflicts.push(`${label}存在不同来源说法，请核实：${values.join(' / ')}`)
  }
  return {stage:ambiguous?'clarify':'ready',intent,prompt:ambiguous?'你想办理哪一项？选择具体事项后再查看材料、流程和入口。':
    intent==='compare'?'已联动检索多个事项，可按材料、办理对象和入口比较。':'已按事项关联资料；缺项请向主管部门确认。',
    choices:ambiguous?alternatives.slice(0,4).map(h=>({label:h.title,query:h.title})):[],missingFields,conflicts}
}
