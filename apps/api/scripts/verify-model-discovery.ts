import 'reflect-metadata'
import assert from 'node:assert/strict'
import {discoverProviderModels} from '../src/providers/model-discovery'
import {ProvidersService} from '../src/providers/providers.service'
async function main(){const original=global.fetch,calls:any[]=[];let status=200,payload:any={data:[{id:'one',name:'One',context_window:65536,max_output_tokens:8192,input_modalities:['text','image']},{id:'one'},{id:'bad key'}]}
 global.fetch=async(url:any,options:any)=>{calls.push({url:String(url),options});return new Response(JSON.stringify(payload),{status})}
 try{
  let result=await discoverProviderModels('OPENAI_COMPATIBLE','https://example.invalid/v1','fixture-secret');assert.equal(calls[0].url,'https://example.invalid/v1/models');assert.equal(calls[0].options.headers.Authorization,'Bearer fixture-secret');assert.equal(calls[0].options.redirect,'error');assert.equal(result.models.length,1)
  payload={data:[{id:'claude-fixture',display_name:'Fixture'}],has_more:true};result=await discoverProviderModels('ANTHROPIC','https://example.invalid/v1','fixture-secret');assert(calls.at(-1).url.includes('/v1/models?limit=1000'));assert.equal(calls.at(-1).options.headers['x-api-key'],'fixture-secret');assert(result.partial)
  payload={models:[{name:'models/gemini-fixture',displayName:'Fixture'}]};result=await discoverProviderModels('GOOGLE',null,'fixture-secret');assert.equal(result.models[0].key,'gemini-fixture');assert(!calls.at(-1).url.includes('fixture-secret'))
  payload={models:[{model:'local:latest'}]};assert.equal((await discoverProviderModels('OLLAMA','http://localhost:11434/v1','')).models[0].key,'local:latest');assert(calls.at(-1).url.endsWith('/api/tags'))
  status=401;await assert.rejects(()=>discoverProviderModels('OPENAI_COMPATIBLE',null,'fixture-secret'),e=>!String(e).includes('fixture-secret'));status=200;payload={bad:true};await assert.rejects(()=>discoverProviderModels('OPENAI_COMPATIBLE',null,'fixture-secret'))
  await assert.rejects(()=>discoverProviderModels('AZURE_OPENAI',null,'fixture-secret'));await assert.rejects(()=>discoverProviderModels('OPENAI_COMPATIBLE','https://user:pass@example.invalid','fixture-secret'))
  const rows:any[]=[{key:'existing'}],audit:any[]=[];const db:any={setting:{findUnique:async()=>null},provider:{findFirst:async()=>({id:'p',enabled:true})},model:{findMany:async()=>rows,createMany:async({data,skipDuplicates}:any)=>{assert.equal(skipDuplicates,true);let count=0;for(const m of data){assert.equal(m.enabled,false);assert.equal(m.isDefault,false);if(!rows.some(r=>r.key===m.key)){rows.push(m);count++}}return {count}}}}
  const service:any=new ProvidersService(db,{} as any,{log:async(x:any)=>audit.push(x)} as any,{} as any);service.resolveCredentials=async()=>({provider:{type:'OPENAI_COMPATIBLE'},baseUrl:'https://example.invalid/v1',apiKey:'fixture-secret'})
  payload={data:[{id:'existing'},{id:'new'}]};assert.equal((await service.discoverModels('p')).models[0].existing,true)
  assert.deepEqual(await service.importDiscovered('p',['existing','new'],{id:'admin',email:'fixture@example.invalid'}),{created:1,skipped:1});assert.equal(rows.length,2);assert.equal(audit.length,1)
  await assert.rejects(()=>service.importDiscovered('p',['invented'],{id:'admin',email:'fixture@example.invalid'}));service.discovered.get('p').until=0;await assert.rejects(()=>service.importDiscovered('p',['new'],{id:'admin',email:'fixture@example.invalid'}))
  console.log('PASS discovery: four protocols, credentials, no redirects, normalization, HTTP/schema errors, duplicate-safe disabled imports, forged/expired selection rejection; no external requests or model calls')
 }finally{global.fetch=original}
}
main().catch(e=>{console.error(e);process.exitCode=1})
