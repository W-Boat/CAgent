import 'reflect-metadata'
import assert from 'node:assert/strict'
import {ProvidersService} from '../src/providers/providers.service'
import {ModelsService} from '../src/models/models.service'
import {AgentsService} from '../src/agents/agents.service'
import {SkillsEngineService} from '../src/skills/skills-engine.service'
import {assertConfigurationPresent,removedConfigurationIds} from '../src/common/configuration-removal'
async function main(){
 const settings=new Map<string,any>(),audit:any[]=[];const records:any={provider:[{id:'p',key:'builtin',enabled:true,isSystem:true,_count:{models:1}}],model:[{id:'m',providerId:'p',key:'model',enabled:true,isDefault:true}],agent:[{id:'a',key:'guide',enabled:true,isSystem:true}],skill:[{id:'s',key:'tool',enabled:true,isSystem:true}]};const history={messages:[{modelId:'m'}],conversations:[{agentId:'a'}],memories:[{agentId:'a'}],runs:[{skillId:'s'}],knowledge:[{agentId:'a'}]},before=JSON.stringify(history);let keysDisabled=false
 const db:any={setting:{findUnique:async({where}:any)=>settings.get(where.key),findMany:async({where}:any)=>[...settings.entries()].filter(([key])=>key.startsWith(where.key.startsWith)).map(([,value])=>value),upsert:async({where,create}:any)=>{if(!settings.has(where.key))settings.set(where.key,create)}},providerApiKey:{updateMany:async()=>{keysDisabled=true}},$transaction:async(fn:any)=>fn(db)}
 for(const kind of Object.keys(records))db[kind]={findUnique:async({where}:any)=>records[kind].find((r:any)=>r.id===where.id),findMany:async({where}:any)=>records[kind].filter((r:any)=>!where.providerId||r.providerId===where.providerId),update:async({where,data}:any)=>Object.assign(records[kind].find((r:any)=>r.id===where.id),data),delete:async()=>{throw Error('Hard delete would lose history')}}
 const logger:any={log:async(x:any)=>audit.push(x)}
 await new ProvidersService(db,{} as any,logger,{} as any).remove('p');assert(keysDisabled);assert.equal(records.model[0].enabled,false);assert.equal(records.model[0].isDefault,false)
 await new ModelsService(db,logger).remove('m')
 await new AgentsService(db,logger).remove('a')
 await new SkillsEngineService(db,logger,{} as any,{} as any,{} as any,{} as any,{} as any).remove('s')
 for(const kind of Object.keys(records)){const row=records[kind][0];assert.equal(row.enabled,false);assert(row.key.startsWith('removed-'));assert.deepEqual(await removedConfigurationIds(db,kind as any),[row.id]);await assert.rejects(()=>assertConfigurationPresent(db,kind as any,row.id))}
 assert.equal(JSON.stringify(history),before);assert.equal(audit.length,4);assert.equal(settings.get('removed_configuration:model:m').value.key,'model')
 console.log('PASS builtin provider/model/agent/skill removal: nested models and keys disabled, keys reusable, list tombstones durable, mutations rejected, all history and knowledge retained; no production writes')
}
main().catch(e=>{console.error(e);process.exitCode=1})
