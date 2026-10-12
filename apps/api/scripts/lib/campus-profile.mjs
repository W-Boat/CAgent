import {readFileSync} from 'node:fs'
import {resolve,sep} from 'node:path'
import {createHash} from 'node:crypto'
export const MARKER='deployment_profile:ucass-campus'
export const pick=(row,fields)=>Object.fromEntries(fields.filter(k=>row[k]!==undefined).map(k=>[k,row[k]]))
export function loadCampusProfile(directory,origin='http://localhost:5173'){
 const root=resolve(directory),manifest=JSON.parse(readFileSync(resolve(root,'manifest.json'),'utf8'))
 if(manifest.schemaVersion!==1||!Array.isArray(manifest.files)||!manifest.files.length)throw Error('Unsupported profile manifest')
 const site=new URL(origin);if(!['http:','https:'].includes(site.protocol)||site.username||site.password)throw Error('SITE_ORIGIN must be an HTTP(S) origin without credentials')
 let configuration;const items=[]
 for(const file of manifest.files){const path=resolve(root,file.path);if(!path.startsWith(root+sep)||file.path.includes('..')||!file.path.endsWith('.json'))throw Error('Unsafe profile path')
  const bytes=readFileSync(path);if(bytes.length!==file.bytes||createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Error('Profile checksum mismatch: '+file.path)
  const parsed=JSON.parse(bytes.toString('utf8').replaceAll('{{SITE_ORIGIN}}',site.origin))
  if(file.kind==='configuration'){if(configuration)throw Error('Duplicate configuration');configuration=parsed}else if(file.kind==='items'&&Array.isArray(parsed))items.push(...parsed);else throw Error('Unsupported profile file')
 }
 if(!configuration||configuration.schemaVersion!==1)throw Error('Missing configuration')
 for(const key of ['settings','providers','models','agents','skills','bases','entries'])if(!Array.isArray(configuration[key])||configuration[key].length!==manifest.counts[key])throw Error('Profile count mismatch: '+key)
 if(items.length!==manifest.counts.items||new Set(items.map(i=>i.externalId)).size!==items.length||items.some(i=>!Number.isSafeInteger(i.externalId)))throw Error('Invalid item IDs or count')
 const retired=/人文之光|editorial|loveline|love[-_]?line|couple|情侣空间|心屿/i
 if([...configuration.skills,...configuration.agents].some(x=>retired.test(x.key+' '+x.name)))throw Error('Retired capability in profile')
 const baseIds=new Set(configuration.bases.map(b=>b.id)),agentKeys=new Set(configuration.agents.map(a=>a.key)),skillKeys=new Set(configuration.skills.map(s=>s.key)),modelRefs=new Set(configuration.models.map(m=>m.providerKey+'/'+m.key)),providers=new Set(configuration.providers.map(p=>p.key))
 for(const b of configuration.bases)if(b.agentKey&&!agentKeys.has(b.agentKey)||b.automationModelRef&&!modelRefs.has(b.automationModelRef))throw Error('Unknown base binding')
 for(const e of configuration.entries)if(!baseIds.has(e.baseId)||e.status!=='APPROVED')throw Error('Unknown base or unpublished entry')
 for(const a of configuration.agents)if(a.modelRef&&!modelRefs.has(a.modelRef)||a.skills.some(s=>!skillKeys.has(s.key)))throw Error('Unknown agent binding')
 if(configuration.models.some(m=>!providers.has(m.providerKey)))throw Error('Unknown model provider')
 const forbidden=/^(?:passwordEncrypted|apiKey|apiKeys|JWT_SECRET|ENCRYPTION_KEY|cookie|authorization|tokenHash|userId|ownerId|createdById|reviewedById|sourceMessageId|operatorId)$/i
 const audit=v=>{if(Array.isArray(v))v.forEach(audit);else if(v&&typeof v==='object')for(const [k,x] of Object.entries(v)){if(forbidden.test(k))throw Error('Private field in profile: '+k);audit(x)}};audit(configuration);audit(items)
 return {manifest,configuration,items}
}
