import { terms } from '../campus/knowledge-retriever'
import type { LlmToolDef } from './llm/types'
/** Explicit tools are handled by the caller; only relevant automatic tools spend schema tokens. */
export function selectAutomaticTools(query:string,defs:LlmToolDef[],limit=4):LlmToolDef[] {
  const qterms=terms(query)
  return defs.map(def=>({def,score:qterms.filter(t=>`${def.name} ${def.description}`.toLowerCase().includes(t)).length}))
    .filter(item=>item.score>0).sort((a,b)=>b.score-a.score||a.def.name.localeCompare(b.def.name))
    .slice(0,limit).map(item=>item.def)
}
