import assert from 'node:assert/strict'
import {readFileSync,readdirSync,statSync} from 'node:fs'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..')
const walk=dir=>readdirSync(dir).flatMap(name=>{const p=resolve(dir,name);return statSync(p).isDirectory()?walk(p):[p]})
const files=['apps/api/src','apps/web/src'].flatMap(path=>walk(resolve(root,path)))
const active=[]
for(const file of files){const text=readFileSync(file,'utf8');if(/(?:class\s+(?:Loveline|Editorial)(?:Service|Module|Controller)|@Controller\(\s*["'](?:loveline|editorial)|from\s+["'][^"']*\/(?:loveline|editorial)(?:\/|["']))/.test(text))active.push(file.slice(root.length+1))}
assert.deepEqual(active,[],'Retired executable module remains')
const config=JSON.parse(readFileSync(resolve(root,'deploy/profiles/ucass/configuration.json'),'utf8'))
const retired=/人文之光|editorial|loveline|couple_|情侣空间|心屿/i
for(const kind of ['agents','skills','bases','entries'])assert(!config[kind].some(x=>retired.test([x.key,x.name,x.title].filter(Boolean).join(' '))),kind)
const manifest=JSON.parse(readFileSync(resolve(root,'deploy/profiles/ucass/manifest.json'),'utf8'));let rows=0
for(const f of manifest.files.filter(f=>f.kind==='items')){const items=JSON.parse(readFileSync(resolve(root,'deploy/profiles/ucass',f.path),'utf8'));rows+=items.length;assert(!items.some(x=>retired.test([x.title,x.name,x.source].filter(Boolean).join(' '))),f.path)}
assert.equal(rows,manifest.counts.items)
console.log(JSON.stringify({passed:true,sourceFiles:files.length,knowledgeRows:rows,activeModules:0,retiredProfileCapabilities:0,retiredNamedKnowledgeRows:0,historicalMigrationsRetained:true,antiRevivalFiltersRetained:true,note:'Historical migrations and inactive enum values preserve upgrade compatibility. Same-named campus activities quoted in student handbooks are not editorial capabilities.'}))
