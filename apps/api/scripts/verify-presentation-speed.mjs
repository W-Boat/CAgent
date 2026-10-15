import {createRequire} from 'node:module'
import {readFileSync,existsSync} from 'node:fs'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
const req=createRequire(import.meta.url),ts=req('typescript'),modules=new Map()
function load(file){
 if(modules.has(file))return modules.get(file).exports
 const module={exports:{}};modules.set(file,module)
 const local=name=>{
  if(!name.startsWith('.'))return req(name)
  const target=resolve(dirname(file),name),found=[target,target+'.ts',resolve(target,'index.ts')].find(p=>existsSync(p)&&p.endsWith('.ts'))
  if(!found)throw Error('Missing test dependency: '+name)
  return load(found)
 }
 const source=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText
 new Function('module','exports','require','__dirname',source)(module,module.exports,local,dirname(file))
 return module.exports
}
load(fileURLToPath(new URL('./verify-presentation-speed.ts',import.meta.url)))
