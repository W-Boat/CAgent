import {readFileSync,existsSync} from 'node:fs'
import {resolve,dirname} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {MARKER,pick,loadCampusProfile} from './lib/campus-profile.mjs'
const here=dirname(fileURLToPath(import.meta.url)),env=resolve(here,'../../../.env')
if(existsSync(env))for(const line of readFileSync(env,'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].trim().replace(/^(["'])(.*)\1$/,'$2')}
export async function applyCampusProfile(db,profile,{allowExisting=false,modelRef}={}){
 const {configuration:c,items,manifest}=profile
 if(modelRef&&!c.models.some(m=>m.providerKey+'/'+m.key===modelRef))throw Error('Unknown --model reference')
 const already=await db.setting.findUnique({where:{key:MARKER}});if(already)return {skipped:true,reason:'Profile already initialized; administrator changes preserved',profile:already.value}
 const admin=await db.user.findFirst({where:{status:'ACTIVE',roles:{some:{role:{key:'super_admin'}}}},orderBy:{createdAt:'asc'}});if(!admin)throw Error('Initialize your administrator with seed before importing the profile')
 if(!allowExisting&&(await db.campusGuideItem.count()||await db.knowledgeBase.count()||await db.conversation.count()))throw Error('Existing business data found; use a fresh database or back up and explicitly pass --allow-existing (no existing data is deleted)')
 let presets=[];const presetPath=resolve(here,'../dist/src/chat/provider-presets.js');if(existsSync(presetPath)){const m=await import(pathToFileURL(presetPath).href);presets=m.PROVIDER_PRESETS||m.default?.PROVIDER_PRESETS||[]}
 return db.$transaction(async tx=>{
  // Serialize installation in this database; recheck after obtaining the lock.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(714020261012)::text`
  if(await tx.setting.findUnique({where:{key:MARKER}}))return {skipped:true,reason:'Profile already initialized'}
  const providerIds=new Map(),modelIds=new Map(),skillIds=new Map(),agentIds=new Map()
  for(const p of c.providers){const override=process.env['PROFILE_PROVIDER_'+p.key.replace(/[^a-z0-9]/gi,'_').toUpperCase()+'_BASE_URL'],preset=presets.find(x=>x.key===p.key);const data=pick(p,['name','type','enabled','isSystem','sort']);if(override){const url=new URL(override);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('Invalid provider endpoint');data.baseUrl=override}
   const row=await tx.provider.upsert({where:{key:p.key},create:{key:p.key,...data,baseUrl:override||preset?.baseUrl||null},update:data});providerIds.set(p.key,row.id)
  }
  for(const m of c.models){const data={...pick(m,['name','enabled','isDefault','sort','contextWindow','maxOutputTokens','supportsVision','supportsTools','supportsStream','inputPricePerM','outputPricePerM','description']),providerId:providerIds.get(m.providerKey)};const row=await tx.model.upsert({where:{providerId_key:{providerId:data.providerId,key:m.key}},create:{key:m.key,...data},update:data});modelIds.set(m.providerKey+'/'+m.key,row.id)}
  for(const s of c.skills){const data={...pick(s,['name','description','category','type','enabled','isSystem','icon','sort','systemPrompt','inputSchema','permissionCode']),config:s.config,createdById:admin.id};if(data.inputSchema===null)delete data.inputSchema;const row=await tx.skill.upsert({where:{key:s.key},create:{key:s.key,...data},update:data});skillIds.set(s.key,row.id)}
  for(const a of c.agents){const data={...pick(a,['name','description','avatar','systemPrompt','greeting','starters','mode','enabled','visibility','isSystem','sort','allowBrowser','temperature','maxToolRounds','maxContextMessages']),ownerId:admin.id,modelId:modelIds.get(modelRef||a.modelRef)||null};if(data.starters===null)delete data.starters;const row=await tx.agent.upsert({where:{key:a.key},create:{key:a.key,...data},update:data});agentIds.set(a.key,row.id);for(const s of a.skills)await tx.agentSkill.upsert({where:{agentId_skillId:{agentId:row.id,skillId:skillIds.get(s.key)}},create:{agentId:row.id,skillId:skillIds.get(s.key),sort:s.sort,config:s.config},update:{sort:s.sort,config:s.config}})}
  for(const b of c.bases){const data={...pick(b,['name','description','kind','aiReviewEnabled','aiSummaryEnabled']),mounted:b.requiresConnection?false:b.mounted,connection:b.connection,agentId:agentIds.get(b.agentKey)||null,automationModelId:modelIds.get(b.automationModelRef)||null,automationUserId:b.aiReviewEnabled||b.aiSummaryEnabled?admin.id:null};await tx.knowledgeBase.upsert({where:{id:b.id},create:{id:b.id,...data},update:allowExisting?{}:data})}
  for(const e of c.entries)await tx.knowledgeEntry.upsert({where:{baseId_questionKey:{baseId:e.baseId,questionKey:e.questionKey}},create:pick(e,['id','baseId','externalKey','title','question','questionKey','answer','summary','aliases','url','mode','status','priority','source']),update:{}})
  for(let offset=0;offset<items.length;offset+=200){const rows=items.slice(offset,offset+200).map(i=>{const r={...i};for(const k of ['steps','keyFacts','detailParts','extra'])if(r[k]===null)delete r[k];return r});await tx.campusGuideItem.createMany({data:rows,skipDuplicates:true})}
  for(const s of c.settings){const value=s.key.endsWith('_model_id')?(modelIds.get(modelRef||s.modelRef)||''):s.value;await tx.setting.upsert({where:{key:s.key},create:{key:s.key,group:s.group,value},update:{value}})}
  await tx.setting.upsert({where:{key:'knowledge_revision'},create:{key:'knowledge_revision',group:'knowledge',value:Date.now()},update:{value:Date.now()}})
  const record={name:manifest.name,exportedAt:manifest.exportedAt,installedAt:new Date().toISOString(),counts:manifest.counts};await tx.setting.create({data:{key:MARKER,group:'deployment',value:record}})
  return {installed:true,counts:manifest.counts,requiresConfiguration:c.bases.filter(b=>b.requiresConnection).map(b=>b.name)}
 },{maxWait:10000,timeout:180000})
}
async function main(){const args=process.argv.slice(2),modelIndex=args.indexOf('--model'),modelRef=modelIndex>=0?args[modelIndex+1]:undefined;if(modelIndex>=0&&!modelRef)throw Error('--model requires providerKey/modelKey');const directory=args.find((x,i)=>!x.startsWith('--')&&!(modelIndex>=0&&i===modelIndex+1))||resolve(here,'../../../deploy/profiles/ucass'),profile=loadCampusProfile(directory,process.env.SITE_ORIGIN||process.env.WEB_ORIGIN?.split(',')[0]||'http://localhost:5173')
 if(!args.includes('--apply')){console.log(JSON.stringify({valid:true,dryRun:true,counts:profile.manifest.counts,next:'Pass --apply after seeding a fresh database'}));return}
 const {PrismaClient}=await import('@prisma/client');const db=new PrismaClient();try{console.log(JSON.stringify(await applyCampusProfile(db,profile,{allowExisting:args.includes('--allow-existing'),modelRef})))}finally{await db.$disconnect()}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1})
